/**
 * Preparação do ambiente de testes.
 *
 * Corre antes de qualquer teste. Aponta a aplicação para a base de dados de
 * testes (`wim_test`), que é separada da de desenvolvimento — nenhum teste
 * pode apagar dados reais.
 */
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';

process.env['DATABASE_URL'] ??=
  'postgresql://wim:wim_dev_password@127.0.0.1:5432/wim_test';

// Segredos fixos e sem valor real: os testes precisam de assinar e verificar
// tokens, e valores estáveis tornam as falhas reproduzíveis.
process.env['JWT_ACCESS_SECRET'] ??= 'segredo-de-teste-para-acesso-nao-usar-em-producao';
process.env['JWT_REFRESH_SECRET'] ??= 'segredo-de-teste-para-refresh-nao-usar-em-producao';

/** Ligação usada pelos testes de integração. */
export const TEST_DATABASE_URL = process.env['DATABASE_URL'];

// Nos testes todos os pedidos vêm do mesmo endereço, por isso o limite por IP
// dispararia antes do travão por conta e esconderia o que queremos testar.
// O bloqueio por conta continua activo e é esse que os testes exercitam.
process.env['LOGIN_RATE_LIMIT_MAX'] ??= '1000';
