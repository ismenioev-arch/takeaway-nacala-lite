/**
 * Simula a Meta a bater no nosso webhook.
 *
 * As mensagens vão assinadas com `WHATSAPP_APP_SECRET`, exactamente como
 * a Meta faz — se a assinatura falhar, o webhook recusa, e é bom que
 * recuse. O lote cobre de propósito os casos que partem sistemas mal
 * feitos: uma imagem, uma localização, e um tipo de mensagem que não
 * existe.
 *
 *   node --import tsx wim/demo/send-webhook.mjs
 */
import { createHmac } from 'node:crypto';

const BASE = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:4000';
const SECRET = process.env.WHATSAPP_APP_SECRET;

if (!SECRET) {
  console.error('Falta WHATSAPP_APP_SECRET no ambiente.');
  process.exit(1);
}

const CONTACTOS = [
  { wa: '258841110001', nome: 'Rui Chemane' },
  { wa: '258842220002', nome: 'Luísa Bata' },
  { wa: '258843330003', nome: 'Carlos Mbanze' },
  { wa: '258844440004', nome: 'Amélia Mucavele' },
  { wa: '258845550005', nome: 'Jorge Nhantumbo' },
];

const LOTE = [
  {
    de: 0,
    texto:
      'A minha obra está parada, ficámos sem cimento desde ontem. Precisamos de resposta hoje.',
  },
  { de: 0, texto: 'Alguém me pode ligar, por favor?' },
  { de: 1, texto: 'Quanto custa catering para 50 pessoas no sábado?' },
  {
    de: 2,
    texto: 'Queria encomendar 20 refeições para sexta-feira ao meio-dia.',
  },
  { de: 2, texto: 'Vou pagar por transferência bancária, está bem?' },
  { de: 3, texto: 'Ainda fazem entrega no Bairro Triângulo?' },
  { de: 3, tipo: 'image', legenda: 'É este prato?' },
  { de: 4, texto: 'A comida de ontem chegou fria, fiquei muito desapontado.' },
  { de: 4, tipo: 'localizacao' },
  // Um tipo que a Meta ainda não inventou: o sistema tem de o aceitar
  // como «não suportado» em vez de rebentar.
  { de: 1, tipo: 'ordem_de_compra_v9' },
];

let contador = Date.now();

function mensagem(item) {
  const contacto = CONTACTOS[item.de];
  const id = `wamid.DEMO_${(contador += 1)}`;
  const base = {
    from: contacto.wa,
    id,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };

  if (item.tipo === 'image') {
    return {
      ...base,
      type: 'image',
      image: { id: 'media-1', mime_type: 'image/jpeg', caption: item.legenda },
    };
  }
  if (item.tipo === 'localizacao') {
    return {
      ...base,
      type: 'location',
      location: {
        latitude: -14.5428,
        longitude: 40.6728,
        name: 'Nacala Porto',
      },
    };
  }
  if (item.tipo) {
    return {
      ...base,
      type: item.tipo,
      [item.tipo]: { payload: 'formato desconhecido' },
    };
  }
  return { ...base, type: 'text', text: { body: item.texto } };
}

const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '258840000000',
              phone_number_id: '106540352242922',
            },
            contacts: CONTACTOS.map((c) => ({
              wa_id: c.wa,
              profile: { name: c.nome },
            })),
            messages: LOTE.map(mensagem),
          },
        },
      ],
    },
  ],
};

const corpo = JSON.stringify(payload);
const assinatura = `sha256=${createHmac('sha256', SECRET).update(corpo).digest('hex')}`;

const resposta = await fetch(`${BASE}/api/webhooks/whatsapp`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-hub-signature-256': assinatura,
  },
  body: corpo,
});

console.log(`Webhook respondeu ${resposta.status}: ${await resposta.text()}`);
console.log(`${LOTE.length} mensagens de ${CONTACTOS.length} contactos entregues.`);
