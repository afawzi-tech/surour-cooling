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
  if new.status = 'not_started' then
    new.start_date := null; new.end_date := null;
  elsif new.status = 'in_progress' then
    new.start_date := coalesce(new.start_date, current_date); new.end_date := null;
  elsif new.status = 'done' then
    new.end_date := coalesce(new.end_date, current_date);
    new.start_date := coalesce(new.start_date, least(new.end_date, current_date));
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
create policy stages_select on public.project_stages for select to authenticated using (public.app_role() is not null);
drop policy if exists stages_insert on public.project_stages;
create policy stages_insert on public.project_stages for insert to authenticated with check (public.is_staff());
drop policy if exists stages_update on public.project_stages;
create policy stages_update on public.project_stages for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists stages_delete on public.project_stages;
create policy stages_delete on public.project_stages for delete to authenticated using (public.is_admin());

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
create policy crews_select on public.crews for select to authenticated using (public.app_role() is not null);
drop policy if exists crews_insert on public.crews;
create policy crews_insert on public.crews for insert to authenticated with check (public.is_staff());
drop policy if exists crews_update on public.crews;
create policy crews_update on public.crews for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists crews_delete on public.crews;
create policy crews_delete on public.crews for delete to authenticated using (public.is_admin());

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
create policy requests_select on public.stage_requests for select to authenticated using (public.app_role() is not null);
drop policy if exists requests_insert on public.stage_requests;
create policy requests_insert on public.stage_requests for insert to authenticated with check (public.app_role() is not null and requested_by = auth.uid());
-- الفني يسحب طلبه ما دام بانتظار الموافقة، والمدير يحذف أي طلب
drop policy if exists requests_delete on public.stage_requests;
create policy requests_delete on public.stage_requests for delete to authenticated
  using ((requested_by = auth.uid() and status = 'pending') or public.is_admin());

-- مخزن الصور: خاص (غير عام)، 5 ميغا للصورة، JPEG/PNG/WebP فقط.
-- المسار: <المشروع>/<المرسل>/<معرّف>.jpg، وكل مستخدم يرفع في مجلده فقط
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stage-photos', 'stage-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists stage_photos_select on storage.objects;
create policy stage_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'stage-photos' and public.app_role() is not null);
drop policy if exists stage_photos_insert on storage.objects;
create policy stage_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'stage-photos' and public.app_role() is not null and (storage.foldername(name))[2] = auth.uid()::text);
drop policy if exists stage_photos_delete on storage.objects;
create policy stage_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'stage-photos' and ((storage.foldername(name))[2] = auth.uid()::text or public.is_admin()));

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
returns trigger language plpgsql as $$
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
-- مهام المشروع (فكرة من TaskFlow): مهمة لها عنوان ومسؤول (فني) وموعد وأولوية،
-- وقد ترتبط بمرحلة. المدير والمشرف ينشئونها ويعدّلونها ويحرّكونها مباشرة.
-- الفني لا يعدّل المهمة: يرسل تقريراً (بدأت/أنجزت) عن مهمة مسندة له، ويطبَّق بعد الموافقة.
-- ==========================================================
create table if not exists public.project_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  checkpoint   text references public.qc_checkpoints (key),
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  details      text check (char_length(details) <= 2000),
  priority     text not null default 'normal' check (priority in ('urgent', 'high', 'normal')),
  status       text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  assignee     uuid references public.profiles (id) on delete set null,
  due_date     date,
  position     double precision not null default 0,
  started_at   timestamptz,
  done_at      timestamptz,
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists project_tasks_project_idx on public.project_tasks (project_id, status, position);
create index if not exists project_tasks_assignee_idx on public.project_tasks (assignee) where status <> 'done';

-- أوقات البدء والإنجاز تُملأ على الخادم عند تغيّر الحالة، والمنشئ لا يتغيّر
create or replace function public.project_task_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.title := btrim(new.title);
  new.details := nullif(btrim(new.details), '');
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now();
  else
    new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  if new.status = 'todo' then new.started_at := null; new.done_at := null;
  elsif new.status = 'in_progress' then
    new.started_at := coalesce(case when tg_op = 'UPDATE' then old.started_at end, now()); new.done_at := null;
  else
    new.started_at := coalesce(case when tg_op = 'UPDATE' then old.started_at end, now());
    new.done_at := coalesce(case when tg_op = 'UPDATE' and old.status = 'done' then old.done_at end, now());
  end if;
  return new;
end $$;
drop trigger if exists project_tasks_stamp on public.project_tasks;
create trigger project_tasks_stamp before insert or update on public.project_tasks
  for each row execute function public.project_task_stamp();
drop trigger if exists audit_project_tasks on public.project_tasks;
create trigger audit_project_tasks after insert or update or delete on public.project_tasks
  for each row execute function public.write_audit();

alter table public.project_tasks enable row level security;
revoke all on public.project_tasks from anon;
grant select, insert, update, delete on public.project_tasks to authenticated;
drop policy if exists tasks_select on public.project_tasks;
create policy tasks_select on public.project_tasks for select to authenticated using (public.app_role() is not null);
drop policy if exists tasks_insert on public.project_tasks;
create policy tasks_insert on public.project_tasks for insert to authenticated with check (public.is_staff());
drop policy if exists tasks_update on public.project_tasks;
create policy tasks_update on public.project_tasks for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists tasks_delete on public.project_tasks;
create policy tasks_delete on public.project_tasks for delete to authenticated using (public.is_staff());

-- تقرير الفني عن مهمة: بدأت أو أُنجزت، مع ملاحظة وصورة اختيارية (في مخزن stage-photos نفسه)
create table if not exists public.task_requests (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.project_tasks (id) on delete cascade,
  action        text not null check (action in ('start', 'done')),
  note          text check (char_length(note) <= 1000),
  photo_path    text check (char_length(photo_path) <= 200),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  requested_at  timestamptz not null default now(),
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text check (char_length(review_note) <= 500)
);
create unique index if not exists task_requests_one_pending on public.task_requests (task_id) where status = 'pending';

create or replace function public.task_request_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.project_tasks; me uuid := auth.uid();
begin
  new.requested_by := me; new.requested_at := now(); new.status := 'pending';
  new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
  new.note := nullif(btrim(new.note), '');
  select * into t from public.project_tasks where id = new.task_id;
  if not found or public.app_role() is null or t.assignee is distinct from me then
    raise exception 'هذه المهمة غير مسندة لك' using errcode = '42501';
  end if;
  if new.action = 'start' and t.status <> 'todo' then raise exception 'المهمة بدأت من قبل';
  elsif new.action = 'done' and t.status = 'done' then raise exception 'المهمة منجزة';
  end if;
  if new.photo_path is not null and new.photo_path !~ ('^' || t.project_id::text || '/' || me::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'مسار الصورة غير صالح';
  end if;
  return new;
end $$;
drop trigger if exists task_requests_check on public.task_requests;
create trigger task_requests_check before insert on public.task_requests
  for each row execute function public.task_request_check();
drop trigger if exists audit_task_requests on public.task_requests;
create trigger audit_task_requests after insert or update or delete on public.task_requests
  for each row execute function public.write_audit();

create or replace function public.review_task_request(req uuid, approve boolean, reason text default null)
returns public.task_requests language plpgsql security definer set search_path = public as $$
declare r public.task_requests;
begin
  if not coalesce(public.is_staff(), false) then raise exception 'المراجعة للمدير والمشرف فقط' using errcode = '42501'; end if;
  select * into r from public.task_requests where id = req for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if r.status <> 'pending' then raise exception 'هذا الطلب رُوجع من قبل'; end if;
  reason := nullif(btrim(reason), '');
  if not approve and reason is null then raise exception 'اكتب سبب الرفض'; end if;
  if approve then
    update public.project_tasks set status = case when r.action = 'start' then 'in_progress' else 'done' end
    where id = r.task_id and status <> 'done' and (r.action = 'done' or status = 'todo');
  end if;
  update public.task_requests set status = case when approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(reason, 500)
  where id = req returning * into r;
  return r;
end $$;

alter table public.task_requests enable row level security;
revoke all on public.task_requests from anon;
grant select, insert, delete on public.task_requests to authenticated;
revoke execute on function public.project_task_stamp(), public.task_request_check(), public.review_task_request(uuid, boolean, text) from public, anon;
grant execute on function public.review_task_request(uuid, boolean, text) to authenticated;
drop policy if exists task_requests_select on public.task_requests;
create policy task_requests_select on public.task_requests for select to authenticated using (public.app_role() is not null);
drop policy if exists task_requests_insert on public.task_requests;
create policy task_requests_insert on public.task_requests for insert to authenticated with check (public.app_role() is not null and requested_by = auth.uid());
drop policy if exists task_requests_delete on public.task_requests;
create policy task_requests_delete on public.task_requests for delete to authenticated
  using ((requested_by = auth.uid() and status = 'pending') or public.is_admin());

-- ==========================================================
-- التعليقات، والإشعارات (داخل التطبيق وعلى الموبايل)، ومرفقات المشروع — أفكار من TaskFlow
-- ==========================================================

-- ---------- التعليقات: على المشروع أو على مهمة، مع إشارة @ لأشخاص ----------
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  task_id     uuid references public.project_tasks (id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  mentions    uuid[] not null default '{}' check (cardinality(mentions) <= 20),
  author      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);
create index if not exists comments_project_idx on public.comments (project_id, created_at);
create index if not exists comments_task_idx on public.comments (task_id, created_at) where task_id is not null;

create or replace function public.comment_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.body := btrim(new.body);
  -- الإشارات: أشخاص مفعّلون فقط، بلا تكرار، وليس الكاتب نفسه
  new.mentions := coalesce((select array_agg(distinct m) from unnest(new.mentions) m
                            join public.profiles p on p.id = m and p.active where m <> auth.uid()), '{}');
  if tg_op = 'INSERT' then
    new.author := auth.uid(); new.created_at := now(); new.edited_at := null;
    if new.task_id is not null and not exists (select 1 from public.project_tasks t where t.id = new.task_id and t.project_id = new.project_id) then
      raise exception 'المهمة ليست في هذا المشروع';
    end if;
  else
    new.author := old.author; new.created_at := old.created_at; new.project_id := old.project_id; new.task_id := old.task_id;
    new.edited_at := now();
  end if;
  return new;
end $$;
drop trigger if exists comments_stamp on public.comments;
create trigger comments_stamp before insert or update on public.comments
  for each row execute function public.comment_stamp();
drop trigger if exists audit_comments on public.comments;
create trigger audit_comments after insert or update or delete on public.comments
  for each row execute function public.write_audit();

alter table public.comments enable row level security;
revoke all on public.comments from anon;
grant select, insert, update, delete on public.comments to authenticated;
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated using (public.app_role() is not null);
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated with check (public.app_role() is not null and author = auth.uid());
drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments for update to authenticated using (author = auth.uid() and public.app_role() is not null) with check (author = auth.uid());
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated using (author = auth.uid() or public.is_admin());

-- ---------- الإشعارات ----------
-- تُنشأ على الخادم فقط (من المشغّلات أدناه). كل مستخدم يرى إشعاراته ويعلّمها مقروءة.
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  actor       uuid references public.profiles (id) on delete set null,
  kind        text not null,
  title       text not null,
  body        text,
  link        text check (link ~ '^#/'),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- اشتراكات الموبايل (Web Push): كل جهاز يسجّل اشتراكه
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  endpoint    text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh      text not null check (char_length(p256dh) <= 200),
  auth        text not null check (char_length(auth) <= 100),
  device      text check (char_length(device) <= 200),
  created_at  timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
grant select, insert, delete on public.push_subscriptions to authenticated;
drop policy if exists push_select on public.push_subscriptions;
create policy push_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists push_insert on public.push_subscriptions;
create policy push_insert on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid() and public.app_role() is not null);
drop policy if exists push_delete on public.push_subscriptions;
create policy push_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- أسرار داخلية للخادم فقط (لا يقرؤها أي مستخدم): مفاتيح VAPID ورمز استدعاء دالة الإرسال
create table if not exists public.app_secrets (
  key    text primary key,
  value  text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
grant select, insert, update on public.app_secrets to service_role;
insert into public.app_secrets (key, value) values ('push_hook_token', encode(gen_random_bytes(24), 'hex')) on conflict (key) do nothing;

-- عنوان دالة الإرسال (يُضبط مرة واحدة بعد نشرها)
insert into public.app_secrets (key, value) values ('push_fn_url', '') on conflict (key) do nothing;

-- إنشاء إشعار، ثم طلب إرساله للموبايل عبر دالة push-send (إن كانت pg_net والدالة جاهزتين)
create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
declare n uuid; u text; tok text;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  if not exists (select 1 from public.profiles where id = p_user and active) then return; end if;
  insert into public.notifications (user_id, actor, kind, title, body, link)
  values (p_user, auth.uid(), p_kind, left(p_title, 200), left(p_body, 500), p_link) returning id into n;
  select value into u from public.app_secrets where key = 'push_fn_url';
  select value into tok from public.app_secrets where key = 'push_hook_token';
  if coalesce(u, '') <> '' and exists (select 1 from pg_extension where extname = 'pg_net')
     and exists (select 1 from public.push_subscriptions where user_id = p_user) then
    begin
      execute 'select net.http_post(url := $1, body := $2, headers := $3)'
        using u, jsonb_build_object('id', n), jsonb_build_object('Content-Type', 'application/json', 'x-hook-token', tok);
    exception when others then null;   -- فشل الإرسال للموبايل لا يمنع الإشعار داخل التطبيق
    end;
  end if;
end $$;

create or replace function public.notify_staff(p_kind text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
declare s uuid;
begin
  for s in select id from public.profiles where active and role in ('admin', 'supervisor') loop
    perform public.notify(s, p_kind, p_title, p_body, p_link);
  end loop;
end $$;

create or replace function public.person_name(p uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), 'مستخدم') from public.profiles where id = p
$$;

-- تقارير المراحل: جديد ← المدير والمشرف، ومراجعة ← الفني
create or replace function public.stage_request_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare pj text; cp text;
begin
  select client into pj from public.projects where id = new.project_id;
  select name_ar into cp from public.qc_checkpoints where key = new.checkpoint;
  if tg_op = 'INSERT' then
    perform public.notify_staff('stage_request', 'تقرير مرحلة بانتظار موافقتك',
      public.person_name(new.requested_by) || ': ' || case when new.action = 'start' then 'بدأت ' else 'اكتملت ' end || cp || ' · ' || pj,
      '#/project/' || new.project_id);
  elsif old.status = 'pending' and new.status <> 'pending' then
    perform public.notify(new.requested_by, 'stage_review',
      case when new.status = 'approved' then 'وافق المشرف على تقريرك' else 'رُفض تقريرك' end,
      cp || ' · ' || pj || coalesce(' · ' || new.review_note, ''), '#/project/' || new.project_id);
  end if;
  return null;
end $$;
drop trigger if exists stage_requests_notify on public.stage_requests;
create trigger stage_requests_notify after insert or update on public.stage_requests
  for each row execute function public.stage_request_notify();

-- المهام: إسناد ← المسؤول، تقرير ← المدير والمشرف، مراجعة ← الفني
create or replace function public.project_task_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare pj text;
begin
  select client into pj from public.projects where id = new.project_id;
  if new.assignee is not null and (tg_op = 'INSERT' or new.assignee is distinct from old.assignee) and new.status <> 'done' then
    perform public.notify(new.assignee, 'task_assigned', 'انسندت لك مهمة',
      new.title || ' · ' || pj || coalesce(' · الموعد ' || new.due_date::text, ''), '#/tasks');
  end if;
  return null;
end $$;
drop trigger if exists project_tasks_notify on public.project_tasks;
create trigger project_tasks_notify after insert or update on public.project_tasks
  for each row execute function public.project_task_notify();

create or replace function public.task_request_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.project_tasks;
begin
  select * into t from public.project_tasks where id = new.task_id;
  if tg_op = 'INSERT' then
    perform public.notify_staff('task_request', 'تقرير مهمة بانتظار موافقتك',
      public.person_name(new.requested_by) || ': ' || case when new.action = 'start' then 'بدأ ' else 'أنجز ' end || t.title, '#/tasks');
  elsif old.status = 'pending' and new.status <> 'pending' then
    perform public.notify(new.requested_by, 'task_review',
      case when new.status = 'approved' then 'وافق المشرف على تقرير المهمة' else 'رُفض تقرير المهمة' end,
      t.title || coalesce(' · ' || new.review_note, ''), '#/tasks');
  end if;
  return null;
end $$;
drop trigger if exists task_requests_notify on public.task_requests;
create trigger task_requests_notify after insert or update on public.task_requests
  for each row execute function public.task_request_notify();

-- التعليقات: المذكورون بـ@، ومسؤول المهمة إن كان التعليق عليها
create or replace function public.comment_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare pj text; m uuid; t public.project_tasks; link text; who text := public.person_name(new.author);
begin
  select client into pj from public.projects where id = new.project_id;
  link := case when new.task_id is not null then '#/tasks' else '#/project/' || new.project_id || '/talk' end;
  foreach m in array new.mentions loop
    perform public.notify(m, 'mention', who || ' ذكرك', pj || ': ' || left(new.body, 160), link);
  end loop;
  if new.task_id is not null then
    select * into t from public.project_tasks where id = new.task_id;
    if t.assignee is not null and not (t.assignee = any (new.mentions)) then
      perform public.notify(t.assignee, 'task_comment', who || ' علّق على مهمتك', t.title || ': ' || left(new.body, 160), link);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments
  for each row execute function public.comment_notify();

revoke execute on function public.notify(uuid, text, text, text, text), public.notify_staff(text, text, text, text), public.person_name(uuid),
  public.stage_request_notify(), public.project_task_notify(), public.task_request_notify(), public.comment_notify(), public.comment_stamp() from public, anon, authenticated;

-- ---------- مرفقات المشروع: العقد، المخططات، صور الموقع ----------
create table if not exists public.project_files (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  path         text not null unique check (char_length(path) <= 300),
  name         text not null check (char_length(name) between 1 and 200),
  kind         text not null default 'other' check (kind in ('contract', 'drawing', 'photo', 'other')),
  mime         text check (char_length(mime) <= 100),
  size         bigint check (size >= 0),
  staff_only   boolean not null default false,
  uploaded_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists project_files_project_idx on public.project_files (project_id, created_at desc);

create or replace function public.project_file_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := auth.uid(); new.created_at := now();
    if new.path !~ ('^' || new.project_id::text || '/[0-9a-f-]{36}\.[a-z0-9]{1,8}$') then raise exception 'مسار الملف غير صالح'; end if;
  else
    new.path := old.path; new.project_id := old.project_id; new.uploaded_by := old.uploaded_by; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists project_files_stamp on public.project_files;
create trigger project_files_stamp before insert or update on public.project_files
  for each row execute function public.project_file_stamp();
drop trigger if exists audit_project_files on public.project_files;
create trigger audit_project_files after insert or update or delete on public.project_files
  for each row execute function public.write_audit();

alter table public.project_files enable row level security;
revoke all on public.project_files from anon;
grant select, insert, update, delete on public.project_files to authenticated;
-- الفني لا يرى الملفات المعلّمة "للإدارة فقط"
drop policy if exists files_select on public.project_files;
create policy files_select on public.project_files for select to authenticated
  using (public.app_role() is not null and (not staff_only or public.is_staff()));
drop policy if exists files_insert on public.project_files;
create policy files_insert on public.project_files for insert to authenticated with check (public.is_staff());
drop policy if exists files_update on public.project_files;
create policy files_update on public.project_files for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists files_delete on public.project_files;
create policy files_delete on public.project_files for delete to authenticated using (public.is_staff());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-files', 'project-files', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- قراءة الملف من المخزن بنفس شرط جدول المرفقات (الحماية على الخادم، لا في الواجهة)
drop policy if exists project_files_read on storage.objects;
create policy project_files_read on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and exists (select 1 from public.project_files f where f.path = storage.objects.name and (not f.staff_only or public.is_staff()) and public.app_role() is not null));
drop policy if exists project_files_write on storage.objects;
create policy project_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and public.is_staff());
drop policy if exists project_files_remove on storage.objects;
create policy project_files_remove on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and public.is_staff());

-- ==========================================================
-- بعد إنشاء أول مستخدم من لوحة Supabase، اجعله مديراً:
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
-- ==========================================================
