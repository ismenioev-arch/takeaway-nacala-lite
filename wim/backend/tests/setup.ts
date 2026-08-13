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

/** Ligação usada pelos testes de integração. */
export const TEST_DATABASE_URL = process.env['DATABASE_URL'];
