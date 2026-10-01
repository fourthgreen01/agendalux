-- Salão Bella Hair — beleza feminina  (rode no SQL Editor do Supabase)
-- acesso do gestor: contato@bellahair.com.br  /  senha: Vitalis@2026

-- 1) a empresa (slug = endereço da página)
insert into public.tenants (slug, name, tagline, phone, phone_e164, address, instagram, hours, is_active)
values (
  'salao-bella-hair',
  'Salão Bella Hair',
  'Cabelo, unhas & maquiagem',
  '(11) 3555-1234',
  '551135551234',
  'Av. Rebouças, 1420 — Pinheiros, São Paulo/SP',
  '@salaobellahair',
  '{"0":{"open":false,"from":"09:00","to":"14:00","slot":30},
    "1":{"open":false,"from":"09:00","to":"19:00","slot":30},
    "2":{"open":true,"from":"09:00","to":"19:00","slot":30},
    "3":{"open":true,"from":"09:00","to":"19:00","slot":30},
    "4":{"open":true,"from":"09:00","to":"20:00","slot":30},
    "5":{"open":true,"from":"09:00","to":"20:00","slot":30},
    "6":{"open":true,"from":"08:00","to":"17:00","slot":30}}'::jsonb,
  true
)
on conflict (slug) do nothing;

-- 2) o administrador dela (mesmo hash da Vitalis — mesma senha)
insert into public.users (tenant_id, email, name, password_hash, role)
select t.id, 'contato@bellahair.com.br', 'Ana Beatriz Lima',
       'pbkdf2$sha256$150000$Ns2ZerDlXKSOgdLMzlHD8Q$JONgJWD7kByruTUrTdYljpz9Hvw_HHO2mc84gsJYhcY',
       'admin'
from public.tenants t
where t.slug = 'salao-bella-hair'
  and not exists (
    select 1 from public.users u
    where u.tenant_id = t.id and lower(u.email) = 'contato@bellahair.com.br'
  );

-- 3) serviços
insert into public.services (tenant_id, name, description, price, duration_min, sort_order)
select t.id, v.name, v.description, v.price, v.duration_min, v.sort_order
from public.tenants t
cross join (values
  ('Corte Feminino',        'Lavagem, corte e finalização', 90.00, 60, 1),
  ('Escova / Penteados',    'Escova simples ou presilhado para eventos', 70.00, 45, 2),
  ('Coloração',             'Coloração completa com matização', 220.00, 120, 3),
  ('Mechas / Ombré',        'Descoloração com platinado ou degradê', 380.00, 180, 4),
  ('Hidratação & Reconstrução', 'Tratamento profundo para cabelos ressecados', 120.00, 60, 5),
  ('Manicure',              'Unhas das mãos com esmaltação', 45.00, 40, 6),
  ('Pedicure',              'Unhas dos pés, cutículas e esmaltação', 55.00, 50, 7),
  ('Maquiagem',             'Maquiagem social / festa', 150.00, 60, 8)
) as v(name, description, price, duration_min, sort_order)
where t.slug = 'salao-bella-hair'
  and not exists (select 1 from public.services s where s.tenant_id = t.id);

-- 4) equipe
insert into public.staff (tenant_id, name, role, sort_order)
select t.id, v.name, v.role, v.sort_order
from public.tenants t
cross join (values
  ('Ana Beatriz Lima', 'Cabeleireira', 1),
  ('Juliana Castro',   'Colorista', 2),
  ('Patrícia Souza',   'Manicure & Maquiadora', 3)
) as v(name, role, sort_order)
where t.slug = 'salao-bella-hair'
  and not exists (select 1 from public.staff s where s.tenant_id = t.id);
