-- =============================================================================
-- WIM — dados de exemplo para DESENVOLVIMENTO
-- =============================================================================
-- Só para desenvolvimento e demonstração. O comando `npm run seed` recusa
-- correr com NODE_ENV=production.
--
-- Tudo é idempotente (ON CONFLICT DO NOTHING): correr duas vezes não duplica.
--
-- ⚠  Nenhum destes dados é real. Os números de telefone usam o intervalo
--    reservado para documentação e não pertencem a ninguém.
-- =============================================================================


-- ── Contexto da empresa (secção 20) ──────────────────────────────────────────
INSERT INTO company_profile (id, name, description, location, business_hours,
                             contact_phone, contact_email, policies, service_rules)
VALUES (
  1,
  'Gabinete de Engenharia (exemplo)',
  'Projectos de arquitectura e engenharia civil, acompanhamento de obra e licenciamento.',
  'Nacala, Moçambique',
  '{"seg-sex": "08:00-17:00", "sab": "08:00-12:00", "dom": "encerrado"}'::jsonb,
  '+258840000000',
  'geral@exemplo.co.mz',
  'Orçamentos válidos por 30 dias. Alterações ao projecto depois do início da obra são orçamentadas à parte.',
  'Responder em menos de 24 horas úteis. Assuntos de obra parada têm prioridade absoluta.'
)
ON CONFLICT (id) DO NOTHING;


-- ── Serviços ─────────────────────────────────────────────────────────────────
INSERT INTO company_services (id, name, description, display_order) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Projecto de arquitectura',
   'Anteprojecto, projecto de execução e peças desenhadas.', 1),
  ('a0000000-0000-4000-8000-000000000002', 'Projecto de estruturas',
   'Dimensionamento de fundações, pilares, vigas e lajes.', 2),
  ('a0000000-0000-4000-8000-000000000003', 'Fiscalização de obra',
   'Acompanhamento técnico e verificação da execução.', 3),
  ('a0000000-0000-4000-8000-000000000004', 'Licenciamento',
   'Instrução e submissão de processos junto das entidades competentes.', 4)
ON CONFLICT (id) DO NOTHING;


-- ── Preços ───────────────────────────────────────────────────────────────────
-- Repare na coluna is_authorized_for_ai: só as duas primeiras linhas serão
-- alguma vez enviadas à IA. As outras existem no sistema mas são invisíveis
-- para ela, porque dependem de negociação (secções 7 e 20).
INSERT INTO company_prices (service_id, label, amount, currency, is_authorized_for_ai, notes) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Visita técnica inicial',
   5000.00, 'MZN', true,  'Valor fixo, pode ser comunicado pela IA.'),
  ('a0000000-0000-4000-8000-000000000004', 'Instrução de processo de licenciamento',
   15000.00, 'MZN', true,  'Valor de tabela, pode ser comunicado pela IA.'),
  ('a0000000-0000-4000-8000-000000000001', 'Projecto de moradia (por m2)',
   850.00, 'MZN', false, 'NÃO autorizado: depende da área e da complexidade.'),
  ('a0000000-0000-4000-8000-000000000003', 'Fiscalização mensal',
   40000.00, 'MZN', false, 'NÃO autorizado: depende da dimensão da obra.')
ON CONFLICT DO NOTHING;


-- ── Perguntas frequentes ─────────────────────────────────────────────────────
INSERT INTO company_faqs (question, answer, keywords, display_order) VALUES
  ('Qual é o horário de atendimento?',
   'Segunda a sexta das 08h00 às 17h00, e sábado das 08h00 às 12h00.',
   ARRAY['horário', 'horario', 'aberto', 'atendimento'], 1),
  ('Onde ficam localizados?',
   'Estamos em Nacala. Marcamos visita ao local da obra sempre que necessário.',
   ARRAY['onde', 'localização', 'localizacao', 'morada', 'endereço'], 2),
  ('Que serviços oferecem?',
   'Projectos de arquitectura e de estruturas, fiscalização de obra e licenciamento.',
   ARRAY['serviços', 'servicos', 'fazem', 'oferecem'], 3),
  ('Quanto tempo demora um projecto?',
   'Depende da dimensão. Após a visita técnica indicamos um prazo concreto.',
   ARRAY['prazo', 'demora', 'tempo', 'quando'], 4)
ON CONFLICT DO NOTHING;


-- ── Etiquetas ────────────────────────────────────────────────────────────────
INSERT INTO tags (name, color) VALUES
  ('Obra',          '#dc2626'),
  ('Orçamento',     '#ea580c'),
  ('Licenciamento', '#0891b2'),
  ('Pagamento',     '#16a34a')
ON CONFLICT (name) DO NOTHING;


-- ── Contactos de exemplo ─────────────────────────────────────────────────────
-- Números do intervalo reservado para documentação (não existem).
INSERT INTO contacts (id, wa_id, phone_e164, profile_name, display_name, company, category) VALUES
  ('c0000000-0000-4000-8000-000000000001', '258840000001', '+258840000001',
   'João', 'João Macuácua', 'Construções Exemplo, Lda', 'CLIENTE'),
  ('c0000000-0000-4000-8000-000000000002', '258840000002', '+258840000002',
   'Ana', 'Ana Sitoe', NULL, 'PROSPECT'),
  ('c0000000-0000-4000-8000-000000000003', '258840000003', '+258840000003',
   'Fornecedor Cimento', 'Cimentos Exemplo', 'Cimentos Exemplo, SA', 'FORNECEDOR')
ON CONFLICT (wa_id) DO NOTHING;
