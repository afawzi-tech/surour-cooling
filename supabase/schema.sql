-- ==========================================================
-- مصاعد السرور / التبريد المركزي
-- مخطط قاعدة البيانات وقواعد الصلاحيات (RLS) على Supabase
--
-- طريقة التشغيل: Supabase → SQL Editor → الصق الملف كاملاً → Run
-- الملف آمن لإعادة التشغيل (يستخدم IF NOT EXISTS / OR REPLACE).
--
-- الأدوار:
--   admin       مدير: كل شيء، إدارة المستخدمين، الحذف، سجل العمليات، الاستيراد
--   supervisor  مشرف: إنشاء العقود وتعديلها، المراحل، المواد، يرى قيمة العقد
--   technician  فني: يرى المشاريع (بدون قيمة العقد) ويحدّث المراحل فقط
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

-- إنشاء ملف تعريف تلقائياً لكل مستخدم جديد (بدور فني افتراضياً)
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

-- دور المستخدم الحالي (null إذا كان غير مسجّل أو معطّلاً)
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_staff()      -- مدير أو مشرف
returns boolean language sql stable as $$ select public.app_role() in ('admin', 'supervisor') $$;

create or replace function public.is_admin()
returns boolean language sql stable as $$ select public.app_role() = 'admin' $$;

-- منع المدير من إزالة صلاحيته عن نفسه بالخطأ
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
  brand          text check (brand in ('lg', 'midea')),   -- البراند: LG أو Midea
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

-- لقواعد البيانات المنشأة قبل إضافة البراند
alter table public.projects add column if not exists brand text check (brand in ('lg', 'midea'));

-- قيمة العقد في جدول منفصل حتى لا يراها الفني
create table if not exists public.project_finance (
  project_id  uuid primary key references public.projects (id) on delete cascade,
  total_iqd   numeric(16, 0) check (total_iqd is null or total_iqd >= 0)
);

-- ---------- المراحل ----------
create table if not exists public.project_stages (
  project_id  uuid not null references public.projects (id) on delete cascade,
  stage_key   text not null check (stage_key in
              ('contract', 'survey', 'start', 'indoor_materials', 'welding', 'piping', 'drain', 'signal')),
  position    smallint not null,
  status      text not null default 'not_started' check (status in ('not_started', 'in_progress', 'done')),
  workers     integer check (workers is null or workers between 0 and 1000),
  start_date  date,
  end_date    date,
  notes       text check (char_length(notes) <= 4000),
  checklist   jsonb not null default '{}'::jsonb,   -- قائمة جاهزية الموقع (مرحلة الكشف)
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (project_id, stage_key),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- إنشاء المراحل الثماني تلقائياً مع كل عقد جديد
create or replace function public.create_project_stages()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_stages (project_id, stage_key, position, status, start_date, end_date)
  values
    (new.id, 'contract',         1, 'done', new.contract_date, new.contract_date),
    (new.id, 'survey',           2, 'not_started', null, null),
    (new.id, 'start',            3, 'not_started', null, null),
    (new.id, 'indoor_materials', 4, 'not_started', null, null),
    (new.id, 'welding',          5, 'not_started', null, null),
    (new.id, 'piping',           6, 'not_started', null, null),
    (new.id, 'drain',            7, 'not_started', null, null),
    (new.id, 'signal',           8, 'not_started', null, null);
  insert into public.project_finance (project_id) values (new.id);
  return new;
end $$;

drop trigger if exists projects_create_stages on public.projects;
create trigger projects_create_stages
  after insert on public.projects
  for each row execute function public.create_project_stages();

-- التواريخ التلقائية عند تغيير الحالة + من عدّل ومتى
create or replace function public.stage_before_update()
returns trigger language plpgsql as $$
begin
  if new.stage_key = 'contract' then
    new.status := 'done';                         -- مرحلة العقد مكتملة دائماً
  end if;
  if new.status is distinct from old.status then
    if new.status = 'in_progress' and new.start_date is null then
      new.start_date := current_date;
    elsif new.status = 'done' then
      if new.start_date is null then new.start_date := current_date; end if;
      if new.end_date is null then new.end_date := current_date; end if;
    elsif new.status = 'not_started' then
      new.end_date := null;
    end if;
  end if;
  new.project_id := old.project_id;              -- لا يُسمح بنقل المرحلة لمشروع آخر
  new.stage_key  := old.stage_key;
  new.position   := old.position;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists stages_before_update on public.project_stages;
create trigger stages_before_update
  before update on public.project_stages
  for each row execute function public.stage_before_update();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch
  before update on public.projects
  for each row execute function public.touch_updated_at();

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
begin
  rid := coalesce(
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'project_id');
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
  foreach t in array array['profiles', 'projects', 'project_finance', 'project_stages', 'materials'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.write_audit()', t);
  end loop;
end $$;

-- ==========================================================
-- قواعد الصلاحيات على مستوى الصف (RLS)
-- ==========================================================
alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_finance enable row level security;
alter table public.project_stages  enable row level security;
alter table public.materials       enable row level security;
alter table public.audit_log       enable row level security;

-- الزائر غير المسجّل لا يملك أي صلاحية
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.app_role(), public.is_staff(), public.is_admin() to authenticated;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.app_role() is not null);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke insert, delete on public.profiles from authenticated;

-- projects
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (public.app_role() is not null);
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated
  with check (public.is_staff());
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete to authenticated
  using (public.is_admin());

-- project_finance (قيمة العقد: المدير والمشرف فقط)
drop policy if exists finance_select on public.project_finance;
create policy finance_select on public.project_finance for select to authenticated
  using (public.is_staff());
drop policy if exists finance_update on public.project_finance;
create policy finance_update on public.project_finance for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
revoke insert, delete on public.project_finance from authenticated;

-- project_stages (الجميع يقرأ ويحدّث، والإنشاء تلقائي فقط)
drop policy if exists stages_select on public.project_stages;
create policy stages_select on public.project_stages for select to authenticated
  using (public.app_role() is not null);
drop policy if exists stages_update on public.project_stages;
create policy stages_update on public.project_stages for update to authenticated
  using (public.app_role() is not null) with check (public.app_role() is not null);
revoke insert, delete on public.project_stages from authenticated;

-- materials
drop policy if exists materials_select on public.materials;
create policy materials_select on public.materials for select to authenticated
  using (public.app_role() is not null);
drop policy if exists materials_insert on public.materials;
create policy materials_insert on public.materials for insert to authenticated
  with check (public.is_staff());
drop policy if exists materials_update on public.materials;
create policy materials_update on public.materials for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists materials_delete on public.materials;
create policy materials_delete on public.materials for delete to authenticated
  using (public.is_staff());

-- audit_log (قراءة للمدير فقط، ولا يمكن لأحد تعديله أو حذفه من الواجهة)
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (public.is_admin());
revoke insert, update, delete on public.audit_log from authenticated;

-- ==========================================================
-- بعد إنشاء أول مستخدم من لوحة Supabase، اجعله مديراً بهذا الأمر
-- (غيّر البريد إلى بريدك):
--
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
-- ==========================================================
