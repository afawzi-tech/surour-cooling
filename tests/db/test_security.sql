-- اختبارات الصلاحيات والنسخ الاحتياطي. أي فشل يوقف التشغيل برسالة واضحة.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@x.iq'),
  ('00000000-0000-0000-0000-0000000000b2', 'sup@x.iq'),
  ('00000000-0000-0000-0000-0000000000c3', 'tech@x.iq'),
  ('00000000-0000-0000-0000-0000000000d4', 'off@x.iq');
update public.profiles set role = 'admin'      where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'supervisor' where id = '00000000-0000-0000-0000-0000000000b2';
update public.profiles set active = false      where id = '00000000-0000-0000-0000-0000000000d4';
insert into public.projects (client) values ('مشروع اختبار');

create function pg_temp.login(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
  execute 'set role authenticated';
end $$;
create function pg_temp.expect_error(q text, what text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then return; end;
  raise exception 'كان يجب أن يُمنع: %', what;
end $$;
create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'فشل: %', what; end if; end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---- الفني ----
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select pg_temp.ok((select count(*) from public.projects) = 1, 'الفني يرى المشاريع');
select pg_temp.expect_error($$insert into public.projects (client) values ('x')$$, 'الفني ينشئ مشروعاً');
select pg_temp.expect_error($$select public.take_backup()$$, 'الفني يأخذ نسخة احتياطية');
select pg_temp.expect_error($$select public.backup_data(1)$$, 'الفني ينزّل نسخة');
select pg_temp.expect_error($$select public.make_backup('manual')$$, 'الفني يستدعي make_backup');
select pg_temp.ok((select count(*) from public.backups) = 0, 'الفني لا يرى النسخ');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c3';
reset role;
select pg_temp.ok((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000c3') = 'technician', 'الفني لم يرقِّ نفسه');

-- ---- الحساب الموقوف ----
select pg_temp.login('00000000-0000-0000-0000-0000000000d4');
select pg_temp.ok((select count(*) from public.projects) = 0, 'الموقوف لا يرى المشاريع');
select pg_temp.ok((select count(*) from public.profiles) = 1, 'الموقوف يرى ملفه فقط');
reset role;

-- ---- المشرف ----
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
insert into public.projects (client) values ('مشروع المشرف');
select pg_temp.expect_error($$select public.take_backup()$$, 'المشرف يأخذ نسخة احتياطية');
select pg_temp.ok((select count(*) from public.backups) = 0, 'المشرف لا يرى النسخ');
delete from public.projects where client = 'مشروع المشرف';   -- الحذف للمدير: لا يحذف شيئاً
reset role;
select pg_temp.ok((select count(*) from public.projects where client = 'مشروع المشرف') = 1, 'المشرف لم يحذف');

-- ---- المدير والنسخ الاحتياطي ----
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select public.take_backup();
select pg_temp.expect_error($$select public.take_backup()$$, 'نسختان يدويتان خلال دقيقتين');
select pg_temp.ok((select count(*) from public.backups) = 1, 'المدير يرى النسخة');
select pg_temp.ok((select (counts->>'projects')::int from public.backups) = 2, 'النسخة فيها المشروعان');
select pg_temp.expect_error($$select data from public.backups$$, 'قراءة محتوى النسخة مباشرة');
select pg_temp.ok((public.backup_data((select max(id) from public.backups)) -> 'tables' -> 'projects') is not null, 'تنزيل النسخة');
select pg_temp.expect_error($$delete from public.backups$$, 'حذف النسخ');
select pg_temp.expect_error($$insert into public.backups (kind, counts, size_bytes, data) values ('auto', '{}', 0, '{}')$$, 'إضافة نسخة مزوّرة');
select pg_temp.expect_error($$update public.backups set kind = 'auto'$$, 'تعديل نسخة');
reset role;
select pg_temp.ok((select count(*) from public.backups) = 1, 'المدير لم يحذف النسخة');
select pg_temp.ok((select count(*) from public.audit_log where table_name = 'backups' and action = 'DOWNLOAD') = 1, 'التنزيل في سجل العمليات');
select pg_temp.ok((select count(*) from public.audit_log where table_name = 'backups' and action = 'INSERT') = 1, 'أخذ النسخة في سجل العمليات');

-- الاحتفاظ: 30 نسخة تلقائية فقط
select public.make_backup('auto') from generate_series(1, 33);
select pg_temp.ok((select count(*) from public.backups where kind = 'auto') = 30, 'الاحتفاظ بآخر 30 نسخة تلقائية');

-- كل الدوال فيها search_path ثابت
select pg_temp.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  'كل الدوال لها search_path ثابت: ' || (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')));

-- لا سياسة تستدعي auth.uid() أو دوال الدور لكل صف
select pg_temp.ok(not exists (
  select 1 from pg_policies where schemaname in ('public', 'storage')
    and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '\(\s*SELECT\s+(auth\.uid\(\)|app_role\(\)|is_staff\(\)|is_admin\(\))', '', 'gi')
        ~* '(auth\.uid\(\)|app_role\(\)|is_staff\(\)|is_admin\(\))'),
  'سياسات تعيد حساب الدور لكل صف: ' || (select string_agg(policyname, ', ') from pg_policies where schemaname in ('public', 'storage')
    and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '\(\s*SELECT\s+(auth\.uid\(\)|app_role\(\)|is_staff\(\)|is_admin\(\))', '', 'gi')
        ~* '(auth\.uid\(\)|app_role\(\)|is_staff\(\)|is_admin\(\))'));

-- anon لا يرى أي جدول
set role anon;
select pg_temp.expect_error($$select 1 from public.projects$$, 'الزائر يقرأ المشاريع');
select pg_temp.expect_error($$select 1 from public.backups$$, 'الزائر يقرأ النسخ');
reset role;
