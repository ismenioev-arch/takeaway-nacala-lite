/**
 * Prepara a base de dados para a demonstração.
 *
 * Cria o utilizador que faz login, o contexto da empresa (sem o qual a IA
 * nunca pode responder sozinha, porque não teria em que se ancorar) e as
 * definições que ligam a automação.
 *
 *   node --import tsx wim/demo/seed-demo.mjs
 */
import argon2 from 'argon2';
import { getPool, closePool } from '../backend/src/database/pool.js';

const EMAIL = process.env.DEMO_EMAIL ?? 'dono@nacala.mz';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'SenhaDemo#2026';

const pool = getPool();

// ── Utilizador ───────────────────────────────────────────────────────────
// O CLI interactivo (`create-user`) não é automatizável: o prompt da
// password ignora pipes. Aqui faz-se o mesmo, com o mesmo algoritmo.
const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

const { rows } = await pool.query(
  `INSERT INTO users (email, name, role, password_hash, is_active)
   VALUES ($1, 'Dona Amélia', 'OWNER', $2, true)
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true
   RETURNING id`,
  [EMAIL, hash],
);
console.log(`Utilizador ${EMAIL} pronto (${rows[0].id}).`);

// ── Contexto da empresa ──────────────────────────────────────────────────
// É a diferença entre uma IA que inventa e uma que responde. Sem isto,
// nenhuma resposta passa o teste de ancoragem e nada fica em AUTO.
await pool.query(
  `INSERT INTO company_profile
     (id, name, description, location, business_hours, contact_phone,
      policies, service_rules, auto_reply_enabled)
   VALUES (1, 'Takeaway Nacala',
           'Refeições preparadas, entregas ao domicílio e catering para eventos em Nacala.',
           'Nacala Porto, Nampula',
           '{"segunda-domingo": "11h-21h"}'::jsonb,
           '+258 84 000 0000',
           'Pagamento em dinheiro, M-Pesa ou transferência. Catering exige 50% de sinal.',
           'Entregas das 11h às 21h em Nacala Porto, Nacala Velha, Bairro Triângulo e Maiaia. Entrega gratuita acima de 1500 MT. Tratamento formal, português de Moçambique, respostas curtas.',
           true)
   ON CONFLICT (id) DO UPDATE SET
     name = EXCLUDED.name,
     description = EXCLUDED.description,
     location = EXCLUDED.location,
     business_hours = EXCLUDED.business_hours,
     policies = EXCLUDED.policies,
     service_rules = EXCLUDED.service_rules,
     auto_reply_enabled = true`,
);
console.log('Contexto da empresa pronto.');

// ── Serviços e preços ────────────────────────────────────────────────────
// Só os preços com `is_authorized_for_ai` chegam ao prompt. Os outros são
// invisíveis para a IA — é a regra que a impede de inventar valores.
const servicos = [
  ['Refeições diárias', 'Marmitas e pratos do dia, entrega ao domicílio.'],
  ['Catering para eventos', 'Catering completo para casamentos, reuniões e festas.'],
];

for (const [nome, descricao] of servicos) {
  await pool.query(
    `INSERT INTO company_services (name, description) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description`,
    [nome, descricao],
  );
}

const { rows: svc } = await pool.query(`SELECT id, name FROM company_services`);
const idDe = (nome) => svc.find((s) => s.name === nome)?.id;

const precos = [
  ['Catering para eventos', 'Catering 50 pessoas', 18000, true],
  ['Refeições diárias', 'Marmita individual', 350, true],
  // Deliberadamente não autorizado: a IA não o pode mencionar.
  ['Catering para eventos', 'Preço interno de custo', 9000, false],
];

for (const [servico, etiqueta, valor, autorizado] of precos) {
  await pool.query(
    `INSERT INTO company_prices (service_id, label, amount, is_authorized_for_ai)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [idDe(servico), etiqueta, valor, autorizado],
  );
}
console.log(`Serviços e preços prontos (${precos.filter((p) => p[3]).length} visíveis para a IA).`);

// ── Definições ───────────────────────────────────────────────────────────
for (const [chave, valor] of [
  ['ai.automation_enabled', 'true'],
  ['ai.confidence_threshold', '0.85'],
]) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [chave, valor],
  );
}
console.log('Definições prontas (automação ligada, limiar 0.85).');

await closePool();
