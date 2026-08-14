# WIM — Segurança e autenticação

> **Estado:** FASE 4 concluída. Todos os endpoints exigem sessão iniciada,
> excepto `/api/health` e as rotas de entrada.

---

## 1. Como entrar

Não há registo aberto. O WIM é um painel interno, e o primeiro utilizador
cria-se no servidor:

```bash
cd wim/backend
npm run create-user
```

O primeiro utilizador fica automaticamente **proprietário** (`OWNER`). Os
seguintes criam-se no painel, por quem for `ADMIN` ou `OWNER`.

A password é pedida com o eco desligado: não fica no histórico da shell nem
visível por cima do ombro.

---

## 2. Papéis e permissões

| Papel | Pode |
|---|---|
| `OWNER` | Tudo. É o único que pode criar outro proprietário. |
| `ADMIN` | Tudo excepto criar proprietários. Gere utilizadores e apaga contactos. |
| `AGENT` | Trabalho do dia-a-dia: ver e responder a conversas, gerir contactos. |

A hierarquia é cumulativa: quem é `OWNER` pode tudo o que um `ADMIN` pode.

**Operações restritas hoje:**

- Apagar um contacto → `ADMIN` (apaga em cascata todo o histórico dessa pessoa)
- Listar e criar utilizadores → `ADMIN`
- Criar um `OWNER` → só `OWNER`

---

## 3. Passwords

**argon2id**, com os parâmetros recomendados pela OWASP: 19 MiB de memória,
2 iterações, 1 grau de paralelismo. Resiste tanto a ataques por GPU como aos
que exploram o tempo de acesso à memória.

Cada password tem um salt aleatório: duas contas com a mesma password ficam
com hashes diferentes na base de dados, e uma tabela pré-calculada não serve
de nada.

**Regras:** mínimo 12 caracteres, máximo 200, e recusa das escolhas mais
óbvias. Não exigimos símbolos nem maiúsculas — uma frase longa como
«a minha obra em nacala 2026» é mais forte *e* mais fácil de lembrar do que
`P@ssw0rd!`, e regras complicadas só levam as pessoas a escrever a password
num papel.

O máximo de 200 caracteres existe para que um pedido enorme não obrigue o
servidor a calcular um hash caríssimo.

---

## 4. Sessões

Dois tokens, com finalidades diferentes:

| | Access token | Refresh token |
|---|---|---|
| O que é | JWT assinado (HS256) | 32 bytes aleatórios |
| Duração | 15 minutos | 30 dias |
| Onde vai | Em cada pedido, no `Authorization` | Só para renovar |
| Guardado? | Em lado nenhum | Sim, **mas só o SHA-256** |

Os dois usam **segredos diferentes**. Um access token não pode ser
apresentado como refresh token, nem o contrário — e há um teste que o
confirma.

### Rotação e detecção de roubo

Cada renovação **gasta** o token antigo e emite um novo. Se um token já gasto
voltar a aparecer, só há duas explicações: ou um atacante tem uma cópia, ou o
dono está a usar uma que lhe foi roubada.

Em qualquer dos casos a resposta é a mesma — **fechar todas as sessões desse
utilizador** e obrigar a entrar de novo. O episódio fica registado na
auditoria como `auth.refresh_reuse_detected`.

Verificado de ponta a ponta: renovar, reutilizar o token antigo, e confirmar
que até a sessão recém-criada deixa de funcionar.

### Mudar a password fecha tudo

Ao mudar a password, a coluna `users.tokens_valid_from` avança para o instante
actual. Todos os access tokens emitidos antes deixam de ser aceites, mesmo
dentro do prazo de 15 minutos, e todos os refresh tokens são revogados.

Se a mudança foi motivada por suspeita de acesso indevido, deixar as outras
sessões abertas anularia o efeito da própria mudança.

> **Detalhe que importa:** o campo `iat` de um JWT só tem resolução de
> segundos. Um token emitido no mesmo segundo da mudança seria
> indistinguível de um emitido logo a seguir, e sobreviveria. Por isso o
> token leva também a emissão em **milissegundos**, e a comparação é exacta —
> sem folgas.

---

## 5. Travão de força bruta

Duas camadas, porque cada uma tapa o buraco da outra:

| Camada | Limite | Contorna-se com… |
|---|---|---|
| Por endereço (HTTP) | `LOGIN_RATE_LIMIT_MAX`, 10/min | …muitos endereços |
| **Por conta** (base de dados) | 8 falhas em 15 minutos | …nada |

A segunda é a que interessa: está guardada na base de dados, conta por e-mail,
e **nem a password correcta passa durante o bloqueio** — senão bastaria
continuar a tentar até acertar.

Também há um limite por endereço na tabela (25 falhas em 15 minutos), para o
caso de alguém atacar muitas contas a partir do mesmo sítio.

> **Se toda a equipa sair pelo mesmo IP** — um escritório atrás de um único
> router — suba `LOGIN_RATE_LIMIT_MAX`. O contador HTTP é partilhado por todos,
> e um valor baixo trancaria a equipa inteira à porta. O bloqueio por conta
> continua activo e não é afectado.

Cada tentativa fica registada em `login_attempts`, com sucesso ou sem ele.
**A password nunca é guardada**, nem sequer em caso de falha.

---

## 6. Não revelar que contas existem

Três decisões que trabalham em conjunto:

1. **Mensagem única.** Password errada e e-mail inexistente devolvem
   exactamente `E-mail ou password incorrectos.` — o mesmo texto e o mesmo
   código.

2. **Tempo de resposta igual.** Quando o e-mail não existe, verificamos a
   password contra um hash falso. Sem isso, a resposta seria visivelmente mais
   rápida e essa diferença permitiria descobrir que contas são reais.

3. **Conta desactivada é caso à parte.** Devolve 403 com uma mensagem própria,
   mas só depois de a password estar certa — quem não sabe a password não
   chega a essa informação.

---

## 7. O que a base de dados guarda

**Nada de utilizável.**

| Segredo | O que fica guardado |
|---|---|
| Password | Hash argon2id |
| Refresh token | SHA-256 (64 caracteres hexadecimais) |
| Access token | Nada — verifica-se pela assinatura |

A tabela `refresh_tokens` tem uma constraint que **recusa** qualquer valor que
não seja um SHA-256:

```sql
CHECK (token_hash ~ '^[0-9a-f]{64}$')
```

Se alguém, um dia, tentar gravar o token em claro, a base de dados recusa.
Há um teste que confirma isso.

---

## 8. Protecção dos endpoints

```
Público:      GET  /api/health
              POST /api/auth/login
              POST /api/auth/refresh
              POST /api/auth/logout

Sessão:       tudo o resto
Papel ADMIN:  DELETE /api/contacts/:id
              GET/POST /api/users
```

Um teste percorre a lista de endpoints da FASE 3 e confirma que **todos**
devolvem 401 sem sessão. Quando a autenticação foi ligada, esse teste apanhou
imediatamente as três suites que ainda não se autenticavam — que é exactamente
o que se quer de um teste destes.

### Ataques testados

| Tentativa | Resultado |
|---|---|
| Sem cabeçalho `Authorization` | 401 |
| Token inventado | 401 |
| Token assinado com outro segredo | 401 |
| Token com algoritmo `none` | 401 |
| Token expirado | 401 |
| Refresh token usado como access token | 401 |
| Emissor ou destinatário diferentes | 401 |

---

## 9. Auditoria (secção 24)

A partir da FASE 4, a auditoria sabe **quem** fez cada coisa. Antes registava
`user_id = null` («acção do sistema») porque não havia utilizador autenticado.

Acções registadas:

| Acção | Quando |
|---|---|
| `auth.login` | Entrada bem sucedida |
| `auth.login_failed` | Tentativa falhada |
| `auth.logout` | Saída |
| `auth.refresh_reuse_detected` | **Suspeita de roubo de sessão** |
| `auth.password_changed` | Password alterada |
| `auth.user_created` | Utilizador criado |
| `contact.*`, `conversation.*` | Ver [`02-API.md`](./02-API.md) |

A tabela é imutável: um gatilho recusa `UPDATE` e `DELETE`.

---

## 10. Configuração

Os segredos de sessão são **obrigatórios em qualquer ambiente** — sem eles não
é possível emitir nem verificar sessões, e o servidor recusa arrancar.

A forma simples de os gerar:

```bash
npm run setup:env
```

Cria o `.env` a partir do `.env.example` com os segredos já preenchidos, e com
permissões `600`. **Nunca sobrepõe um `.env` existente** — substituir um
segredo por engano derrubaria todas as sessões abertas.

Manualmente:

```bash
openssl rand -base64 48   # uma vez para cada, e têm de ser diferentes
```

| Variável | Para quê |
|---|---|
| `JWT_ACCESS_SECRET` | Assina os access tokens |
| `JWT_REFRESH_SECRET` | Reservado para a assinatura dos refresh tokens |
| `JWT_ACCESS_TTL` | Validade do access token (por omissão `15m`) |
| `JWT_REFRESH_TTL` | Validade da sessão (por omissão `30d`) |
| `LOGIN_RATE_LIMIT_MAX` | Logins por minuto e por endereço (por omissão `10`) |

---

## 11. O que ainda falta

- **Sem HTTPS forçado.** Em produção o sistema tem de ficar atrás de um
  proxy com TLS. Sem isso, os tokens viajam em claro.
- **Sem recuperação de password por e-mail.** Hoje, quem perde a password
  precisa de outro `ADMIN` — ou de acesso ao servidor. Envolve escolher um
  serviço de e-mail, que ainda não foi decidido.
- **Sem autenticação em dois passos.**
- **Sem limpeza automática** dos tokens expirados. A função existe
  (`purgeExpiredTokens`) mas ainda não corre sozinha.
- **O painel ainda não tem ecrã de entrada.** É a FASE 5. Por agora, a
  autenticação usa-se pela API.

---

## 12. Antes de pôr em produção

- [ ] HTTPS obrigatório (proxy com TLS à frente)
- [ ] `NODE_ENV=production` — passa a exigir os segredos do WhatsApp e da IA
- [ ] `CORS_ORIGIN` com o domínio real, não `localhost`
- [ ] Segredos num gestor de segredos, não num ficheiro `.env`
- [ ] `LOGIN_RATE_LIMIT_MAX` ajustado à forma como a equipa acede
- [ ] Cópias de segurança da base de dados
- [ ] Rotina periódica para `purgeExpiredTokens`
