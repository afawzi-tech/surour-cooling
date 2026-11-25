-- ==========================================================
-- مصاعد السرور / التبريد المركزي
-- مخطط قاعدة البيانات وقواعد الصلاحيات (RLS) على Supabase - الإصدار 3
--
-- الفكرة: المشروع (العقد) يحتوي وحدات/فلل، وكل وحدة تمر بمراحل الفحص الثلاث عشرة
-- (مأخوذة من ملف VRF QC Tracker)، مع سجل القراءات وسجل حالات عدم المطابقة (NCR).
--
-- طريقة التشغيل: Supabase → SQL Editor → الصق الملف كاملاً → Run
-- الملف آمن لإعادة التشغيل (IF NOT EXISTS / OR REPLACE).
--
-- الأدوار:
--   admin       مدير: كل شيء، المستخدمون، الحذف، حدود الفحص، سجل العمليات
--   supervisor  مشرف: المشاريع والوحدات ونتائج الفحص والقراءات وحالات عدم المطابقة والمواد
--   technician  فني: يرى المشاريع (بدون قيمة العقد) ويسجّل قراءات الفحص فقط
-- ==========================================================

create extension if not exists pgcrypto;

-- ---------- المستخدمون والأدوار ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '' check (char_length(full_name) <= 120),
  role        text not null default 'technician'
              check (role in ('admin', 'supervisor', 'technician')),
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
create trigger on_auth_user_created
  after insert on auth.users
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
  if new.id <> old.id then
    raise exception 'لا يمكن تغيير المعرّف';
  end if;
  return new;
end $$;

drop trigger if exists profiles_protect_self on public.profiles;
create trigger profiles_protect_self
  before update on public.profiles
  for each row execute function public.protect_self_admin();

-- ---------- المشاريع (العقود) ----------
create table if not exists public.projects (
  id             uuid primary key default gen_random_uuid(),
  client         text not null check (char_length(btrim(client)) between 1 and 200),
  brand          text check (brand in ('lg', 'midea')),
  phone          text check (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$'),
  address        text check (char_length(address) <= 300),
  map_url        text check (map_url is null or (map_url ~* '^https://\S+$' and char_length(map_url) <= 1000)),
  size_m2        numeric(12, 2) check (size_m2 is null or size_m2 > 0),
  floors         integer check (floors is null or floors between 0 and 300),
  contract_date  date not null,
  notes          text check (char_length(notes) <= 4000),
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.projects add column if not exists brand text check (brand in ('lg', 'midea'));
-- أوزان المراحل لحساب نسبة الإنجاز: {"piping": 3, ...}، والمرحلة غير المذكورة وزنها 1
alter table public.projects add column if not exists weights jsonb not null default '{}'::jsonb;
-- اشتراط قراءة صالحة في سجل القراءات قبل اعتماد الضغط والفاكيوم والشحن
alter table public.projects add column if not exists require_readings boolean not null default true;

create table if not exists public.project_finance (
  project_id  uuid primary key references public.projects (id) on delete cascade,
  total_iqd   numeric(16, 0) check (total_iqd is null or total_iqd >= 0)
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- ---------- إزالة نموذج المراحل الثماني القديم ----------
drop trigger if exists projects_create_stages on public.projects;
drop table if exists public.project_stages cascade;
drop function if exists public.create_project_stages() cascade;
drop function if exists public.stage_before_update() cascade;

create or replace function public.create_project_finance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_finance (project_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists projects_create_finance on public.projects;
create trigger projects_create_finance after insert on public.projects
  for each row execute function public.create_project_finance();

-- ---------- مراحل الفحص الثلاث عشرة (من ملف VRF QC Tracker) ----------
create table if not exists public.qc_checkpoints (
  key       text primary key,
  position  smallint not null unique,
  name_ar   text not null,
  name_en   text not null,
  itp_ref   text,
  prereqs   text[] not null default '{}'     -- مراحل يجب أن تكون ناجحة (أو لا تنطبق) قبل اعتماد هذه
);

insert into public.qc_checkpoints (key, position, name_ar, name_en, itp_ref, prereqs) values
  ('site_ready',    1,  'جاهزية الموقع',              'Site ready',                     'ITP 1.6',     '{}'),
  ('equipment_set', 2,  'تركيب الأجهزة',              'Equipment set',                  'ITP 4.1-4.3', '{}'),
  ('piping',        3,  'التمديد واللحام',            'Piping and brazing',             'ITP 2.7',     '{}'),
  ('pressure_test', 4,  'فحص الضغط',                 'Pressure test',                  'ITP 3.4',     '{piping}'),
  ('vacuum',        5,  'الفاكيوم',                   'Vacuum',                         'ITP 3.7',     '{pressure_test}'),
  ('insulation',    6,  'العزل',                      'Insulation',                     'ITP 2.12',    '{pressure_test,vacuum}'),
  ('drain_test',    7,  'فحص الدرين',                 'Drain test',                     'ITP 4.7',     '{}'),
  ('megger',        8,  'فحص مقاومة العزل (ميغر)',    'Insulation resistance (megger)', 'ITP 5.4',     '{}'),
  ('addressing',    9,  'عنونة الوحدات',              'Unit addressing',                'ITP 5.7',     '{}'),
  ('charging',      10, 'شحن الفريون',                'Refrigerant charging',           'ITP 6.2',     '{pressure_test,vacuum,megger}'),
  ('commissioning', 11, 'التشغيل التجريبي',           'Commissioning',                  'ITP 6.6',     '{charging,addressing}'),
  ('punch_closed',  12, 'إغلاق الملاحظات',            'Punch list closed',              'ITP 6.9',     '{commissioning}'),
  ('handover',      13, 'التسليم',                    'Handover',                       'ITP 6.10',    '{site_ready,equipment_set,piping,pressure_test,vacuum,insulation,drain_test,megger,addressing,charging,commissioning,punch_closed}')
on conflict (key) do update set position = excluded.position, name_ar = excluded.name_ar, name_en = excluded.name_en,
  itp_ref = excluded.itp_ref, prereqs = excluded.prereqs;

-- ---------- حدود الفحص لكل براند ----------
create table if not exists public.brand_limits (
  brand                text primary key check (brand in ('lg', 'midea')),
  pressure_drop_max    numeric(6, 3) not null default 0.02,   -- MPa
  vacuum_max_microns   integer not null default 500,
  vacuum_hold_min      integer not null default 60,
  vacuum_rise_max      integer not null default 50,          -- microns
  charge_tolerance     numeric(5, 3) not null default 0.05,  -- 5%
  confirmed            boolean not null default false,       -- هل رُوجعت مع كتالوج الشركة؟
  updated_at           timestamptz not null default now()
);
insert into public.brand_limits (brand) values ('lg'), ('midea') on conflict do nothing;

-- ---------- الوحدات (الفلل) ----------
create table if not exists public.units (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  code        text not null check (char_length(btrim(code)) between 1 and 40),
  zone        text check (char_length(zone) <= 60),
  crew        text check (char_length(crew) <= 60),
  brand       text check (brand in ('lg', 'midea')),   -- إذا فارغ يُستخدم براند المشروع
  remarks     text check (char_length(remarks) <= 2000),
  created_at  timestamptz not null default now(),
  unique (project_id, code)
);
create index if not exists units_project_idx on public.units (project_id);

-- نتيجة كل مرحلة لكل وحدة
create table if not exists public.unit_checks (
  unit_id         uuid not null references public.units (id) on delete cascade,
  checkpoint      text not null references public.qc_checkpoints (key),
  result          text not null default 'pending' check (result in ('pending', 'pass', 'fail', 'na')),
  notes           text check (char_length(notes) <= 2000),
  inspected_by    uuid references public.profiles (id) on delete set null,
  inspected_at    timestamptz,
  primary key (unit_id, checkpoint)
);

create or replace function public.create_unit_checks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.unit_checks (unit_id, checkpoint)
  select new.id, key from public.qc_checkpoints;
  return new;
end $$;

drop trigger if exists units_create_checks on public.units;
create trigger units_create_checks after insert on public.units
  for each row execute function public.create_unit_checks();

-- ---------- سجل القراءات ----------
create table if not exists public.test_records (
  id                  uuid primary key default gen_random_uuid(),
  unit_id             uuid not null references public.units (id) on delete cascade,
  system_id           text not null default 'ODU-01' check (char_length(system_id) <= 40),
  -- فحص الضغط
  pressure_date       date,
  test_pressure       numeric(6, 3),
  hold_hours          numeric(6, 2),
  start_mpa           numeric(6, 3),
  end_mpa             numeric(6, 3),
  start_temp_c        numeric(5, 1),
  end_temp_c          numeric(5, 1),
  pressure_drop       numeric(7, 4),     -- محسوب (مصحّح بالحرارة إذا أُدخلت)
  pressure_ok         boolean,           -- محسوب
  -- الفاكيوم
  vacuum_date         date,
  vacuum_microns      integer check (vacuum_microns is null or vacuum_microns >= 0),
  vacuum_hold_min     integer check (vacuum_hold_min is null or vacuum_hold_min >= 0),
  vacuum_rise         integer check (vacuum_rise is null or vacuum_rise >= 0),
  vacuum_ok           boolean,           -- محسوب
  -- الشحن
  charge_calc_kg      numeric(7, 2) check (charge_calc_kg is null or charge_calc_kg > 0),
  charge_actual_kg    numeric(7, 2) check (charge_actual_kg is null or charge_actual_kg >= 0),
  charge_variance     numeric(7, 4),     -- محسوب (نسبة)
  charge_ok           boolean,           -- محسوب
  cylinder_no         text check (char_length(cylinder_no) <= 60),
  notes               text check (char_length(notes) <= 2000),
  inspector           uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now()
);
create index if not exists test_records_unit_idx on public.test_records (unit_id, created_at);

-- حساب النتائج من حدود البراند
create or replace function public.test_record_compute()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  b text;
  lim public.brand_limits;
  p_start_abs numeric;
  expected_end numeric;
begin
  select coalesce(u.brand, p.brand) into b
  from public.units u join public.projects p on p.id = u.project_id where u.id = new.unit_id;
  if b is null then
    raise exception 'حدّد البراند (LG أو Midea) للمشروع أو للوحدة قبل تسجيل القراءات';
  end if;
  select * into lim from public.brand_limits where brand = b;

  new.pressure_drop := null; new.pressure_ok := null;
  if new.start_mpa is not null and new.end_mpa is not null then
    if new.start_temp_c is not null and new.end_temp_c is not null then
      -- تصحيح الحرارة بقانون الغازات على الضغط المطلق (الضغط المُدخل ضغط مقياس)
      p_start_abs := new.start_mpa + 0.101325;
      expected_end := p_start_abs * (new.end_temp_c + 273.15) / (new.start_temp_c + 273.15) - 0.101325;
      new.pressure_drop := round(expected_end - new.end_mpa, 4);
    else
      new.pressure_drop := round(new.start_mpa - new.end_mpa, 4);
    end if;
    new.pressure_ok := new.pressure_drop <= lim.pressure_drop_max;
  end if;

  new.vacuum_ok := null;
  if new.vacuum_microns is not null then
    new.vacuum_ok := new.vacuum_microns <= lim.vacuum_max_microns
      and coalesce(new.vacuum_hold_min, 0) >= lim.vacuum_hold_min
      and coalesce(new.vacuum_rise, 0) <= lim.vacuum_rise_max;
  end if;

  new.charge_variance := null; new.charge_ok := null;
  if new.charge_calc_kg is not null and new.charge_actual_kg is not null then
    new.charge_variance := round((new.charge_actual_kg - new.charge_calc_kg) / new.charge_calc_kg, 4);
    new.charge_ok := abs(new.charge_variance) <= lim.charge_tolerance;
  end if;
  return new;
end $$;

drop trigger if exists test_records_compute on public.test_records;
create trigger test_records_compute before insert or update on public.test_records
  for each row execute function public.test_record_compute();

-- قراءة غير مقبولة ← المرحلة تصبح "فاشلة" تلقائياً (ويُفتح NCR تلقائياً)
create or replace function public.test_record_autofail()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pressure_ok = false then
    update public.unit_checks set result = 'fail',
      notes = format('قراءة الضغط غير مقبولة: هبوط %s MPa (%s)', new.pressure_drop, new.system_id)
    where unit_id = new.unit_id and checkpoint = 'pressure_test' and result <> 'fail';
  end if;
  if new.vacuum_ok = false then
    update public.unit_checks set result = 'fail',
      notes = format('قراءة الفاكيوم غير مقبولة: %s مايكرون، ثبات %s دقيقة، ارتفاع %s (%s)',
                     new.vacuum_microns, new.vacuum_hold_min, new.vacuum_rise, new.system_id)
    where unit_id = new.unit_id and checkpoint = 'vacuum' and result <> 'fail';
  end if;
  if new.charge_ok = false then
    update public.unit_checks set result = 'fail',
      notes = format('كمية الشحن خارج المسموح: فرق %s%% (%s)', round(new.charge_variance * 100, 1), new.system_id)
    where unit_id = new.unit_id and checkpoint = 'charging' and result <> 'fail';
  end if;
  return null;
end $$;

drop trigger if exists test_records_autofail on public.test_records;
create trigger test_records_autofail after insert or update on public.test_records
  for each row execute function public.test_record_autofail();

-- آخر قراءة لكل نظام (ODU) يجب أن تكون مقبولة
create or replace function public.readings_ok(p_unit uuid, p_kind text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare ok boolean; n int;
begin
  with latest as (
    select distinct on (system_id)
      case p_kind when 'pressure_test' then pressure_ok when 'vacuum' then vacuum_ok else charge_ok end as v
    from public.test_records
    where unit_id = p_unit
      and case p_kind when 'pressure_test' then pressure_ok when 'vacuum' then vacuum_ok else charge_ok end is not null
    order by system_id, created_at desc
  )
  select count(*), bool_and(v) into n, ok from latest;
  return n > 0 and ok;
end $$;

-- ---------- قواعد اعتماد النتائج (تُفرض على الخادم) ----------
create or replace function public.unit_check_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  missing text;
  req boolean;
  open_ncrs int;
begin
  new.unit_id := old.unit_id;
  new.checkpoint := old.checkpoint;

  if new.result is distinct from old.result or new.notes is distinct from old.notes then
    new.inspected_by := auth.uid();
    new.inspected_at := now();
  end if;

  if new.result = 'pass' and old.result <> 'pass' then
    -- 1) تسلسل المراحل
    select string_agg(c.name_ar, '، ' order by c.position) into missing
    from public.qc_checkpoints cp
    cross join unnest(cp.prereqs) as pr(key)
    join public.qc_checkpoints c on c.key = pr.key
    join public.unit_checks uc on uc.unit_id = new.unit_id and uc.checkpoint = pr.key
    where cp.key = new.checkpoint and uc.result not in ('pass', 'na');
    if missing is not null then
      raise exception 'لا يمكن اعتماد "%" قبل نجاح: %',
        (select name_ar from public.qc_checkpoints where key = new.checkpoint), missing;
    end if;

    -- 2) القراءات
    select p.require_readings into req
    from public.units u join public.projects p on p.id = u.project_id where u.id = new.unit_id;
    if req and new.checkpoint in ('pressure_test', 'vacuum', 'charging')
       and not public.readings_ok(new.unit_id, new.checkpoint) then
      raise exception 'لا يمكن اعتماد "%" بدون قراءة مقبولة في سجل القراءات لكل نظام',
        (select name_ar from public.qc_checkpoints where key = new.checkpoint);
    end if;

    -- 3) لا تسليم مع حالات عدم مطابقة مفتوحة
    if new.checkpoint = 'handover' then
      select count(*) into open_ncrs from public.ncrs where unit_id = new.unit_id and status = 'open';
      if open_ncrs > 0 then
        raise exception 'لا يمكن التسليم: توجد % حالة عدم مطابقة مفتوحة لهذه الوحدة', open_ncrs;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists unit_checks_before_update on public.unit_checks;
create trigger unit_checks_before_update before update on public.unit_checks
  for each row execute function public.unit_check_before_update();

-- ---------- سجل حالات عدم المطابقة (NCR) ----------
create table if not exists public.ncrs (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  ncr_no        integer not null,
  unit_id       uuid not null references public.units (id) on delete cascade,
  checkpoint    text not null references public.qc_checkpoints (key),
  description   text not null check (char_length(btrim(description)) between 1 and 2000),
  responsible   text check (char_length(responsible) <= 120),
  due_date      date,
  status        text not null default 'open' check (status in ('open', 'closed')),
  closure_note  text check (char_length(closure_note) <= 2000),
  raised_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  raised_at     timestamptz not null default now(),
  closed_by     uuid references public.profiles (id) on delete set null,
  closed_at     timestamptz,
  unique (project_id, ncr_no)
);
create index if not exists ncrs_unit_idx on public.ncrs (unit_id, status);

create or replace function public.ncr_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    select u.project_id into new.project_id from public.units u where u.id = new.unit_id;
    perform pg_advisory_xact_lock(hashtext(new.project_id::text));
    select coalesce(max(ncr_no), 0) + 1 into new.ncr_no from public.ncrs where project_id = new.project_id;
    new.raised_at := now();
    new.raised_by := auth.uid();
    new.status := 'open';
    new.closed_by := null; new.closed_at := null;
  else
    new.project_id := old.project_id; new.ncr_no := old.ncr_no; new.unit_id := old.unit_id;
    new.raised_at := old.raised_at; new.raised_by := old.raised_by;
    if new.status = 'closed' and old.status = 'open' then
      new.closed_by := auth.uid(); new.closed_at := now();
    elsif new.status = 'open' then
      new.closed_by := null; new.closed_at := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ncrs_before_write on public.ncrs;
create trigger ncrs_before_write before insert or update on public.ncrs
  for each row execute function public.ncr_before_write();

-- مرحلة فاشلة ← NCR مفتوح تلقائياً (إن لم يوجد واحد مفتوح لنفس المرحلة)
create or replace function public.unit_check_autoncr()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.result = 'fail' and old.result <> 'fail'
     and not exists (select 1 from public.ncrs where unit_id = new.unit_id and checkpoint = new.checkpoint and status = 'open') then
    insert into public.ncrs (unit_id, checkpoint, description)
    values (new.unit_id, new.checkpoint,
            coalesce(nullif(btrim(new.notes), ''), 'فشل فحص: ' || (select name_ar from public.qc_checkpoints where key = new.checkpoint)));
  end if;
  return null;
end $$;

drop trigger if exists unit_checks_autoncr on public.unit_checks;
create trigger unit_checks_autoncr after update on public.unit_checks
  for each row execute function public.unit_check_autoncr();

-- ---------- عرض مجمّع لكل وحدة (نتائجها كلها في سطر واحد، مثل ورقة Villa Tracker) ----------
create or replace view public.unit_overview with (security_invoker = true) as
select
  u.id, u.project_id, u.code, u.zone, u.crew, u.brand, u.remarks, u.created_at,
  coalesce(u.brand, p.brand) as effective_brand,
  (select jsonb_object_agg(c.checkpoint, c.result) from public.unit_checks c where c.unit_id = u.id) as results,
  (select count(*) from public.ncrs n where n.unit_id = u.id and n.status = 'open') as open_ncrs,
  (select max(c.inspected_at) from public.unit_checks c where c.unit_id = u.id) as last_inspection
from public.units u
join public.projects p on p.id = u.project_id;

-- ---------- المواد ----------
create table if not exists public.materials (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  unit        text check (char_length(unit) <= 40),
  qty         numeric(12, 2) check (qty is null or qty >= 0),
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists materials_project_idx on public.materials (project_id);

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
declare
  rid text;
  d jsonb;
begin
  d := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  rid := coalesce(d ->> 'id', d ->> 'unit_id', d ->> 'project_id', d ->> 'brand');
  insert into public.audit_log (actor, table_name, row_id, action, old_data, new_data)
  values (
    auth.uid(), tg_table_name, rid, tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'projects', 'project_finance', 'materials',
                           'units', 'test_records', 'ncrs', 'brand_limits'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.write_audit()', t);
  end loop;
  -- نتائج الفحص: نسجّل التعديلات فقط (الإنشاء التلقائي لـ 13 سطراً لكل وحدة لا داعي لتسجيله)
  drop trigger if exists audit_unit_checks on public.unit_checks;
  create trigger audit_unit_checks after update or delete on public.unit_checks
    for each row execute function public.write_audit();
end $$;

-- ==========================================================
-- قواعد الصلاحيات (RLS)
-- ==========================================================
alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_finance enable row level security;
alter table public.qc_checkpoints  enable row level security;
alter table public.brand_limits    enable row level security;
alter table public.units           enable row level security;
alter table public.unit_checks     enable row level security;
alter table public.test_records    enable row level security;
alter table public.ncrs            enable row level security;
alter table public.materials       enable row level security;
alter table public.audit_log       enable row level security;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.app_role(), public.is_staff(), public.is_admin() to authenticated;

-- صلاحيات صريحة (مشاريع Supabase الحديثة لا تمنحها تلقائياً)، وRLS هي التي تحدد الصفوف
grant usage on schema public to authenticated;
revoke all on all tables in schema public from authenticated;
grant select, update                 on public.profiles        to authenticated;
grant select, insert, update, delete on public.projects        to authenticated;
grant select, update                 on public.project_finance to authenticated;
grant select                         on public.qc_checkpoints  to authenticated;
grant select, update                 on public.brand_limits    to authenticated;
grant select, insert, update, delete on public.units           to authenticated;
grant select, update                 on public.unit_checks     to authenticated;
grant select, insert, update, delete on public.test_records    to authenticated;
grant select, insert, update, delete on public.ncrs            to authenticated;
grant select, insert, update, delete on public.materials       to authenticated;
grant select                         on public.audit_log       to authenticated;
grant select                         on public.unit_overview   to authenticated;

-- مساعد لإنشاء السياسات
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

  perform pg_temp.pol('project_finance', 'finance_select', 'select', staff, null);
  perform pg_temp.pol('project_finance', 'finance_update', 'update', staff, staff);

  perform pg_temp.pol('qc_checkpoints', 'checkpoints_select', 'select', member, null);

  perform pg_temp.pol('brand_limits', 'limits_select', 'select', member, null);
  perform pg_temp.pol('brand_limits', 'limits_update', 'update', admin, admin);

  perform pg_temp.pol('units', 'units_select', 'select', member, null);
  perform pg_temp.pol('units', 'units_insert', 'insert', null, staff);
  perform pg_temp.pol('units', 'units_update', 'update', staff, staff);
  perform pg_temp.pol('units', 'units_delete', 'delete', admin, null);

  perform pg_temp.pol('unit_checks', 'checks_select', 'select', member, null);
  perform pg_temp.pol('unit_checks', 'checks_update', 'update', staff, staff);

  -- الفني يسجّل القراءات ويعدّل قراءاته فقط
  perform pg_temp.pol('test_records', 'tests_select', 'select', member, null);
  perform pg_temp.pol('test_records', 'tests_insert', 'insert', null, member);
  perform pg_temp.pol('test_records', 'tests_update', 'update', staff || ' or inspector = auth.uid()', staff || ' or inspector = auth.uid()');
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

-- ==========================================================
-- بعد إنشاء أول مستخدم من لوحة Supabase، اجعله مديراً:
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
-- ==========================================================
