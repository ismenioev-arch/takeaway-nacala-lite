/**
 * Servidor de pré-visualização: painel e API no mesmo endereço.
 *
 * Reproduz localmente o que a Vercel faz em produção — estático a servir
 * `frontend/dist`, e tudo o que começa por `/api` entregue à mesma função
 * que lá corre. Assim o que se vê aqui é o que se vê lá, incluindo a
 * ausência de CORS entre o browser e a API.
 *
 *   npm run build --workspace @wim/frontend
 *   node --import tsx wim/demo/preview.mjs
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ESTATICO = join(RAIZ, 'frontend', 'dist');
const PORTA = Number(process.env.DEMO_PORT ?? 4000);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

if (!existsSync(ESTATICO)) {
  console.error(`Falta o painel compilado em ${ESTATICO}.`);
  console.error('Corra primeiro: npm run build --workspace @wim/frontend');
  process.exit(1);
}

// A função serverless é importada do próprio código de produção: é o
// mesmo ficheiro que a Vercel executa.
const { default: handler } = await import('../api/index.ts');

const servidor = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (url.pathname.startsWith('/api')) {
    try {
      await handler(request, response);
    } catch (erro) {
      console.error('[api]', erro);
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            error: { message: 'erro interno na pré-visualização' },
          }),
        );
      }
    }
    return;
  }

  // `normalize` evita que `../../` saia da pasta do painel.
  const relativo = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let ficheiro = join(ESTATICO, relativo);

  // Rotas do React (/aprovacoes, /conversas, ...) não são ficheiros:
  // devolve-se o index e o router trata do resto.
  if (!existsSync(ficheiro) || statSync(ficheiro).isDirectory()) {
    ficheiro = join(ESTATICO, 'index.html');
  }

  response.writeHead(200, {
    'content-type': TIPOS[extname(ficheiro)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(ficheiro).pipe(response);
});

servidor.listen(PORTA, '0.0.0.0', () => {
  console.log(`WIM — pré-visualização em http://0.0.0.0:${PORTA}`);
});
