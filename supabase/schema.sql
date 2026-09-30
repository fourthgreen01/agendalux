/* ═══════════════════════════════════════════════════════════════════
   AGENDALUX · SCHEMA SUPABASE (multi-tenant)
   Execute no SQL Editor do Supabase, de cima para baixo.

   COMO CRIAR UM ADMIN (não existe tela para isso, é só no banco):
     insert into public.users (tenant_id, email, name, password_hash, role)
     values (
       (select id from public.tenants where slug = 'barbearia-do-luiz'),
       'dono@exemplo.com',
       'Luiz',
       '<cole aqui o hash gerado pela API: POST /api/auth?action=hash>',
       'admin'
     );
   ═══════════════════════════════════════════════════════════════════ */

create extension if not exists pgcrypto;

/* ─────────────────────────── TENANTS (empresas) ───────────────────── */
create table if not exists public.tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique
                check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  name          text not null check (char_length(name) between 2 and 80),
  tagline       text not null default '',
  phone         text not null default '',            -- formato de exibição (11) 98765-4321
  phone_e164    text not null default '',            -- SÓ DÍGITOS com DDI: 5511987654321  (Baileys/WhatsApp)
  whatsapp_e164 text not null default '',            -- se diferente do phone; vazio = usa phone_e164
  country       text not null default 'BR' check (char_length(country) = 2),
  timezone      text not null default 'America/Sao_Paulo',
  address       text not null default '',
  instagram     text not null default '',
  facebook      text not null default '',
  logo_url      text,
  theme         jsonb not null default '{}'::jsonb,
  amenities     jsonb not null default '[]'::jsonb,
  hours         jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists tenants_active_idx on public.tenants (is_active);
/* só pode existir UM tenant padrão */
create unique index if not exists tenants_single_default
  on public.tenants ((is_default)) where (is_default);

/* ─────────────────────────── USERS ────────────────────────────────── */
create table if not exists public.users (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  email          text not null,
  name           text not null check (char_length(name) between 2 and 80),
  phone          text not null default '',
  phone_e164     text not null default '',
  password_hash  text,                     -- pbkdf2$sha256$<iter>$<salt>$<hash>
  role           text not null default 'customer' check (role in ('customer','admin')),
  is_active      boolean not null default true,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists users_tenant_email_uniq
  on public.users (tenant_id, lower(email));
create index if not exists users_tenant_role_idx on public.users (tenant_id, role);

/* ─────────────────────────── STAFF (atendentes) ───────────────────── */
create table if not exists public.staff (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 80),
  role          text not null default 'Profissional',
  photo_url     text,                                   -- Supabase Storage (public)
  phone         text not null default '',
  phone_e164    text not null default '',               -- Baileys
  whatsapp_ready boolean not null default false,        -- número confirmado no WhatsApp
  active        boolean not null default true,
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists staff_tenant_idx on public.staff (tenant_id, active);

/* ─────────────────────────── SERVICES ─────────────────────────────── */
create table if not exists public.services (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null check (char_length(name) between 2 and 80),
  description  text not null default '',
  price        numeric(10,2) not null default 0 check (price >= 0 and price <= 999999),
  duration_min int not null default 30 check (duration_min between 5 and 600),
  active       boolean not null default true,
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists services_tenant_idx on public.services (tenant_id, active);

/* ─────────────────────────── BOOKINGS ─────────────────────────────── */
create table if not exists public.bookings (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  service_id     uuid references public.services(id) on delete set null,
  staff_id       uuid references public.staff(id)   on delete set null,
  customer_id    uuid references public.users(id)   on delete set null,
  service_name   text not null,
  staff_name     text not null,
  price          numeric(10,2) not null default 0 check (price >= 0),
  duration_min   int not null default 30,
  date           date not null,
  time           text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  customer_name  text not null check (char_length(customer_name) between 2 and 80),
  customer_phone text not null default '',
  phone_e164     text not null default '',             -- Baileys
  customer_email text not null default '',
  payment        text not null default 'cash' check (payment in ('pix','card','cash')),
  notes          text not null default '',
  status         text not null default 'confirmado'
                 check (status in ('pago','confirmado','concluido','cancelado','nao_compareceu')),
  source         text not null default 'site',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

/* impede duplo agendamento do mesmo profissional no mesmo horário */
create unique index if not exists bookings_no_double
  on public.bookings (tenant_id, staff_id, date, time)
  where status <> 'cancelado';

create index if not exists bookings_tenant_date_idx on public.bookings (tenant_id, date);
create index if not exists bookings_tenant_status_idx on public.bookings (tenant_id, status);
create index if not exists bookings_customer_idx on public.bookings (customer_id);

/* ─────────────────────────── SESSIONS ─────────────────────────────── */
create table if not exists public.sessions (
  token_hash  text primary key,           -- SHA-256 do token (nunca o token puro)
  user_id     uuid not null references public.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  expires_at  timestamptz not null,
  ip          text not null default '',
  user_agent  text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists sessions_expires_idx on public.sessions (expires_at);

/* ─────────────────────────── AUDIT LOG ────────────────────────────── */
create table if not exists public.audit_log (
  id         bigserial primary key,
  tenant_id  uuid,
  user_id    uuid,
  action     text not null,
  entity     text not null default '',
  entity_id  text not null default '',
  meta       jsonb not null default '{}'::jsonb,
  ip         text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists audit_tenant_idx on public.audit_log (tenant_id, created_at desc);

/* ─────────────────── FILA DE MENSAGENS (futuro Baileys) ───────────── */
create table if not exists public.message_queue (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  booking_id    uuid references public.bookings(id) on delete cascade,
  to_e164       text not null check (to_e164 ~ '^[1-9][0-9]{7,14}$'),
  kind          text not null default 'reminder'
                check (kind in ('reminder','confirm','cancel','custom')),
  body          text not null,
  scheduled_for timestamptz not null default now(),
  status        text not null default 'pending'
                check (status in ('pending','sent','failed','cancelled')),
  attempts      int not null default 0,
  last_error    text not null default '',
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists mq_ready_idx on public.message_queue (status, scheduled_for);
create index if not exists mq_tenant_idx on public.message_queue (tenant_id, status);

/* ─────────────────── PHONE: E.164 (necessário p/ Baileys) ─────────── */
create or replace function public.to_e164(p text, country text default 'BR')
returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p,''), '\D', '', 'g');
begin
  if d = '' then return ''; end if;
  if country = 'BR' then
    if d like '0%' then d := substr(d, 2); end if;          -- remove DDD com 0: 011...
    if d like '55%' and char_length(d) in (12,13) then return d; end if;
    if char_length(d) in (10,11) then return '55' || d; end if;
    return d;
  end if;
  return d;
end $$;

create or replace function public.normalize_tenant_phones() returns trigger
language plpgsql as $$
begin
  new.phone_e164 := public.to_e164(coalesce(nullif(new.phone,''), new.phone_e164), new.country);
  if coalesce(new.whatsapp_e164,'') <> '' then
    new.whatsapp_e164 := public.to_e164(new.whatsapp_e164, new.country);
  end if;
  return new;
end $$;
drop trigger if exists tenants_normalize on public.tenants;
create trigger tenants_normalize before insert or update on public.tenants
  for each row execute function public.normalize_tenant_phones();

create or replace function public.normalize_staff_phones() returns trigger
language plpgsql as $$
declare c text;
begin
  select country into c from public.tenants where id = new.tenant_id;
  new.phone_e164 := public.to_e164(new.phone, coalesce(c,'BR'));
  return new;
end $$;
drop trigger if exists staff_normalize on public.staff;
create trigger staff_normalize before insert or update on public.staff
  for each row execute function public.normalize_staff_phones();

create or replace function public.normalize_booking_phones() returns trigger
language plpgsql as $$
declare c text;
begin
  select country into c from public.tenants where id = new.tenant_id;
  new.phone_e164 := public.to_e164(new.customer_phone, coalesce(c,'BR'));
  new.customer_name := btrim(new.customer_name);
  new.customer_email := lower(btrim(new.customer_email));
  return new;
end $$;
drop trigger if exists bookings_normalize on public.bookings;
create trigger bookings_normalize before insert or update on public.bookings
  for each row execute function public.normalize_booking_phones();

create or replace function public.normalize_user_phones() returns trigger
language plpgsql as $$
declare c text;
begin
  select country into c from public.tenants where id = new.tenant_id;
  new.phone_e164 := public.to_e164(new.phone, coalesce(c,'BR'));
  new.email := lower(btrim(new.email));
  return new;
end $$;
drop trigger if exists users_normalize on public.users;
create trigger users_normalize before insert or update on public.users
  for each row execute function public.normalize_user_phones();

/* updated_at automático */
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['tenants','users','staff','services','bookings']
  loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I
                    for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

/* ─────────── lembrete automático (2h antes) ao criar agendamento ──── */
create or replace function public.enqueue_reminder() returns trigger
language plpgsql as $$
declare tz text; when_at timestamptz;
begin
  if new.status = 'cancelado' or new.phone_e164 = '' then return new; end if;
  select timezone into tz from public.tenants where id = new.tenant_id;
  when_at := (new.date + new.time::time - interval '2 hours')
             at time zone coalesce(tz,'America/Sao_Paulo');
  insert into public.message_queue (tenant_id, booking_id, to_e164, kind, body, scheduled_for)
  values (
    new.tenant_id, new.id, new.phone_e164, 'reminder',
    format('Oi, %s! Lembrete: %s em %s às %s. Até logo!',
           split_part(new.customer_name, ' ', 1),
           new.service_name,
           to_char(new.date, 'DD/MM/YYYY'), new.time),
    greatest(when_at, now())
  )
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists bookings_enqueue_reminder on public.bookings;
create trigger bookings_enqueue_reminder after insert on public.bookings
  for each row execute function public.enqueue_reminder();

/* ─────────────────────────── VIEWS (Baileys) ──────────────────────── */
create or replace view public.v_whatsapp_contacts as
select t.slug, t.country,
       s.id as staff_id, s.name, s.phone_e164, s.whatsapp_ready, 'staff' as kind
from public.staff s join public.tenants t on t.id = s.tenant_id
where s.phone_e164 <> '' and s.active
union all
select t.slug, t.country, null, u.name, u.phone_e164, false, 'customer'
from public.users u join public.tenants t on t.id = u.tenant_id
where u.phone_e164 <> ''
union all
select t.slug, t.country, null, b.customer_name, b.phone_e164, false, 'guest'
from public.bookings b join public.tenants t on t.id = b.tenant_id
where b.phone_e164 <> '';

/* worker do Baileys lê isto: mensagens na hora de disparar */
create or replace view public.v_ready_messages as
select m.*, t.slug, t.whatsapp_e164 as from_e164, t.country
from public.message_queue m join public.tenants t on t.id = m.tenant_id
where m.status = 'pending' and m.scheduled_for <= now() and t.is_active
order by m.scheduled_for asc;

/* agendamentos que ainda vão acontecer (lembretes manuais / relatórios) */
create or replace view public.v_upcoming_bookings as
select b.*, t.slug, t.timezone,
       split_part(t.name, ' ', 1) as company_short
from public.bookings b join public.tenants t on t.id = b.tenant_id
where b.date >= (now() at time zone coalesce(t.timezone,'America/Sao_Paulo'))::date
  and b.status in ('pago','confirmado')
order by b.date, b.time;

/* ─────────────────────────── ROW LEVEL SECURITY ───────────────────── */
/* Toda a aplicação acessa pelo service_role (bypass de RLS).
   anon/authenticated NÃO têm nenhuma policy => sem acesso algum. */
alter table public.tenants      enable row level security;
alter table public.users        enable row level security;
alter table public.staff        enable row level security;
alter table public.services     enable row level security;
alter table public.bookings     enable row level security;
alter table public.sessions     enable row level security;
alter table public.audit_log    enable row level security;
alter table public.message_queue enable row level security;

/* ─────────────────────────── STORAGE ──────────────────────────────── */
insert into storage.buckets (id, name, public)
values ('assets','assets', true)
on conflict (id) do nothing;

/* nenhuma policy pública de escrita: upload só via service_role */
drop policy if exists "assets read" on storage.objects;
create policy "assets read" on storage.objects for select
  using (bucket_id = 'assets');

/* ─────────────────────────── SEED (tenant padrão) ─────────────────── */
insert into public.tenants (slug, name, tagline, phone, phone_e164, address, is_default, hours, theme, amenities)
values (
  'atelier-solano', 'Atelier Solano', 'Barbearia & studio de bem-estar',
  '(11) 98765-4321', '5511987654321',
  'Rua Harmonia, 182 — Vila Madalena, São Paulo · SP',
  true,
  '{"0":{"open":false,"from":"09:00","to":"14:00","slot":30},
    "1":{"open":true,"from":"09:00","to":"19:00","slot":30},
    "2":{"open":true,"from":"09:00","to":"19:00","slot":30},
    "3":{"open":true,"from":"09:00","to":"19:00","slot":30},
    "4":{"open":true,"from":"09:00","to":"20:00","slot":30},
    "5":{"open":true,"from":"09:00","to":"20:00","slot":30},
    "6":{"open":true,"from":"09:00","to":"18:00","slot":30}}'::jsonb,
  '{"bg":"#F4EFE6","surface":"#FDFAF3","ink":"#1D1A16","accent":"#B4652E","line":"#E2D9C8"}'::jsonb,
  '[{"icon":"wifi","label":"Wi-Fi gratuito"},
    {"icon":"accessibility","label":"Acesso cadeirante"},
    {"icon":"baby","label":"Atende crianças"},
    {"icon":"coffee","label":"Cafés & bebidas"}]'::jsonb
)
on conflict (slug) do nothing;

insert into public.services (tenant_id, name, description, price, duration_min, sort_order)
select t.id, v.name, v.description, v.price, v.duration_min, v.sort_order
from public.tenants t,
lateral (values
  ('Corte Signature','Consultoria de visagismo, corte e finalização', 70, 45, 1),
  ('Corte + Barba','Corte completo com toalha quente e navalhado', 110, 75, 2),
  ('Barba Terapia','Modelagem, óleos e compressa morna', 50, 30, 3),
  ('Ritual Completo','Corte, barba, hidratação e massageamento', 160, 90, 4)
) as v(name, description, price, duration_min, sort_order)
where t.slug = 'atelier-solano'
  and not exists (select 1 from public.services s where s.tenant_id = t.id);

insert into public.staff (tenant_id, name, role, sort_order)
select t.id, v.name, v.role, v.sort_order
from public.tenants t,
lateral (values
  ('Rafael Moretti','Barbeiro sênior',1),
  ('Diego Antunes','Barbeiro',2),
  ('Larissa Prado','Colorista',3)
) as v(name, role, sort_order)
where t.slug = 'atelier-solano'
  and not exists (select 1 from public.staff s where s.tenant_id = t.id);
