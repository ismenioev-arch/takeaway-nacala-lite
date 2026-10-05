/**
 * A tradução de uma mensagem da Meta para as nossas colunas.
 *
 * Os casos aqui não são hipotéticos: cada um corresponde a algo que um
 * cliente real envia num dia normal — uma foto do prato, um áudio, a
 * localização para a entrega — e que, antes desta camada, ou rebentava a
 * inserção ou desaparecia sem deixar rasto.
 */
import { describe, expect, it } from 'vitest';
import { mapDeliveryStatus, normalizeMessage } from '../../src/services/whatsapp-normalize.js';
import type { WebhookMessage } from '../../src/validators/whatsapp.validators.js';

const base = { id: 'wamid.ABC', from: '258840000000', timestamp: '1700000000' };

const message = (extra: Record<string, unknown>): WebhookMessage =>
  ({ ...base, ...extra }) as WebhookMessage;

describe('normalizeMessage', () => {
  describe('texto', () => {
    it('guarda o corpo tal como veio', () => {
      const result = normalizeMessage(message({ type: 'text', text: { body: 'Bom dia, tem frango?' } }));

      expect(result.type).toBe('text');
      expect(result.body).toBe('Bom dia, tem frango?');
      expect(result.mediaId).toBeNull();
    });

    // A base de dados recusa uma mensagem de texto sem texto. Rebaixá-la é
    // preferível a deixar a excepção levar o lote inteiro atrás.
    it('rebaixa um texto vazio em vez de falhar a inserção', () => {
      const result = normalizeMessage(message({ type: 'text', text: { body: '   ' } }));

      expect(result.type).toBe('unsupported');
      expect(result.body).toContain('vazia');
    });
  });

  describe('media', () => {
    it('guarda a referência da imagem e usa a legenda como corpo', () => {
      const result = normalizeMessage(
        message({
          type: 'image',
          image: { id: 'media-1', mime_type: 'image/jpeg', sha256: 'abc', caption: 'É este?' },
        }),
      );

      expect(result).toMatchObject({
        type: 'image',
        body: 'É este?',
        caption: 'É este?',
        mediaId: 'media-1',
        mediaMime: 'image/jpeg',
        mediaSha256: 'abc',
      });
    });

    // Sem legenda o corpo não pode ficar vazio: é o que a listagem de
    // conversas mostra, e uma linha em branco parece uma avaria.
    it('descreve a media quando não há legenda', () => {
      expect(normalizeMessage(message({ type: 'audio', audio: { id: 'm' } })).body).toBe(
        'Enviou uma mensagem de voz',
      );
      expect(normalizeMessage(message({ type: 'video', video: { id: 'm' } })).body).toBe(
        'Enviou um vídeo',
      );
      expect(normalizeMessage(message({ type: 'sticker', sticker: { id: 'm' } })).body).toBe(
        'Enviou um autocolante',
      );
    });

    it('prefere o nome do ficheiro num documento sem legenda', () => {
      const result = normalizeMessage(
        message({ type: 'document', document: { id: 'm', filename: 'menu-2026.pdf' } }),
      );

      expect(result.body).toBe('menu-2026.pdf');
      expect(result.caption).toBe('menu-2026.pdf');
    });

    // O esquema exige media_id em mensagens com media. Sem ele a linha seria
    // recusada pela base de dados.
    it('rebaixa media sem identificador', () => {
      const result = normalizeMessage(message({ type: 'image', image: {} }));

      expect(result.type).toBe('unsupported');
      expect(result.mediaId).toBeNull();
    });
  });

  describe('outros tipos', () => {
    it('descreve uma localização com nome e coordenadas', () => {
      const result = normalizeMessage(
        message({
          type: 'location',
          location: { latitude: -14.54, longitude: 40.67, name: 'Nacala Porto' },
        }),
      );

      expect(result.type).toBe('location');
      expect(result.body).toContain('Nacala Porto');
      expect(result.body).toContain('-14.54');
    });

    it('lê o título escolhido numa mensagem interactiva', () => {
      const result = normalizeMessage(
        message({
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: 'sim', title: 'Confirmar' } },
        }),
      );

      expect(result.type).toBe('interactive');
      expect(result.body).toBe('Escolheu: Confirmar');
    });

    it('conta os contactos partilhados', () => {
      expect(normalizeMessage(message({ type: 'contacts', contacts: [{}, {}] })).body).toBe(
        'Partilhou 2 contactos',
      );
    });

    it('regista uma reacção de forma legível', () => {
      const result = normalizeMessage(
        message({ type: 'reaction', reaction: { message_id: 'wamid.X', emoji: '👍' } }),
      );

      expect(result.body).toBe('Reagiu com 👍');
    });
  });

  // O ponto central de todo este módulo: a Meta inventa tipos novos, e isso
  // não pode custar uma mensagem de cliente.
  it('guarda um tipo desconhecido em vez de o descartar', () => {
    const result = normalizeMessage(message({ type: 'ordem_de_compra_v3' }));

    expect(result.type).toBe('unsupported');
    expect(result.body).toContain('ordem_de_compra_v3');
  });

  it('assinala quando a própria Meta não conseguiu entregar o conteúdo', () => {
    const result = normalizeMessage(
      message({ type: 'unknown', errors: [{ code: 131051, title: 'Unsupported message type' }] }),
    );

    expect(result.type).toBe('unsupported');
    expect(result.body).toContain('não conseguiu entregar');
  });
});

describe('mapDeliveryStatus', () => {
  it('traduz os estados que nos interessam', () => {
    expect(mapDeliveryStatus('sent')).toBe('SENT');
    expect(mapDeliveryStatus('delivered')).toBe('DELIVERED');
    expect(mapDeliveryStatus('read')).toBe('READ');
    expect(mapDeliveryStatus('failed')).toBe('FAILED');
  });

  it('ignora estados sem significado para nós', () => {
    expect(mapDeliveryStatus('accepted')).toBeNull();
    expect(mapDeliveryStatus('deleted')).toBeNull();
  });
});
