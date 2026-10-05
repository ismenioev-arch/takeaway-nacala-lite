/**
 * Tradução de uma mensagem da Meta para as colunas da tabela `messages`.
 *
 * Isolado do resto do serviço, e sem tocar na base de dados, porque é aqui
 * que vive a maior parte das decisões discutíveis — e assim podem ser
 * testadas uma a uma.
 *
 * Duas regras guiam tudo o que se segue:
 *
 * 1. **Nunca perder uma mensagem.** Um tipo que não conhecemos é guardado
 *    como `unsupported`, com uma descrição legível, e não descartado. Quem
 *    está ao balcão prefere ver «Enviou uma localização» a não ver nada e
 *    julgar que o cliente desistiu.
 *
 * 2. **Nunca violar uma restrição da base de dados.** O esquema exige corpo
 *    não vazio nas mensagens de texto e `media_id` nas mensagens com media.
 *    Uma mensagem que não cumpra isso é rebaixada para `unsupported` em vez
 *    de rebentar a transacção e levar o lote inteiro atrás.
 */
import type { MessageType } from '../models/enums.js';
import type { WebhookMessage } from '../validators/whatsapp.validators.js';

export interface NormalizedMessage {
  type: MessageType;
  /** O que se mostra na listagem de conversas. Nunca vazio. */
  body: string | null;
  caption: string | null;
  mediaId: string | null;
  mediaMime: string | null;
  mediaSha256: string | null;
}

const MEDIA_TYPES = ['image', 'document', 'audio', 'video', 'sticker'] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

const isMediaType = (type: string): type is MediaType =>
  (MEDIA_TYPES as readonly string[]).includes(type);

/** Descrição legível de cada tipo de media, para quando não há legenda. */
const MEDIA_LABEL: Record<MediaType, string> = {
  image: 'Enviou uma imagem',
  document: 'Enviou um documento',
  audio: 'Enviou uma mensagem de voz',
  video: 'Enviou um vídeo',
  sticker: 'Enviou um autocolante',
};

const blank = (value: string | null | undefined): boolean =>
  value === null || value === undefined || value.trim() === '';

/** Mensagem que não soubemos interpretar, mas que fica registada. */
function unsupported(description: string): NormalizedMessage {
  return {
    type: 'unsupported',
    body: description,
    caption: null,
    mediaId: null,
    mediaMime: null,
    mediaSha256: null,
  };
}

export function normalizeMessage(message: WebhookMessage): NormalizedMessage {
  const type = message.type;

  if (type === 'text') {
    const body = message.text?.body;

    // O esquema recusa uma mensagem de texto sem texto, e com razão: seria
    // um erro de programação disfarçado de dado. Mas recebê-la da Meta não
    // é motivo para perder o lote — fica registada como não suportada.
    if (blank(body)) return unsupported('Mensagem de texto vazia');

    return { type: 'text', body: body!, caption: null, mediaId: null, mediaMime: null, mediaSha256: null };
  }

  if (isMediaType(type)) {
    const media = message[type];

    // Sem `media_id` não há como ir buscar o ficheiro à Meta mais tarde, e a
    // base de dados recusa a linha. Guardamos o que sabemos.
    if (!media?.id) return unsupported(`${MEDIA_LABEL[type]} (sem identificador de media)`);

    // `filename` só existe em documentos e é mais útil do que um rótulo
    // genérico: diz qual é o ficheiro.
    const caption = !blank(media.caption)
      ? media.caption!
      : !blank(media.filename)
        ? media.filename!
        : null;

    return {
      type,
      body: caption ?? MEDIA_LABEL[type],
      caption,
      mediaId: media.id,
      mediaMime: media.mime_type ?? null,
      mediaSha256: media.sha256 ?? null,
    };
  }

  if (type === 'location') {
    const { latitude, longitude, name, address } = message.location ?? {};

    if (latitude === undefined || longitude === undefined) {
      return unsupported('Enviou uma localização incompleta');
    }

    const label = [name, address].filter((part) => !blank(part)).join(' — ');
    const coordinates = `${latitude}, ${longitude}`;

    return {
      type: 'location',
      body: label ? `Localização: ${label} (${coordinates})` : `Localização: ${coordinates}`,
      caption: null,
      mediaId: null,
      mediaMime: null,
      mediaSha256: null,
    };
  }

  if (type === 'contacts') {
    const count = message.contacts?.length ?? 0;
    return {
      type: 'contacts',
      body: count === 1 ? 'Partilhou um contacto' : `Partilhou ${count} contactos`,
      caption: null,
      mediaId: null,
      mediaMime: null,
      mediaSha256: null,
    };
  }

  if (type === 'interactive') {
    const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
    const title = reply?.title;

    return {
      type: 'interactive',
      body: blank(title) ? 'Respondeu a uma mensagem interactiva' : `Escolheu: ${title!}`,
      caption: null,
      mediaId: null,
      mediaMime: null,
      mediaSha256: null,
    };
  }

  if (type === 'button') {
    const text = message.button?.text;
    return {
      type: 'button',
      body: blank(text) ? 'Carregou num botão' : `Carregou em: ${text!}`,
      caption: null,
      mediaId: null,
      mediaMime: null,
      mediaSha256: null,
    };
  }

  // A reacção não tem lugar próprio no esquema (não é uma mensagem, é um
  // comentário a outra). Guardamo-la como não suportada, mas legível.
  if (type === 'reaction') {
    const emoji = message.reaction?.emoji;
    return unsupported(blank(emoji) ? 'Retirou uma reacção' : `Reagiu com ${emoji!}`);
  }

  if (type === 'system') {
    return {
      type: 'system',
      body: 'Mensagem de sistema do WhatsApp',
      caption: null,
      mediaId: null,
      mediaMime: null,
      mediaSha256: null,
    };
  }

  // Tipo desconhecido, ou conteúdo que a Meta não conseguiu entregar.
  if (message.errors && message.errors.length > 0) {
    return unsupported('O WhatsApp não conseguiu entregar o conteúdo desta mensagem');
  }

  return unsupported(`Mensagem do tipo "${type}", ainda não suportada`);
}

/**
 * Estado de entrega da Meta → estado na nossa tabela.
 *
 * Devolve `null` para estados que não nos dizem nada de novo, como o
 * `accepted` que a Meta envia em certos fluxos de template.
 */
export function mapDeliveryStatus(status: string): 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | null {
  switch (status.toLowerCase()) {
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'read':
      return 'READ';
    case 'failed':
      return 'FAILED';
    default:
      return null;
  }
}
