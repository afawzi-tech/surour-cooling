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

-- "اليوم" بتوقيت بغداد، لا UTC (الخادم بتوقيت UTC، فبين 00:00 و03:00 كان اليوم يُحسب أمس)
create or replace function public.today_iq()
returns date language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

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
  -- الحساب الجديد غير مفعّل حتى يفعّله المدير (احتياطاً لو فُتح التسجيل الذاتي بالخطأ)
  insert into public.profiles (id, full_name, active)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), false)
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
returns boolean language sql stable set search_path = public as $$ select public.app_role() in ('admin', 'supervisor') $$;
create or replace function public.is_admin()
returns boolean language sql stable set search_path = public as $$ select public.app_role() = 'admin' $$;

create or replace function public.protect_self_admin()
returns trigger language plpgsql set search_path = public as $$
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
-- project_stages من الإصدار 2 ببنية مختلفة (بلا عمود checkpoint): تُحذف هي فقط، وجدول مراحل العمل الحالي يبقى ببياناته
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'project_stages')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'project_stages' and column_name = 'checkpoint') then
    drop table public.project_stages cascade;
  end if;
end $$;
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
  contract_date  date not null default public.today_iq(),
  notes          text check (char_length(notes) <= 4000),
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.projects alter column contract_date set default public.today_iq();
alter table if exists public.ncrs alter column date_raised set default public.today_iq();
alter table public.projects drop column if exists weights;
alter table public.projects drop column if exists require_readings;
-- الخلايا الصفراء في Test Records (الصف 2)
alter table public.projects add column if not exists lim_pressure_drop numeric(6, 3) not null default 0.02;  -- B2
alter table public.projects add column if not exists lim_vacuum_max    integer      not null default 500;   -- F2
alter table public.projects add column if not exists lim_vacuum_hold   integer      not null default 60;    -- J2
alter table public.projects add column if not exists lim_charge_tol    numeric(5, 3) not null default 0.05; -- N2

-- بيانات المشروع على مستوى الشركة (مشاريع بكل المحافظات وبماركات مختلفة)
alter table public.projects add column if not exists governorate text check (governorate in (
  'بغداد', 'البصرة', 'نينوى', 'أربيل', 'السليمانية', 'دهوك', 'كركوك', 'الأنبار', 'صلاح الدين', 'ديالى',
  'بابل', 'كربلاء', 'النجف', 'واسط', 'ميسان', 'ذي قار', 'المثنى', 'القادسية'));
alter table public.projects add column if not exists city text check (char_length(city) <= 80);
alter table public.projects add column if not exists brand text check (char_length(btrim(brand)) between 1 and 40);
-- compound = مجمّع سكني بعدد وحدات كبير (له قسم خاص في التطبيق)
alter table public.projects add column if not exists project_type text not null default 'houses'
  check (project_type in ('compound', 'houses', 'apartments', 'commercial', 'government', 'other'));
alter table public.projects add column if not exists unit_label text not null default 'وحدة' check (char_length(btrim(unit_label)) between 1 and 20);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
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
returns trigger language plpgsql set search_path = public as $$
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
returns trigger language plpgsql set search_path = public as $$
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
  date_raised  date not null default public.today_iq(),                                  -- B
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
  if new.status = 'closed' and new.date_closed is null then new.date_closed := public.today_iq(); end if;
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
  -- تعديل لم يغيّر شيئاً (عدا ختم الوقت) لا يُسجَّل، حتى لا يتضخّم السجل
  if tg_op = 'UPDATE' and (to_jsonb(old) - array['updated_at', 'updated_by']) = (to_jsonb(new) - array['updated_at', 'updated_by']) then
    return null;
  end if;
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
grant execute on function public.today_iq() to authenticated, service_role;
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
-- دالة admin-create-user تعمل بدور service_role على الخادم: تقرأ دور الطالب، وتضبط الملف، وتكتب في السجل
grant select, insert, update on public.profiles  to service_role;
grant insert                 on public.audit_log to service_role;
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
  -- (select …) تجعل PostgreSQL يحسب الدور مرة واحدة لكل استعلام بدل مرة لكل صف
  member text := '(select public.app_role()) is not null';
  staff  text := '(select public.is_staff())';
  admin  text := '(select public.is_admin())';
begin
  perform pg_temp.pol('profiles', 'profiles_select', 'select', 'id = (select auth.uid()) or ' || member, null);
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
  perform pg_temp.pol('materials', 'materials_delete', 'delete', admin, null);

  perform pg_temp.pol('audit_log', 'audit_select', 'select', admin, null);
end $$;

-- أعمدة الإصدارات السابقة
alter table public.projects drop column if exists phone;
alter table public.projects drop column if exists address;
alter table public.projects drop column if exists size_m2;
alter table public.projects drop column if exists floors;

-- ==========================================================
-- مراحل العمل على مستوى المشروع (للمشاريع غير المجمّعات)
-- نفس المراحل الـ13، لكل مرحلة: الحالة وتاريخ البدء والانتهاء والكوادر والملاحظات
-- ==========================================================
create table if not exists public.project_stages (
  project_id  uuid not null references public.projects (id) on delete cascade,
  checkpoint  text not null references public.qc_checkpoints (key) on update cascade,
  status      text not null default 'not_started' check (status in ('not_started', 'in_progress', 'done', 'na')),
  start_date  date,
  end_date    date,
  crew        integer check (crew is null or crew between 0 and 500),
  notes       text check (char_length(notes) <= 2000),
  updated_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (project_id, checkpoint),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- التواريخ التلقائية: "جارية" تملأ تاريخ البدء، و"مكتملة" تملأ تاريخ الانتهاء
create or replace function public.project_stage_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  -- المرحلة لا تُنقل لمشروع آخر ولا تتغيّر مرحلتها
  if tg_op = 'UPDATE' then new.project_id := old.project_id; new.checkpoint := old.checkpoint; end if;
  if new.status = 'not_started' then
    new.start_date := null; new.end_date := null;
  elsif new.status = 'in_progress' then
    new.start_date := coalesce(new.start_date, public.today_iq()); new.end_date := null;
  elsif new.status = 'done' then
    new.end_date := coalesce(new.end_date, public.today_iq());
    -- البدء لا يتجاوز الانتهاء (مرحلة بتاريخ بدء مستقبلي تُكمل اليوم بدل رسالة "قيمة غير مقبولة")
    new.start_date := least(coalesce(new.start_date, new.end_date), new.end_date);
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists project_stages_stamp on public.project_stages;
create trigger project_stages_stamp before insert or update on public.project_stages
  for each row execute function public.project_stage_stamp();

drop trigger if exists audit_project_stages on public.project_stages;
create trigger audit_project_stages after insert or update or delete on public.project_stages
  for each row execute function public.write_audit();

alter table public.project_stages enable row level security;
revoke all on public.project_stages from anon;
grant select, insert, update, delete on public.project_stages to authenticated;
drop policy if exists stages_select on public.project_stages;
create policy stages_select on public.project_stages for select to authenticated using ((select public.app_role()) is not null);
drop policy if exists stages_insert on public.project_stages;
create policy stages_insert on public.project_stages for insert to authenticated with check ((select public.is_staff()));
drop policy if exists stages_update on public.project_stages;
create policy stages_update on public.project_stages for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists stages_delete on public.project_stages;
create policy stages_delete on public.project_stages for delete to authenticated using ((select public.is_admin()));

-- ==========================================================
-- بيانات العميل والعقد ومواعيد المشروع
-- المتأخر: تاريخ التسليم فات والمشروع لم يكتمل
-- ==========================================================
alter table public.projects add column if not exists customer_name  text check (char_length(customer_name) <= 200);
alter table public.projects add column if not exists customer_phone text check (customer_phone ~ '^[0-9+ ()-]{4,30}$');
alter table public.projects add column if not exists site_address   text check (char_length(site_address) <= 300);
alter table public.projects add column if not exists map_url        text check (char_length(map_url) <= 500 and map_url ~ '^https://[^\s<>"]+$');
alter table public.projects add column if not exists start_date     date;
alter table public.projects add column if not exists due_date       date;
do $$ begin
  alter table public.projects add constraint projects_dates_ok check (due_date is null or start_date is null or due_date >= start_date);
exception when duplicate_object then null; end $$;

-- ==========================================================
-- الفرق: اسم الفرقة ورئيسها، وكل مرحلة تُسند لفرقة
-- ==========================================================
create table if not exists public.crews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(btrim(name)) between 1 and 80),
  leader      text check (char_length(leader) <= 80),
  phone       text check (phone ~ '^[0-9+ ()-]{4,30}$'),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.project_stages add column if not exists crew_id uuid references public.crews (id) on delete set null;
-- نوع المنفّذ: فرقة من فنيي الشركة، أو مقاول تنفيذ نتابع عمله
alter table public.crews add column if not exists kind text not null default 'internal' check (kind in ('internal', 'contractor'));
alter table public.crews add column if not exists governorates text[] not null default '{}' check (cardinality(governorates) <= 18);

drop trigger if exists audit_crews on public.crews;
create trigger audit_crews after insert or update or delete on public.crews
  for each row execute function public.write_audit();

alter table public.crews enable row level security;
revoke all on public.crews from anon;
grant select, insert, update, delete on public.crews to authenticated;
drop policy if exists crews_select on public.crews;
create policy crews_select on public.crews for select to authenticated using ((select public.app_role()) is not null);
drop policy if exists crews_insert on public.crews;
create policy crews_insert on public.crews for insert to authenticated with check ((select public.is_staff()));
drop policy if exists crews_update on public.crews;
create policy crews_update on public.crews for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists crews_delete on public.crews;
create policy crews_delete on public.crews for delete to authenticated using ((select public.is_admin()));

-- ==========================================================
-- فرقة وحدة المجمّع من قائمة الفرق (بدل النص الحر)
-- حتى يُحسب شغل المجمّعات في أداء الفرق والمقاولين.
-- عمود crew النصي القديم يبقى محفوظاً ولا تستعمله الواجهة.
-- ==========================================================
-- توحيد الاسم للمطابقة: أ إ آ ← ا، ة ← ه، ى ← ي، بدون تشكيل ومسافات زائدة (مثل البحث في الواجهة)
create or replace function public.name_key(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
    translate(regexp_replace(lower(coalesce(t, '')), '[\u064B-\u065F\u0670\u0640]', '', 'g'), 'أإآٱةىؤئ', 'ااااهيوي'),
    '\s+', ' ', 'g'))
$$;

do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'units' and column_name = 'crew_id') then
    alter table public.units add column crew_id uuid references public.crews (id) on delete set null;
    -- نقل لمرة واحدة: كل اسم غير موجود في القائمة تُنشأ له فرقة من الشركة، ثم تُربط الوحدات بالمطابق
    insert into public.crews (name, kind)
    select min(regexp_replace(btrim(u.crew), '\s+', ' ', 'g')), 'internal' from public.units u
    where nullif(btrim(u.crew), '') is not null
      and not exists (select 1 from public.crews c where public.name_key(c.name) = public.name_key(u.crew))
    group by public.name_key(u.crew);
    update public.units u set crew_id = c.id from public.crews c
    where nullif(btrim(u.crew), '') is not null and public.name_key(c.name) = public.name_key(u.crew);
  end if;
end $$;
create index if not exists units_crew_idx on public.units (crew_id);

create or replace view public.unit_overview with (security_invoker = true) as
select
  u.id, u.project_id, u.code, u.zone, u.crew, u.remarks, u.position, u.created_at,
  (select jsonb_object_agg(c.checkpoint, c.result) from public.unit_checks c where c.unit_id = u.id) as results,
  u.crew_id
from public.units u;

-- أداء الفرق في المجمّعات: لكل فرقة ومشروع عدد الوحدات وحالتها (نفس معادلة Villa Tracker:
-- فيها فشل إذا فشل أي بند، مكتملة إذا الناجح + لا ينطبق = كل البنود، لم تبدأ إذا لا ناجح)
create or replace view public.crew_unit_stats with (security_invoker = true) as
with k as (
  select u.id, u.project_id, u.crew_id,
    count(*) filter (where c.result = 'pass') as q,
    count(*) filter (where c.result = 'fail') as r,
    count(*) filter (where c.result = 'na')   as na,
    max(c.inspected_at) as last_at
  from public.units u left join public.unit_checks c on c.unit_id = u.id
  where u.crew_id is not null
  group by u.id
), n as (select count(*) as total from public.qc_checkpoints)
select k.crew_id, k.project_id,
  count(*)::int                                                               as units,
  count(*) filter (where k.r = 0 and k.q + k.na = n.total)::int               as done,
  count(*) filter (where k.r > 0)::int                                        as failing,
  count(*) filter (where k.r = 0 and k.q > 0 and k.q + k.na < n.total)::int   as in_progress,
  max(k.last_at)                                                              as last_at
from k cross join n
group by k.crew_id, k.project_id;
revoke all on public.crew_unit_stats from anon;
grant select on public.crew_unit_stats to authenticated;

-- ==========================================================
-- تقارير الفني: الفني عضو في فرقة، ويبلّغ عن بدء أو إكمال مرحلة مسندة لفرقته
-- مع صورة وملاحظة. التقرير طلب بانتظار موافقة المشرف، ولا يغيّر المرحلة حتى يوافق.
-- ==========================================================
alter table public.profiles add column if not exists crew_id uuid references public.crews (id) on delete set null;

-- فرقة المستخدم الحالي (إن كان مفعّلاً)
create or replace function public.my_crew()
returns uuid language sql stable security definer set search_path = public as $$
  select crew_id from public.profiles where id = auth.uid() and active
$$;

create table if not exists public.stage_requests (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null,
  checkpoint    text not null,
  action        text not null check (action in ('start', 'done')),
  note          text check (char_length(note) <= 1000),
  photo_path    text check (char_length(photo_path) <= 200),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  requested_at  timestamptz not null default now(),
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text check (char_length(review_note) <= 500),
  foreign key (project_id, checkpoint) references public.project_stages (project_id, checkpoint) on delete cascade,
  check (action <> 'done' or photo_path is not null)
);
-- طلب واحد بانتظار الموافقة لكل مرحلة
create unique index if not exists stage_requests_one_pending on public.stage_requests (project_id, checkpoint) where status = 'pending';
create index if not exists stage_requests_pending_idx on public.stage_requests (requested_at desc) where status = 'pending';

-- التحقق عند الإرسال: المرحلة مسندة لفرقة الفني، والإجراء يناسب حالتها، ومسار الصورة باسم المرسل
create or replace function public.stage_request_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.project_stages; me uuid := auth.uid(); c uuid := public.my_crew();
begin
  new.requested_by := me; new.requested_at := now(); new.status := 'pending';
  new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
  new.note := nullif(btrim(new.note), '');
  select * into s from public.project_stages where project_id = new.project_id and checkpoint = new.checkpoint;
  if not found or c is null or s.crew_id is distinct from c then
    raise exception 'هذه المرحلة غير مسندة لفرقتك' using errcode = '42501';
  end if;
  if new.action = 'start' and s.status <> 'not_started' then
    raise exception 'المرحلة بدأت من قبل';
  elsif new.action = 'done' and s.status not in ('not_started', 'in_progress') then
    raise exception 'المرحلة مكتملة أو لا تنطبق';
  end if;
  if new.photo_path is not null and new.photo_path !~ ('^' || new.project_id::text || '/' || me::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'مسار الصورة غير صالح';
  end if;
  return new;
end $$;
drop trigger if exists stage_requests_check on public.stage_requests;
create trigger stage_requests_check before insert on public.stage_requests
  for each row execute function public.stage_request_check();

drop trigger if exists audit_stage_requests on public.stage_requests;
create trigger audit_stage_requests after insert or update or delete on public.stage_requests
  for each row execute function public.write_audit();

-- موافقة المشرف أو رفضه. الموافقة تطبّق التقرير على المرحلة بنفس قواعد التطبيق:
-- "بدأت" = جارية، و"اكتملت" = مكتملة وتبدأ المرحلة التالية بنفس المنفّذ
create or replace function public.review_stage_request(req uuid, approve boolean, reason text default null)
returns public.stage_requests language plpgsql security definer set search_path = public as $$
declare r public.stage_requests; s public.project_stages; nx text;
begin
  if not coalesce(public.is_staff(), false) then raise exception 'المراجعة للمدير والمشرف فقط' using errcode = '42501'; end if;
  select * into r from public.stage_requests where id = req for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if r.status <> 'pending' then raise exception 'هذا الطلب رُوجع من قبل'; end if;
  reason := nullif(btrim(reason), '');
  if not approve and reason is null then raise exception 'اكتب سبب الرفض'; end if;
  if approve then
    select * into s from public.project_stages where project_id = r.project_id and checkpoint = r.checkpoint for update;
    if r.action = 'start' and s.status = 'not_started' then
      update public.project_stages set status = 'in_progress' where project_id = r.project_id and checkpoint = r.checkpoint;
    elsif r.action = 'done' and s.status in ('not_started', 'in_progress') then
      update public.project_stages set status = 'done' where project_id = r.project_id and checkpoint = r.checkpoint;
      select q.key into nx from public.qc_checkpoints q
        left join public.project_stages x on x.project_id = r.project_id and x.checkpoint = q.key
        where q.position > (select position from public.qc_checkpoints where key = r.checkpoint)
          and coalesce(x.status, 'not_started') = 'not_started'
        order by q.position limit 1;
      if nx is not null then
        insert into public.project_stages (project_id, checkpoint, status, crew, crew_id)
        values (r.project_id, nx, 'in_progress', s.crew, s.crew_id)
        on conflict (project_id, checkpoint) do update set status = 'in_progress',
          crew = coalesce(public.project_stages.crew, excluded.crew), crew_id = coalesce(public.project_stages.crew_id, excluded.crew_id);
      end if;
    end if;
  end if;
  update public.stage_requests set status = case when approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(reason, 500)
  where id = req returning * into r;
  return r;
end $$;

alter table public.stage_requests enable row level security;
revoke all on public.stage_requests from anon;
grant select, insert, delete on public.stage_requests to authenticated;
revoke execute on function public.my_crew(), public.stage_request_check(), public.review_stage_request(uuid, boolean, text) from public, anon;
grant execute on function public.my_crew(), public.review_stage_request(uuid, boolean, text) to authenticated;
drop policy if exists requests_select on public.stage_requests;
create policy requests_select on public.stage_requests for select to authenticated using ((select public.app_role()) is not null);
drop policy if exists requests_insert on public.stage_requests;
create policy requests_insert on public.stage_requests for insert to authenticated with check ((select public.app_role()) is not null and requested_by = (select auth.uid()));
-- الفني يسحب طلبه ما دام بانتظار الموافقة، والمدير يحذف أي طلب
drop policy if exists requests_delete on public.stage_requests;
create policy requests_delete on public.stage_requests for delete to authenticated
  using ((requested_by = (select auth.uid()) and status = 'pending') or (select public.is_admin()));

-- مخزن الصور: خاص (غير عام)، 5 ميغا للصورة، JPEG/PNG/WebP فقط.
-- المسار: <المشروع>/<المرسل>/<معرّف>.jpg، وكل مستخدم يرفع في مجلده فقط
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stage-photos', 'stage-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists stage_photos_select on storage.objects;
create policy stage_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'stage-photos' and (select public.app_role()) is not null);
drop policy if exists stage_photos_insert on storage.objects;
create policy stage_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'stage-photos' and (select public.app_role()) is not null and (storage.foldername(name))[2] = (select auth.uid())::text);
drop policy if exists stage_photos_delete on storage.objects;
create policy stage_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'stage-photos' and ((storage.foldername(name))[2] = (select auth.uid())::text or (select public.is_admin())));

-- ==========================================================
-- أداء الفنيين: من سجّل كل قراءة (ضغط، فاكيوم، شحن) ومتى، يُملأ على الخادم ولا يُرسل من الهاتف.
-- الفشل وNCR تُحسب على من سجّل قراءة ذاك الفحص، وأرقام الفرقة تُعرض بجانبها.
-- ==========================================================
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'test_records' and column_name = 'pressure_by') then
    alter table public.test_records
      add column pressure_by uuid references public.profiles (id) on delete set null,
      add column pressure_at timestamptz,
      add column vacuum_by   uuid references public.profiles (id) on delete set null,
      add column vacuum_at   timestamptz,
      add column charge_by   uuid references public.profiles (id) on delete set null,
      add column charge_at   timestamptz;
    -- نقل لمرة واحدة من سجل العمليات: آخر شخص غيّر قراءات كل قسم
    with ch as (
      select a.row_id::uuid as unit_id, a.actor, a.at,
        (select jsonb_agg(coalesce(a.new_data -> k, 'null')) from unnest(array['pressure_date','test_pressure','hold_hours','start_mpa','end_mpa']) k)
          is distinct from (select jsonb_agg(coalesce(a.old_data -> k, 'null')) from unnest(array['pressure_date','test_pressure','hold_hours','start_mpa','end_mpa']) k) as p,
        (select jsonb_agg(coalesce(a.new_data -> k, 'null')) from unnest(array['vacuum_date','vacuum_microns','vacuum_hold_min','vacuum_rise']) k)
          is distinct from (select jsonb_agg(coalesce(a.old_data -> k, 'null')) from unnest(array['vacuum_date','vacuum_microns','vacuum_hold_min','vacuum_rise']) k) as v,
        (select jsonb_agg(coalesce(a.new_data -> k, 'null')) from unnest(array['charge_calc_kg','charge_actual_kg','cylinder_no']) k)
          is distinct from (select jsonb_agg(coalesce(a.old_data -> k, 'null')) from unnest(array['charge_calc_kg','charge_actual_kg','cylinder_no']) k) as c
      from public.audit_log a
      where a.table_name = 'test_records' and a.action in ('INSERT', 'UPDATE') and a.actor is not null
        and exists (select 1 from public.profiles pr where pr.id = a.actor)
    ), lp as (select distinct on (unit_id) unit_id, actor, at from ch where p order by unit_id, at desc),
       lv as (select distinct on (unit_id) unit_id, actor, at from ch where v order by unit_id, at desc),
       lc as (select distinct on (unit_id) unit_id, actor, at from ch where c order by unit_id, at desc)
    update public.test_records t set
      pressure_by = lp.actor, pressure_at = lp.at,
      vacuum_by = lv.actor,   vacuum_at = lv.at,
      charge_by = lc.actor,   charge_at = lc.at
    from public.test_records t2
      left join lp on lp.unit_id = t2.unit_id
      left join lv on lv.unit_id = t2.unit_id
      left join lc on lc.unit_id = t2.unit_id
    where t.unit_id = t2.unit_id and (lp.actor is not null or lv.actor is not null or lc.actor is not null);
  end if;
end $$;
create index if not exists test_records_pressure_by_idx on public.test_records (pressure_by, pressure_at);
create index if not exists test_records_vacuum_by_idx   on public.test_records (vacuum_by, vacuum_at);
create index if not exists test_records_charge_by_idx   on public.test_records (charge_by, charge_at);
create index if not exists unit_checks_inspected_by_idx on public.unit_checks (inspected_by, inspected_at);
create index if not exists stage_requests_by_idx        on public.stage_requests (requested_by, requested_at);

-- يُملأ "من سجّل" لكل قسم تغيّرت قراءاته فقط، وما يرسله الهاتف في هذه الأعمدة يُتجاهل
create or replace function public.test_record_stamp()
returns trigger language plpgsql set search_path = public as $$
declare me uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    new.unit_id := old.unit_id;
    new.pressure_by := old.pressure_by; new.pressure_at := old.pressure_at;
    new.vacuum_by := old.vacuum_by;     new.vacuum_at := old.vacuum_at;
    new.charge_by := old.charge_by;     new.charge_at := old.charge_at;
    if (new.pressure_date, new.test_pressure, new.hold_hours, new.start_mpa, new.end_mpa)
       is distinct from (old.pressure_date, old.test_pressure, old.hold_hours, old.start_mpa, old.end_mpa) then
      new.pressure_by := me; new.pressure_at := now();
    end if;
    if (new.vacuum_date, new.vacuum_microns, new.vacuum_hold_min, new.vacuum_rise)
       is distinct from (old.vacuum_date, old.vacuum_microns, old.vacuum_hold_min, old.vacuum_rise) then
      new.vacuum_by := me; new.vacuum_at := now();
    end if;
    if (new.charge_calc_kg, new.charge_actual_kg, new.cylinder_no)
       is distinct from (old.charge_calc_kg, old.charge_actual_kg, old.cylinder_no) then
      new.charge_by := me; new.charge_at := now();
    end if;
  else
    new.pressure_by := null; new.pressure_at := null; new.vacuum_by := null; new.vacuum_at := null; new.charge_by := null; new.charge_at := null;
    if coalesce(new.pressure_date::text, new.test_pressure::text, new.hold_hours::text, new.start_mpa::text, new.end_mpa::text) is not null then
      new.pressure_by := me; new.pressure_at := now();
    end if;
    if coalesce(new.vacuum_date::text, new.vacuum_microns::text, new.vacuum_hold_min::text, new.vacuum_rise::text) is not null then
      new.vacuum_by := me; new.vacuum_at := now();
    end if;
    if coalesce(new.charge_calc_kg::text, new.charge_actual_kg::text, new.cylinder_no) is not null then
      new.charge_by := me; new.charge_at := now();
    end if;
  end if;
  new.updated_by := me; new.updated_at := now();
  return new;
end $$;
drop trigger if exists test_records_stamp on public.test_records;
create trigger test_records_stamp before insert or update on public.test_records
  for each row execute function public.test_record_stamp();

-- أرقام الأداء لكل مستخدم خلال فترة (من، إلى؛ null = بلا حد).
-- المدير والمشرف يرون الكل، والفني يرى سطره هو فقط (التحقق هنا على الخادم).
create or replace function public.tech_performance(p_from date default null, p_to date default null)
returns table (
  user_id uuid, full_name text, role text, active boolean, crew_id uuid,
  readings int, pressure int, vacuum int, charge int,
  failed int, ncrs int, ncrs_open int,
  results int, reports int, reports_approved int, reports_rejected int,
  team_ncrs int, team_ncrs_open int, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  with lo as (select coalesce(p_from::timestamptz, '-infinity'::timestamptz) as a,
                     coalesce((p_to + 1)::timestamptz, 'infinity'::timestamptz) as b),
  who as (
    select pr.* from public.profiles pr
    where public.app_role() is not null and (public.is_staff() or pr.id = auth.uid())
  ),
  rd as (   -- قراءة واحدة لكل (وحدة، قسم) مع نتيجة ذاك الفحص
    select t.unit_id, x.cp, x.by, x.at, c.result
    from public.test_records t
    cross join lateral (values ('pressure_test', t.pressure_by, t.pressure_at),
                               ('vacuum', t.vacuum_by, t.vacuum_at),
                               ('charging', t.charge_by, t.charge_at)) as x(cp, by, at)
    left join public.unit_checks c on c.unit_id = t.unit_id and c.checkpoint = x.cp
    cross join lo
    where x.by is not null and x.at >= lo.a and x.at < lo.b
  )
  select w.id, w.full_name, w.role, w.active, w.crew_id,
    (select count(*)::int from rd where rd.by = w.id),
    (select count(*)::int from rd where rd.by = w.id and rd.cp = 'pressure_test'),
    (select count(*)::int from rd where rd.by = w.id and rd.cp = 'vacuum'),
    (select count(*)::int from rd where rd.by = w.id and rd.cp = 'charging'),
    (select count(*)::int from rd where rd.by = w.id and rd.result = 'fail'),
    (select count(*)::int from public.ncrs n join rd on rd.unit_id = n.unit_id and rd.cp = n.checkpoint where rd.by = w.id),
    (select count(*)::int from public.ncrs n join rd on rd.unit_id = n.unit_id and rd.cp = n.checkpoint where rd.by = w.id and n.status = 'open'),
    (select count(*)::int from public.unit_checks c, lo where c.inspected_by = w.id and c.result <> 'pending' and c.inspected_at >= lo.a and c.inspected_at < lo.b),
    (select count(*)::int from public.stage_requests r, lo where r.requested_by = w.id and r.requested_at >= lo.a and r.requested_at < lo.b),
    (select count(*)::int from public.stage_requests r, lo where r.requested_by = w.id and r.status = 'approved' and r.requested_at >= lo.a and r.requested_at < lo.b),
    (select count(*)::int from public.stage_requests r, lo where r.requested_by = w.id and r.status = 'rejected' and r.requested_at >= lo.a and r.requested_at < lo.b),
    (select count(*)::int from public.ncrs n join public.units u on u.id = n.unit_id
       where w.crew_id is not null and u.crew_id = w.crew_id and (p_from is null or n.date_raised >= p_from) and (p_to is null or n.date_raised <= p_to)),
    (select count(*)::int from public.ncrs n join public.units u on u.id = n.unit_id
       where w.crew_id is not null and u.crew_id = w.crew_id and n.status = 'open' and (p_from is null or n.date_raised >= p_from) and (p_to is null or n.date_raised <= p_to)),
    greatest((select max(rd.at) from rd where rd.by = w.id),
             (select max(c.inspected_at) from public.unit_checks c where c.inspected_by = w.id),
             (select max(r.requested_at) from public.stage_requests r where r.requested_by = w.id))
  from who w
$$;
revoke execute on function public.tech_performance(date, date) from public, anon;
grant execute on function public.tech_performance(date, date) to authenticated;

-- ==========================================================
-- الأداء: فهرس لكل مفتاح أجنبي (يسرّع الربط بين الجداول والحذف المتسلسل)
-- ==========================================================
create index if not exists materials_created_by_idx      on public.materials (created_by);
create index if not exists ncrs_checkpoint_idx           on public.ncrs (checkpoint);
create index if not exists ncrs_created_by_idx           on public.ncrs (created_by);
create index if not exists ncrs_unit_idx                 on public.ncrs (unit_id);
create index if not exists profiles_crew_idx             on public.profiles (crew_id);
create index if not exists project_stages_checkpoint_idx on public.project_stages (checkpoint);
create index if not exists project_stages_crew_idx       on public.project_stages (crew_id);
create index if not exists project_stages_updated_by_idx on public.project_stages (updated_by);
create index if not exists projects_created_by_idx       on public.projects (created_by);
create index if not exists stage_requests_reviewed_by_idx on public.stage_requests (reviewed_by);
create index if not exists test_records_updated_by_idx   on public.test_records (updated_by);
create index if not exists unit_checks_checkpoint_idx    on public.unit_checks (checkpoint);

-- ==========================================================
-- النسخ الاحتياطي التلقائي
-- كل ليلة تُحفظ نسخة كاملة من كل جداول البيانات داخل القاعدة (آخر 30 نسخة تلقائية وآخر 10 يدوية).
-- تحمي من الأخطاء: حذف بالخطأ، استيراد خاطئ، تعديل جماعي. ولا تحمي من فقدان المشروع كله،
-- لذلك ينزّل المدير نسخة إلى جهازه أو Google Drive من صفحة "نسخة احتياطية" بانتظام.
-- الصور (stage-photos) ليست ضمن النسخة.
-- ==========================================================
create table if not exists public.backups (
  id          bigint generated always as identity primary key,
  taken_at    timestamptz not null default now(),
  kind        text not null check (kind in ('auto', 'manual')),
  taken_by    uuid,   -- بلا مفتاح أجنبي: تبقى النسخة حتى لو حُذف المستخدم
  counts      jsonb not null,
  size_bytes  integer not null,
  data        jsonb not null
);
create index if not exists backups_kind_at_idx on public.backups (kind, taken_at desc);
alter table public.backups enable row level security;
revoke all on public.backups from anon, authenticated;
-- المدير يرى قائمة النسخ فقط، ومحتواها عبر backup_data() التي تسجّل كل تنزيل في سجل العمليات
grant select (id, taken_at, kind, taken_by, counts, size_bytes) on public.backups to authenticated;
drop policy if exists backups_select on public.backups;
create policy backups_select on public.backups for select to authenticated using ((select public.is_admin()));

create or replace function public.make_backup(p_kind text)
returns bigint language plpgsql security definer set search_path = public as $$
declare t text; r jsonb; d jsonb := '{}'; c jsonb := '{}'; new_id bigint;
begin
  for t in select k.relname from pg_class k join pg_namespace n on n.oid = k.relnamespace
           where n.nspname = 'public' and k.relkind = 'r' and k.relname <> 'backups' order by 1 loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into r;
    d := d || jsonb_build_object(t, r);
    c := c || jsonb_build_object(t, jsonb_array_length(r));
  end loop;
  d := jsonb_build_object('app', 'surour', 'format', 1, 'taken_at', now(), 'tables', d);
  insert into public.backups (kind, taken_by, counts, size_bytes, data)
  values (p_kind, auth.uid(), c, octet_length(d::text), d) returning id into new_id;
  delete from public.backups where kind = p_kind and id not in (
    select id from public.backups where kind = p_kind order by taken_at desc, id desc
    limit case when p_kind = 'auto' then 30 else 10 end);
  return new_id;
end $$;
revoke execute on function public.make_backup(text) from public, anon, authenticated;

create or replace function public.take_backup()
returns bigint language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if not public.is_admin() then raise exception 'النسخ الاحتياطي للمدير فقط' using errcode = '42501'; end if;
  if exists (select 1 from public.backups where kind = 'manual' and taken_at > now() - interval '2 minutes') then
    raise exception 'أُخذت نسخة قبل أقل من دقيقتين، انتظر قليلاً';
  end if;
  new_id := public.make_backup('manual');
  insert into public.audit_log (actor, table_name, row_id, action) values (auth.uid(), 'backups', new_id::text, 'INSERT');
  return new_id;
end $$;

create or replace function public.backup_data(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if not public.is_admin() then raise exception 'النسخ الاحتياطي للمدير فقط' using errcode = '42501'; end if;
  select data into d from public.backups where id = p_id;
  if d is null then raise exception 'النسخة غير موجودة'; end if;
  insert into public.audit_log (actor, table_name, row_id, action) values (auth.uid(), 'backups', p_id::text, 'DOWNLOAD');
  return d;
end $$;
revoke execute on function public.take_backup(), public.backup_data(bigint) from public, anon;
grant execute on function public.take_backup(), public.backup_data(bigint) to authenticated;

-- الجدولة: كل ليلة 23:00 UTC (الثانية فجراً بتوقيت بغداد). على PostgreSQL بلا pg_cron يُتخطّى هذا الجزء.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('surour-nightly-backup', '0 23 * * *', $q$select public.make_backup('auto')$q$);
  else
    raise notice 'pg_cron غير متوفر هنا: النسخ التلقائي الليلي لن يعمل';
  end if;
end $$;

-- ==========================================================
-- تقوية الحماية (مراجعة الوكلاء، المجموعة 2)
-- ==========================================================
-- الحساب الجديد يبدأ غير مفعّل
alter table public.profiles alter column active set default false;

-- "من أنشأ" يُحدَّد على الخادم فلا يُزوَّر من الهاتف
create or replace function public.set_created_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;
drop trigger if exists projects_created_by on public.projects;
create trigger projects_created_by before insert on public.projects for each row execute function public.set_created_by();
drop trigger if exists materials_created_by on public.materials;
create trigger materials_created_by before insert on public.materials for each row execute function public.set_created_by();

-- رابط الموقع: خرائط Google وWaze وApple فقط (لا صفحات تصيّد تُفتح للفنيين)
alter table public.projects drop constraint if exists projects_map_url_check;
alter table public.projects add constraint projects_map_url_check check (map_url is null or (char_length(map_url) <= 500 and
  map_url ~ '^https://((www\.)?google\.[a-z.]{2,8}/maps|maps\.google\.[a-z.]{2,8}|maps\.app\.goo\.gl|goo\.gl/maps|(www\.|ul\.)?waze\.com|maps\.apple\.com)([/?#][^[:space:]<>"]*)?$'));

-- لا يبقى النظام بلا مدير: لا تعطيل ولا تخفيض لآخر مدير مفعّل
create or replace function public.protect_last_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'لا يمكن تعطيل أو تخفيض آخر مدير في النظام';
  end if;
  return new;
end $$;
revoke execute on function public.protect_last_admin() from public, anon;
drop trigger if exists profiles_last_admin on public.profiles;
create trigger profiles_last_admin before update on public.profiles for each row execute function public.protect_last_admin();

-- ==========================================================
-- استيراد Excel بدفعات: تحديث نتائج كثيرة بطلب واحد
-- security invoker: قواعد الصلاحيات (RLS) والمشغّلات (الختم وسجل العمليات) تبقى سارية كما في التحديث العادي
-- ==========================================================
create or replace function public.set_unit_checks(p_rows jsonb)
returns integer language sql security invoker set search_path = '' as $$
  with r as (
    select (x ->> 'unit_id')::uuid as unit_id, x ->> 'checkpoint' as checkpoint, x ->> 'result' as result
    from jsonb_array_elements(p_rows) as x
  ), u as (
    update public.unit_checks c set result = r.result
    from r where c.unit_id = r.unit_id and c.checkpoint = r.checkpoint and c.result is distinct from r.result
    returning 1
  )
  select count(*)::integer from u
$$;
revoke execute on function public.set_unit_checks(jsonb) from public, anon;
grant execute on function public.set_unit_checks(jsonb) to authenticated;

-- ==========================================================
-- بعد إنشاء أول مستخدم من لوحة Supabase، اجعله مديراً:
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
-- ==========================================================
