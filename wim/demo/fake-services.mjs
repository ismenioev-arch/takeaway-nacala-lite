/**
 * Duplos locais da Anthropic e da Graph API da Meta.
 *
 * Existe para que seja possível ver o sistema a funcionar de ponta a ponta
 * sem chaves reais e sem mandar mensagens a ninguém. O que é genuinamente
 * exercitado é tudo o que é nosso: os clientes HTTP, a validação das
 * respostas, a decisão de automação e as escritas na base de dados. A
 * única diferença para produção são duas variáveis de ambiente
 * (`ANTHROPIC_BASE_URL` e `WHATSAPP_GRAPH_URL`).
 *
 *   node wim/demo/fake-services.mjs        # porta 4100
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.DEMO_FAKE_PORT ?? 4100);

// ─────────────────────────────────────────────────────────────────────────────
// Duplo da Anthropic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cada caso olha **só** para o texto do cliente, nunca para o prompt
 * inteiro. A razão é uma armadilha real: o prompt contém a palavra
 * «preparadas», e `'preparadas'.includes('parada')` é verdadeiro — um
 * classificador ingénuo classificaria tudo como obra parada.
 */
const CASOS = [
  {
    quando: (t) => /obra.*(parad|sem (material|cimento))|estamos parados/i.test(t),
    resposta: {
      priority: 'URGENTE',
      intent: 'OBRA',
      confidence: 0.94,
      summary: 'Obra parada por falta de material. Cliente precisa de resposta imediata.',
      urgency_reason: 'A obra está parada e cada hora tem custo directo para o cliente.',
      requires_human: true,
      recommended_action: 'Confirmar hoje o prazo de entrega do material em falta.',
      suggested_reply:
        'Bom dia. Lamento pela paragem. Vou verificar agora mesmo a disponibilidade e confirmo o prazo ainda hoje.',
      mentions_price_or_deadline: false,
      grounded_in_registered_facts: true,
    },
  },
  {
    quando: (t) => /quanto custa|qual (é )?o preç|orçament|catering para \d+/i.test(t),
    resposta: {
      priority: 'IMPORTANTE',
      intent: 'ORCAMENTO',
      confidence: 0.99,
      summary: 'Pedido de orçamento para catering.',
      urgency_reason: null,
      requires_human: true,
      recommended_action: 'Preparar proposta com preço por pessoa e condições de pagamento.',
      suggested_reply:
        'Boa tarde. Para 50 pessoas o valor é de 18000 MT, com entrada, prato principal e bebida. Confirma a data?',
      mentions_price_or_deadline: true,
      grounded_in_registered_facts: true,
    },
  },
  {
    quando: (t) => /encomend|queria \d+ refeiç|reservar/i.test(t),
    resposta: {
      priority: 'IMPORTANTE',
      intent: 'ORCAMENTO',
      confidence: 0.91,
      summary: 'Encomenda de refeições em quantidade.',
      urgency_reason: null,
      requires_human: true,
      recommended_action: 'Confirmar quantidade, hora e local de entrega.',
      suggested_reply:
        'Com certeza. Confirma a hora e o local de entrega, por favor? Preparamos tudo com antecedência.',
      mentions_price_or_deadline: false,
      grounded_in_registered_facts: true,
    },
  },
  {
    quando: (t) => /entrega|horário|abrem|fecham|bairro/i.test(t),
    resposta: {
      priority: 'NORMAL',
      intent: 'INFORMACAO',
      confidence: 0.96,
      summary: 'Pergunta sobre zonas de entrega.',
      urgency_reason: null,
      requires_human: false,
      recommended_action: null,
      // Ancorada no contexto da empresa: é isto que permite o nível AUTO.
      suggested_reply:
        'Sim, fazemos entregas no Bairro Triângulo. O horário de entrega é das 11h às 21h, todos os dias.',
      mentions_price_or_deadline: false,
      grounded_in_registered_facts: true,
    },
  },
  {
    quando: (t) => /\[imagem\]|\(imagem\)|é este prato/i.test(t),
    resposta: {
      priority: 'NORMAL',
      intent: 'INFORMACAO',
      confidence: 0.54,
      summary: 'Cliente enviou uma imagem a perguntar sobre um prato.',
      urgency_reason: null,
      requires_human: false,
      recommended_action: 'Confirmar visualmente de que prato se trata.',
      suggested_reply: 'Boa tarde. Pode confirmar-me o nome do prato? Assim evito enganos.',
      mentions_price_or_deadline: false,
      grounded_in_registered_facts: false,
    },
  },
  {
    quando: (t) => /\[localização\]|localizaç|nacala porto|coordenad/i.test(t),
    resposta: {
      priority: 'ACOMPANHAR',
      intent: 'DOCUMENTO',
      confidence: 0.79,
      summary: 'Cliente partilhou a localização de entrega.',
      urgency_reason: null,
      requires_human: false,
      recommended_action: 'Guardar a morada no perfil do cliente.',
      suggested_reply: 'Obrigado pela localização. Vou registá-la para as próximas entregas.',
      mentions_price_or_deadline: false,
      grounded_in_registered_facts: true,
    },
  },
  {
    quando: (t) => /transferênc|pagar|mpesa|depósit|comprovativ/i.test(t),
    resposta: {
      priority: 'ACOMPANHAR',
      intent: 'PAGAMENTO',
      confidence: 0.93,
      summary: 'Cliente anuncia pagamento por transferência.',
      urgency_reason: null,
      requires_human: true,
      recommended_action: 'Confirmar a entrada do valor antes de dar como pago.',
      suggested_reply:
        'Combinado. Assim que o valor entrar, confirmo por aqui. Pode enviar o comprovativo?',
      mentions_price_or_deadline: false,
      grounded_in_registered_facts: true,
    },
  },
  {
    quando: (t) => /chegou fri|reclamaç|mal confeccionad|estava estragad|péssim/i.test(t),
    resposta: {
      priority: 'IMPORTANTE',
      intent: 'RECLAMACAO',
      confidence: 0.88,
      summary: 'Reclamação sobre a qualidade da entrega anterior.',
      urgency_reason: null,
      requires_human: true,
      recommended_action: 'Pedir desculpa, apurar o que falhou e propor compensação.',
      suggested_reply:
        'Lamento muito pelo sucedido. Vou apurar o que falhou e entro em contacto ainda hoje com uma solução.',
      mentions_price_or_deadline: false,
      grounded_in_registered_facts: false,
    },
  },
];

/** Quando nada encaixa, a IA admite que não sabe — e pede uma pessoa. */
const OMISSAO = {
  priority: 'NORMAL',
  intent: 'OUTRO',
  confidence: 0.41,
  summary: 'Mensagem sem intenção clara.',
  urgency_reason: null,
  requires_human: true,
  recommended_action: 'Ler a mensagem original e responder manualmente.',
  suggested_reply: 'Boa tarde. Pode explicar-me melhor o que precisa, por favor?',
  mentions_price_or_deadline: false,
  grounded_in_registered_facts: false,
};

function analisar(prompt) {
  // Só o que vem depois do marcador é mensagem do cliente.
  const marcador = '=== MENSAGEM A ANALISAR ===';
  const indice = prompt.lastIndexOf(marcador);
  const texto = indice === -1 ? prompt : prompt.slice(indice + marcador.length);

  return (CASOS.find((caso) => caso.quando(texto)) ?? { resposta: OMISSAO }).resposta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Duplo da Graph API (envio de mensagens)
// ─────────────────────────────────────────────────────────────────────────────

let contadorEnvios = 0;
/** Mensagens "enviadas", para o script de demonstração poder mostrá-las. */
export const enviadas = [];

function lerCorpo(request) {
  return new Promise((resolve, reject) => {
    const partes = [];
    request.on('data', (parte) => partes.push(parte));
    request.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    request.on('error', reject);
  });
}

const servidor = createServer(async (request, response) => {
  const corpo = await lerCorpo(request);
  const json = (codigo, dados) => {
    response.writeHead(codigo, { 'content-type': 'application/json' });
    response.end(JSON.stringify(dados));
  };

  // Anthropic: POST /v1/messages
  if (request.url === '/v1/messages' && request.method === 'POST') {
    const pedido = JSON.parse(corpo || '{}');
    const prompt = JSON.stringify(pedido.messages ?? []);
    const analise = analisar(prompt);

    console.log(`[anthropic] ${analise.priority}/${analise.intent} (${analise.confidence})`);

    return json(200, {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: pedido.model ?? 'claude-sonnet-4',
      // A API real é chamada com `tool_choice` forçado, por isso a resposta
      // vem sempre como `tool_use` — nunca como texto livre. O duplo tem de
      // respeitar isso, senão não estaria a testar o cliente a sério.
      content: [
        {
          type: 'tool_use',
          id: `toolu_${Date.now()}`,
          name: 'registar_analise',
          input: analise,
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 800, output_tokens: 180 },
    });
  }

  // Graph API: POST /v21.0/<phone_number_id>/messages
  if (/^\/v\d+\.\d+\/\d+\/messages$/.test(request.url ?? '') && request.method === 'POST') {
    const pedido = JSON.parse(corpo || '{}');
    const texto = pedido.text?.body ?? '';
    contadorEnvios += 1;

    // Um número combinado para se poder ver o tratamento de erros.
    if (pedido.to === '258840000000') {
      console.log('[meta] RECUSADO (número de teste inválido)');
      return json(400, {
        error: {
          message: 'Recipient phone number not in allowed list',
          code: 131030,
        },
      });
    }

    const waMessageId = `wamid.DEMO_ENVIO_${contadorEnvios}`;
    enviadas.push({ to: pedido.to, body: texto, waMessageId });

    console.log(`[meta] → ${pedido.to}: ${texto.slice(0, 70)}${texto.length > 70 ? '...' : ''}`);

    return json(200, {
      messaging_product: 'whatsapp',
      contacts: [{ input: pedido.to, wa_id: pedido.to }],
      messages: [{ id: waMessageId, message_status: 'accepted' }],
    });
  }

  json(404, {
    error: { message: `sem duplo para ${request.method} ${request.url}` },
  });
});

servidor.listen(PORT, '0.0.0.0', () => {
  console.log(`Duplos locais (Anthropic + Meta) à escuta em http://0.0.0.0:${PORT}`);
});
