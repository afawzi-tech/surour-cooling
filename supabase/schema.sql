-- ==========================================================
-- مصاعد السرور / التبريد المركزي - الإصدار 4
-- التطبيق انعكاس لملف VRF QC Tracker: نفس الأوراق ونفس الأعمدة ونفس المعادلات.
--
--   projects      = الملف (مشروع واحد = ملف Excel واحد) + الحدود الصفراء في Test Records
--   units         = صفوف ورقة Villa Tracker (الفيلا، المنطقة، الفرقة، الملاحظات)
--   unit_checks   = خانات المراحل الثلاث عشرة (Pass / Fail / Pending / N/A)
--   test_records  = ورقة Test Records (سطر واحد لكل فيلا)
--   ncrs          = ورقة NCR Register
--   المعادلات (Passed، % complete، Status، Next step، Sequence alert، Dashboard) تُحسب في الواجهة
--   بنفس معادلات الملف، وتُصدَّر كمعادلات حقيقية في ملف Excel.
--
-- طريقة التشغيل: Supabase → SQL Editor → الصق الملف كاملاً → Run (آمن لإعادة التشغيل).
--
-- الأدوار:
--   admin       مدير: كل شيء، المستخدمون، الحذف، سجل العمليات
--   supervisor  مشرف: الفلل ونتائج الفحص والقراءات وNCR والحدود
--   technician  فني: يرى كل شيء ويسجّل قراءات Test Records فقط
-- ==========================================================

create extension if not exists pgcrypto;

-- ---------- المستخدمون والأدوار ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '' check (char_length(full_name) <= 120),
  role        text not null default 'technician' check (role in ('admin', 'supervisor', 'technician')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;
create or replace function public.is_staff()
returns boolean language sql stable as $$ select public.app_role() in ('admin', 'supervisor') $$;
create or replace function public.is_admin()
returns boolean language sql stable as $$ select public.app_role() = 'admin' $$;

create or replace function public.protect_self_admin()
returns trigger language plpgsql as $$
begin
  if old.id = auth.uid() and (new.role <> 'admin' or not new.active) then
    raise exception 'لا يمكنك إزالة صلاحية المدير أو تعطيل حسابك بنفسك';
  end if;
  if new.id <> old.id then raise exception 'لا يمكن تغيير المعرّف'; end if;
  return new;
end $$;
drop trigger if exists profiles_protect_self on public.profiles;
create trigger profiles_protect_self before update on public.profiles
  for each row execute function public.protect_self_admin();

-- ---------- إزالة ما لا يوجد في ملف Excel (من الإصدارات السابقة) ----------
drop view if exists public.unit_overview;
drop table if exists public.project_stages cascade;
drop table if exists public.brand_limits cascade;
-- جداول الإصدار 3 ببنية مختلفة: تُحذف فقط إذا كانت بالبنية القديمة (حتى لا تضيع بيانات عند إعادة التشغيل)
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'test_records' and column_name = 'id') then
    drop table public.test_records cascade;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ncrs' and column_name = 'ncr_no' and data_type = 'integer') then
    drop table public.ncrs cascade;
  end if;
end $$;
drop function if exists public.create_project_stages() cascade;
drop function if exists public.stage_before_update() cascade;
drop function if exists public.test_record_compute() cascade;
drop function if exists public.test_record_autofail() cascade;
drop function if exists public.readings_ok(uuid, text) cascade;
drop function if exists public.unit_check_autoncr() cascade;
drop function if exists public.ncr_before_write() cascade;

-- ---------- المشروع (الملف) ----------
create table if not exists public.projects (
  id             uuid primary key default gen_random_uuid(),
  client         text not null check (char_length(btrim(client)) between 1 and 200),   -- اسم المشروع
  contract_date  date not null default current_date,
  notes          text check (char_length(notes) <= 4000),
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.projects alter column contract_date set default current_date;
alter table public.projects drop column if exists weights;
alter table public.projects drop column if exists require_readings;
-- الخلايا الصفراء في Test Records (الصف 2)
alter table public.projects add column if not exists lim_pressure_drop numeric(6, 3) not null default 0.02;  -- B2
alter table public.projects add column if not exists lim_vacuum_max    integer      not null default 500;   -- F2
alter table public.projects add column if not exists lim_vacuum_hold   integer      not null default 60;    -- J2
alter table public.projects add column if not exists lim_charge_tol    numeric(5, 3) not null default 0.05; -- N2

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now(); new.created_by := old.created_by; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- ---------- المراحل الثلاث عشرة (أعمدة D إلى P) ----------
create table if not exists public.qc_checkpoints (
  key       text primary key,
  position  smallint not null unique,
  name_ar   text not null,
  name_en   text not null,
  itp_ref   text
);
alter table public.qc_checkpoints drop column if exists prereqs;
insert into public.qc_checkpoints (key, position, name_ar, name_en, itp_ref) values
  ('site_ready',    1,  'جاهزية الموقع',           'Site ready',                     'ITP 1.6'),
  ('equipment_set', 2,  'تركيب الأجهزة',           'Equipment set',                  'ITP 4.1-4.3'),
  ('piping',        3,  'التمديد واللحام',         'Piping and brazing',             'ITP 2.7'),
  ('pressure_test', 4,  'فحص الضغط',              'Pressure test',                  'ITP 3.4'),
  ('vacuum',        5,  'الفاكيوم',                'Vacuum',                         'ITP 3.7'),
  ('insulation',    6,  'العزل',                   'Insulation',                     'ITP 2.12'),
  ('drain_test',    7,  'فحص الدرين',              'Drain test',                     'ITP 4.7'),
  ('megger',        8,  'فحص الميغر',              'Insulation resistance (megger)', 'ITP 5.4'),
  ('addressing',    9,  'عنونة الوحدات',           'Unit addressing',                'ITP 5.7'),
  ('charging',      10, 'شحن الفريون',             'Refrigerant charging',           'ITP 6.2'),
  ('commissioning', 11, 'التشغيل التجريبي',        'Commissioning',                  'ITP 6.6'),
  ('punch_closed',  12, 'إغلاق الملاحظات',         'Punch list closed',              'ITP 6.9'),
  ('handover',      13, 'التسليم',                 'Handover',                       'ITP 6.10')
on conflict (key) do update set position = excluded.position, name_ar = excluded.name_ar,
  name_en = excluded.name_en, itp_ref = excluded.itp_ref;

-- ---------- Villa Tracker ----------
create table if not exists public.units (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  code        text not null check (char_length(btrim(code)) between 1 and 40),
  zone        text check (char_length(zone) <= 60),
  crew        text check (char_length(crew) <= 60),
  remarks     text check (char_length(remarks) <= 2000),
  created_at  timestamptz not null default now(),
  unique (project_id, code)
);
alter table public.units drop column if exists brand;
alter table public.units add column if not exists position integer not null default 0;   -- ترتيب الصف كما في الملف
create index if not exists units_project_idx on public.units (project_id, position);

create table if not exists public.unit_checks (
  unit_id       uuid not null references public.units (id) on delete cascade,
  checkpoint    text not null references public.qc_checkpoints (key),
  result        text not null default 'pending' check (result in ('pending', 'pass', 'fail', 'na')),
  notes         text check (char_length(notes) <= 2000),
  inspected_by  uuid references public.profiles (id) on delete set null,
  inspected_at  timestamptz,
  primary key (unit_id, checkpoint)
);

create or replace function public.create_unit_checks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.unit_checks (unit_id, checkpoint) select new.id, key from public.qc_checkpoints;
  return new;
end $$;
drop trigger if exists units_create_checks on public.units;
create trigger units_create_checks after insert on public.units
  for each row execute function public.create_unit_checks();

-- مثل الملف: لا منع، فقط تسجيل من غيّر ومتى (التنبيه يظهر في عمود Sequence alert)
create or replace function public.unit_check_before_update()
returns trigger language plpgsql as $$
begin
  new.unit_id := old.unit_id; new.checkpoint := old.checkpoint;
  if new.result is distinct from old.result or new.notes is distinct from old.notes then
    new.inspected_by := auth.uid(); new.inspected_at := now();
  end if;
  return new;
end $$;
drop trigger if exists unit_checks_before_update on public.unit_checks;
create trigger unit_checks_before_update before update on public.unit_checks
  for each row execute function public.unit_check_before_update();

-- ---------- Test Records (سطر واحد لكل فيلا، الأعمدة B إلى U) ----------
create table if not exists public.test_records (
  unit_id           uuid primary key references public.units (id) on delete cascade,
  system_id         text check (char_length(system_id) <= 40),        -- B
  pressure_date     date,                                              -- C
  test_pressure     numeric(7, 3),                                     -- D
  hold_hours        numeric(7, 2),                                     -- E
  start_mpa         numeric(7, 3),                                     -- F
  end_mpa           numeric(7, 3),                                     -- G
  vacuum_date       date,                                              -- J
  vacuum_microns    numeric(8, 0),                                     -- K
  vacuum_hold_min   numeric(6, 0),                                     -- L
  vacuum_rise       numeric(8, 0),                                     -- M
  charge_calc_kg    numeric(8, 2),                                     -- O
  charge_actual_kg  numeric(8, 2),                                     -- P
  cylinder_no       text check (char_length(cylinder_no) <= 60),       -- T
  inspector         text check (char_length(inspector) <= 120),        -- U
  updated_by        uuid references public.profiles (id) on delete set null,
  updated_at        timestamptz not null default now()
);

create or replace function public.test_record_stamp()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then new.unit_id := old.unit_id; end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
drop trigger if exists test_records_stamp on public.test_records;
create trigger test_records_stamp before insert or update on public.test_records
  for each row execute function public.test_record_stamp();

-- ---------- NCR Register ----------
create table if not exists public.ncrs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  ncr_no       text not null check (char_length(btrim(ncr_no)) between 1 and 40),   -- A
  date_raised  date not null default current_date,                                  -- B
  unit_id      uuid not null references public.units (id) on delete cascade,        -- C
  checkpoint   text not null references public.qc_checkpoints (key),                -- D
  description  text not null check (char_length(btrim(description)) between 1 and 2000), -- E
  responsible  text check (char_length(responsible) <= 120),                        -- F
  due_date     date,                                                                -- G
  status       text not null default 'open' check (status in ('open', 'closed')),   -- H
  date_closed  date,                                                                -- I
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists ncrs_project_idx on public.ncrs (project_id);

create or replace function public.ncr_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- الفيلا يجب أن تكون من نفس المشروع
    if not exists (select 1 from public.units where id = new.unit_id and project_id = new.project_id) then
      raise exception 'الفيلا ليست من هذا المشروع';
    end if;
    new.created_by := auth.uid(); new.created_at := now();
  else
    new.project_id := old.project_id; new.created_by := old.created_by; new.created_at := old.created_at;
    if new.unit_id <> old.unit_id and not exists (select 1 from public.units where id = new.unit_id and project_id = old.project_id) then
      raise exception 'الفيلا ليست من هذا المشروع';
    end if;
  end if;
  if new.status = 'closed' and new.date_closed is null then new.date_closed := current_date; end if;
  if new.status = 'open' then new.date_closed := null; end if;
  return new;
end $$;
drop trigger if exists ncrs_before_write on public.ncrs;
create trigger ncrs_before_write before insert or update on public.ncrs
  for each row execute function public.ncr_before_write();

-- ---------- عرض Villa Tracker (كل نتائج الفيلا في سطر واحد) ----------
create or replace view public.unit_overview with (security_invoker = true) as
select
  u.id, u.project_id, u.code, u.zone, u.crew, u.remarks, u.position, u.created_at,
  (select jsonb_object_agg(c.checkpoint, c.result) from public.unit_checks c where c.unit_id = u.id) as results
from public.units u;

-- ---------- المواد (من الإصدار السابق، غير مستخدمة في الواجهة) ----------
create table if not exists public.materials (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  unit        text check (char_length(unit) <= 40),
  qty         numeric(12, 2) check (qty is null or qty >= 0),
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

-- ---------- سجل العمليات ----------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  table_name  text not null,
  row_id      text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  d := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_log (actor, table_name, row_id, action, old_data, new_data)
  values (auth.uid(), tg_table_name, coalesce(d ->> 'id', d ->> 'unit_id', d ->> 'project_id'), tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'projects', 'units', 'test_records', 'ncrs', 'materials'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.write_audit()', t);
  end loop;
  drop trigger if exists audit_unit_checks on public.unit_checks;
  create trigger audit_unit_checks after update or delete on public.unit_checks
    for each row execute function public.write_audit();
end $$;

-- قيمة العقد من الإصدارات السابقة لم تعد في الملف
drop table if exists public.project_finance cascade;
drop function if exists public.create_project_finance() cascade;

-- ==========================================================
-- قواعد الصلاحيات (RLS)
-- ==========================================================
alter table public.profiles       enable row level security;
alter table public.projects       enable row level security;
alter table public.qc_checkpoints enable row level security;
alter table public.units          enable row level security;
alter table public.unit_checks    enable row level security;
alter table public.test_records   enable row level security;
alter table public.ncrs           enable row level security;
alter table public.materials      enable row level security;
alter table public.audit_log      enable row level security;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.app_role(), public.is_staff(), public.is_admin() to authenticated;

grant usage on schema public to authenticated;
revoke all on all tables in schema public from authenticated;
grant select, update                 on public.profiles       to authenticated;
grant select, insert, update, delete on public.projects       to authenticated;
grant select                         on public.qc_checkpoints to authenticated;
grant select, insert, update, delete on public.units          to authenticated;
grant select, update                 on public.unit_checks    to authenticated;
grant select, insert, update, delete on public.test_records   to authenticated;
grant select, insert, update, delete on public.ncrs           to authenticated;
grant select, insert, update, delete on public.materials      to authenticated;
grant select                         on public.audit_log      to authenticated;
grant select                         on public.unit_overview  to authenticated;

create or replace function pg_temp.pol(t text, name text, cmd text, using_expr text, check_expr text)
returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', name, t);
  execute format('create policy %I on public.%I for %s to authenticated %s %s', name, t, cmd,
    case when using_expr is null then '' else 'using (' || using_expr || ')' end,
    case when check_expr is null then '' else 'with check (' || check_expr || ')' end);
end $$;

do $$
declare
  member text := 'public.app_role() is not null';
  staff  text := 'public.is_staff()';
  admin  text := 'public.is_admin()';
begin
  perform pg_temp.pol('profiles', 'profiles_select', 'select', 'id = auth.uid() or ' || member, null);
  perform pg_temp.pol('profiles', 'profiles_update', 'update', admin, admin);

  perform pg_temp.pol('projects', 'projects_select', 'select', member, null);
  perform pg_temp.pol('projects', 'projects_insert', 'insert', null, staff);
  perform pg_temp.pol('projects', 'projects_update', 'update', staff, staff);
  perform pg_temp.pol('projects', 'projects_delete', 'delete', admin, null);

  perform pg_temp.pol('qc_checkpoints', 'checkpoints_select', 'select', member, null);

  perform pg_temp.pol('units', 'units_select', 'select', member, null);
  perform pg_temp.pol('units', 'units_insert', 'insert', null, staff);
  perform pg_temp.pol('units', 'units_update', 'update', staff, staff);
  perform pg_temp.pol('units', 'units_delete', 'delete', admin, null);

  perform pg_temp.pol('unit_checks', 'checks_select', 'select', member, null);
  perform pg_temp.pol('unit_checks', 'checks_update', 'update', staff, staff);

  -- Test Records: كل مستخدم مفعّل يسجّل القراءات (مثل عمود Inspector في الملف)
  perform pg_temp.pol('test_records', 'tests_select', 'select', member, null);
  perform pg_temp.pol('test_records', 'tests_insert', 'insert', null, member);
  perform pg_temp.pol('test_records', 'tests_update', 'update', member, member);
  perform pg_temp.pol('test_records', 'tests_delete', 'delete', admin, null);

  perform pg_temp.pol('ncrs', 'ncrs_select', 'select', member, null);
  perform pg_temp.pol('ncrs', 'ncrs_insert', 'insert', null, staff);
  perform pg_temp.pol('ncrs', 'ncrs_update', 'update', staff, staff);
  perform pg_temp.pol('ncrs', 'ncrs_delete', 'delete', admin, null);

  perform pg_temp.pol('materials', 'materials_select', 'select', member, null);
  perform pg_temp.pol('materials', 'materials_insert', 'insert', null, staff);
  perform pg_temp.pol('materials', 'materials_update', 'update', staff, staff);
  perform pg_temp.pol('materials', 'materials_delete', 'delete', staff, null);

  perform pg_temp.pol('audit_log', 'audit_select', 'select', admin, null);
end $$;

-- أعمدة الإصدارات السابقة غير الموجودة في الملف
alter table public.projects drop column if exists brand;
alter table public.projects drop column if exists phone;
alter table public.projects drop column if exists address;
alter table public.projects drop column if exists map_url;
alter table public.projects drop column if exists size_m2;
alter table public.projects drop column if exists floors;

-- ==========================================================
-- بعد إنشاء أول مستخدم من لوحة Supabase، اجعله مديراً:
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
-- ==========================================================
