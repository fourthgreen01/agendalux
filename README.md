# AgendaLux — SaaS de agendamentos (Vercel + Supabase)

Aplicação multi-tenant: cada empresa tem sua própria página e seu próprio painel.

```
https://agende-ja.site/                            → landing page (apresentação do app)
https://agendalux.vercel.app/atelier-solano        → empresa padrão
https://agendalux.vercel.app/barbearia-do-luiz     → cor, nome, equipe e horários próprios
https://agendalux.vercel.app/barbearia-do-lucas    → completamente diferente
```

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html` | **landing page** da raiz (`/`) — apresenta o app e o teste grátis de 15 dias |
| `app.html` + `splash.js` | SPA do multi-tenant e **tela de carregamento** (com erro + "Tentar novamente") |
| `styles.css` | todo o visual |
| `config.js` | estado global, camada de dados (API primeiro, demonstração local como fallback) |
| `app.js` | site público, agendamento em etapas, WhatsApp, login/cadastro |
| `admin.js` | painel: serviços, **foto do atendente**, horários, aparência, **slug** |
| `api/**` | funções serverless (validação, autenticação, banco) |
| `supabase/schema.sql` | banco de dados completo |
| `vercel.json` | rewrites da SPA + cabeçalhos de segurança (CSP, HSTS…) |

## 1. Banco (Supabase)

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Em **SQL Editor**, cole todo o conteúdo de `supabase/schema.sql` e execute.
3. Em **Settings → API**, copie:
   - `Project URL`
   - `service_role` (secreta — nunca vai para o navegador)

O script cria a empresa padrão (`/atelier-solano`), serviços, equipe, buckets de imagem,
índices, RLS travado e a fila de mensagens para o Baileys.

## 2. Criar um administrador

Não existe tela de criação de administrador: **o admin nasce no banco**.

```sql
-- gere o hash da senha (uma vez)
--   POST  /api/auth?action=hash   {"password":"SuaSenha123"}
--   ou localmente:
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('base64url');
console.log('pbkdf2\$sha256\$150000\$'+s+'\$'+
c.pbkdf2Sync('SuaSenha123',s,150000,32,'sha256').toString('base64url'))"
```

```sql
insert into public.users (tenant_id, email, name, password_hash, role)
values (
  (select id from public.tenants where slug = 'atelier-solano'),
  'dono@empresa.com',
  'Nome do Dono',
  'pbkdf2$sha256$150000$...$...',
  'admin'
);
```

Depois é só entrar em `https://agendalux.vercel.app/atelier-solano` → **Acesso do gestor**.

### 2.1 Criar outra empresa (SQL)

Uma empresa nova = 1 insert em `tenants` + 1 insert em `users`. No mesmo segundo,
`/slug-novo` já está no ar — serviços, equipe e horários o dono cadastra pelo painel.

```sql
-- 1) a empresa (slug = endereço da página)
insert into public.tenants (slug, name, tagline, is_active)
values ('barbearia-do-luiz', 'Barbearia do Luiz', 'Corte & barba', true)
on conflict (slug) do nothing;

-- 2) o administrador dela (gere o hash em /api/auth?action=hash)
insert into public.users (tenant_id, email, name, password_hash, role)
select t.id, 'dono@exemplo.com', 'Luiz',
       '<cole o hash aqui>', 'admin'
from public.tenants t where t.slug = 'barbearia-do-luiz';

-- 3) expediente mínimo (sem horário o site marca como "fechado")
update public.tenants set hours =
  '{"0":{"open":false,"from":"09:00","to":"14:00","slot":30},
    "1":{"open":true,"from":"09:00","to":"19:00","slot":30},
    "2":{"open":true,"from":"09:00","to":"19:00","slot":30},
    "3":{"open":true,"from":"09:00","to":"19:00","slot":30},
    "4":{"open":true,"from":"09:00","to":"20:00","slot":30},
    "5":{"open":true,"from":"09:00","to":"20:00","slot":30},
    "6":{"open":true,"from":"09:00","to":"18:00","slot":30}}'::jsonb
where slug = 'barbearia-do-luiz';

-- 4) (opcional) serviços e equipe já com o primeiro atendente
insert into public.services (tenant_id, name, description, price, duration_min, sort_order)
select t.id, 'Corte', 'Corte e finalização', 60, 45, 1
from public.tenants t where t.slug = 'barbearia-do-luiz'
  and not exists (select 1 from public.services s where s.tenant_id = t.id);

insert into public.staff (tenant_id, name, role, sort_order)
select t.id, 'Luiz', 'Barbeiro', 1
from public.tenants t where t.slug = 'barbearia-do-luiz'
  and not exists (select 1 from public.staff s where s.tenant_id = t.id);
```

Troque `false` → `true` em `is_default` se quiser que ela seja a página da raiz
(só pode existir um; o índice único impede dois). Apagar a empresa (`delete`)
remove em cascata serviços, equipe, agendamentos e sessões.

## 3. Deploy na Vercel

As variáveis de ambiente são adicionadas **antes** do primeiro deploy — senão o app
sobe sem banco e cai no modo demonstração.

```bash
npm i -g vercel

# 1) cria/associa o projeto (pergunta nome e escopo)
vercel link

# 2) adiciona as 3 variáveis (pede o valor na hora)
npm run env:add
#   ou, uma a uma:
#   vercel env add SUPABASE_URL production
#   vercel env add SUPABASE_SERVICE_ROLE_KEY production
#   vercel env add SUPABASE_BUCKET production

# 3) só então publica
npm run deploy        # = vercel --prod
```

Alternativa pelo painel: **vercel.com/new → Import** → *Project → Settings →
Environment Variables* → adicione as 3 variáveis → volte para *Deployments* e
dê **Redeploy**.

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | `https://SEU-PROJETO.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | chave `service_role` |
| `SUPABASE_BUCKET` | `assets` |

> **Limite do plano Hobby:** no máximo **12 funções por deploy**. Por isso o back-end
> usa **7**: `public`, `availability`, `health`, `bookings`, `bookings/[id]`,
> `auth` (login/register/logout/me/hash via `?action=`) e `admin`
> (config/services/staff via `?section=`). Não adicione arquivos novos em `api/`
> sem unificar antes.

Depois de trocar uma variável, faça um **redeploy** (variáveis só valem para
deployments novos).

## 4. Roteamento multi-tenant

`vercel.json` reescreve qualquer caminho (exceto `/api/*` e a raiz) para `app.html`.
A raiz (`/`) serve a landing (`index.html`). O front lê o **slug** do endereço e chama `GET /api/public?slug=...`.
Para trocar o endereço: painel → **Aparência & página → Endereço da página (slug)**.

## 5. Modo demonstração

Se a API não responder (projeto sem Supabase, `file://`, backend fora), o app entra em
**modo demonstração**: os dados ficam só no `localStorage` e um aviso aparece na tela.
Login de demonstração nesse modo: `admin@solano.com` / `admin123`.

## 6. Telefones e Baileys (futuro)

Todo telefone é gravado em **E.164 só com dígitos** (`5511987654321`):

- `tenants.phone_e164` / `tenants.whatsapp_e164`
- `staff.phone_e164` + `staff.whatsapp_ready`
- `users.phone_e164`, `bookings.phone_e164`

Views prontas para o worker de WhatsApp:

- `v_whatsapp_contacts` — todos os números por empresa
- `v_ready_messages` — mensagens na fila, na hora de disparar
- `v_upcoming_bookings` — agendamentos futuros

A trigger já enfileira o lembrete **2 horas antes** em `message_queue`.
Basta rodar um worker Baileys que leia `v_ready_messages`, dispare e marque `status='sent'`.

## 7. Segurança já aplicada

- Senha: **PBKDF2-HMAC-SHA256**, 150.000 iterações, salt de 128 bits, comparação em tempo constante.
- Sessão: cookie `HttpOnly` + `SameSite=Lax`; no banco fica apenas o **SHA-256** do token.
- Rate-limit em login (8/10min), cadastro (5/h), agendamento (12/h) e hash (4/h).
- Preço, duração, existência do serviço/profissional, expediente e conflito de agenda
  são validados **no servidor** — o navegador nunca envia o valor.
- Bloqueio de CSRF por `Origin`/`Sec-Fetch-Site`, validação e sanitização de toda entrada,
  imagens conferidas por magic bytes (sem SVG/HTML), RLS travado e log de auditoria.
- Sem rota para criar administrador; admins são inseridos direto no SQL.

## Comandos úteis

```bash
npm run check      # valida a sintaxe de todos os .js
vercel dev         # roda localmente (http://localhost:3000)
```
