-- Clínica Vitalis — Fisioterapia & Pilates  (rode no SQL Editor do Supabase)
-- acesso do gestor: contato@clinicavitalis.com.br  /  senha: Vitalis@2026

-- 1) a empresa (slug = endereço da página)
insert into public.tenants (slug, name, tagline, phone, phone_e164, address, instagram, hours, is_active)
values (
  'clinica-vitalis',
  'Clínica Vitalis',
  'Fisioterapia & Pilates',
  '(11) 3456-7890',
  '551134567890',
  'Rua das Acácias, 215 — Vila Mariana, São Paulo/SP',
  '@clinicavitalis',
  '{"0":{"open":false,"from":"09:00","to":"13:00","slot":30},
    "1":{"open":true,"from":"07:00","to":"20:00","slot":30},
    "2":{"open":true,"from":"07:00","to":"20:00","slot":30},
    "3":{"open":true,"from":"07:00","to":"20:00","slot":30},
    "4":{"open":true,"from":"07:00","to":"20:00","slot":30},
    "5":{"open":true,"from":"07:00","to":"19:00","slot":30},
    "6":{"open":true,"from":"08:00","to":"13:00","slot":30}}'::jsonb,
  true
)
on conflict (slug) do nothing;

-- 2) o administrador dela
insert into public.users (tenant_id, email, name, password_hash, role)
select t.id, 'contato@clinicavitalis.com.br', 'Dra. Marina Okuda',
       'pbkdf2$sha256$150000$Ns2ZerDlXKSOgdLMzlHD8Q$JONgJWD7kByruTUrTdYljpz9Hvw_HHO2mc84gsJYhcY',
       'admin'
from public.tenants t
where t.slug = 'clinica-vitalis'
  and not exists (
    select 1 from public.users u
    where u.tenant_id = t.id and lower(u.email) = 'contato@clinicavitalis.com.br'
  );

-- 3) serviços
insert into public.services (tenant_id, name, description, price, duration_min, sort_order)
select t.id, v.name, v.description, v.price, v.duration_min, v.sort_order
from public.tenants t
cross join (values
  ('Avaliação Fisioterapêutica', 'Anamnese, postura e plano de tratamento', 120.00, 50, 1),
  ('Sessão de Fisioterapia',     'Terapia manual, liberação miofascial e exercícios', 90.00, 45, 2),
  ('Pilates Individual',         'Aula no studio, 1 professor para 1 aluno', 110.00, 50, 3),
  ('Drenagem Linfática',         'Drenagem manual pós-operatória', 95.00, 60, 4),
  ('Reeducação Postural',        'Correção de desvios e fortalecimento', 85.00, 45, 5)
) as v(name, description, price, duration_min, sort_order)
where t.slug = 'clinica-vitalis'
  and not exists (select 1 from public.services s where s.tenant_id = t.id);

-- 4) equipe
insert into public.staff (tenant_id, name, role, sort_order)
select t.id, v.name, v.role, v.sort_order
from public.tenants t
cross join (values
  ('Dra. Marina Okuda', 'Fisioterapeuta', 1),
  ('Dr. Rafael Prado',  'Fisioterapeuta', 2),
  ('Camila Rocha',      'Instrutora de Pilates', 3)
) as v(name, role, sort_order)
where t.slug = 'clinica-vitalis'
  and not exists (select 1 from public.staff s where s.tenant_id = t.id);
