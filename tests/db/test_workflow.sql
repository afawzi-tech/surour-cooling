-- اختبارات قواعد العمل على الخادم: مراحل المشروع، تقارير الفني، من سجّل القراءة.
\set ON_ERROR_STOP 1
\ir helpers.sql
\set A '00000000-0000-0000-0000-0000000000a1'
\set S '00000000-0000-0000-0000-0000000000b2'
\set T '00000000-0000-0000-0000-0000000000c3'

insert into public.crews (id, name, kind) values ('11111111-1111-1111-1111-111111111111', 'فرقة الاختبار', 'internal');
insert into public.crews (id, name, kind) values ('22222222-2222-2222-2222-222222222222', 'فرقة أخرى', 'internal');
update public.profiles set crew_id = '11111111-1111-1111-1111-111111111111' where id = :'T';
insert into public.projects (id, client) values ('33333333-3333-3333-3333-333333333333', 'مشروع المراحل');
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;

-- ---- المشرف يبدأ مرحلة: تاريخ البدء يُملأ على الخادم ----
select pg_temp.login(:'S');
insert into public.project_stages (project_id, checkpoint, status, crew_id)
values ('33333333-3333-3333-3333-333333333333', 'site_ready', 'in_progress', '11111111-1111-1111-1111-111111111111');
select pg_temp.ok((select start_date = public.today_iq() and end_date is null and updated_by = :'S'
  from public.project_stages where checkpoint = 'site_ready'), 'جارية تملأ تاريخ البدء ومن عدّل');
insert into public.project_stages (project_id, checkpoint, status, crew_id)
values ('33333333-3333-3333-3333-333333333333', 'piping', 'not_started', '22222222-2222-2222-2222-222222222222');
reset role;

-- ---- الفني: لا يعدّل المراحل مباشرة، ويبلّغ عن مراحل فرقته فقط ----
select pg_temp.login(:'T');
update public.project_stages set status = 'done' where checkpoint = 'site_ready';
select pg_temp.ok((select status from public.project_stages where checkpoint = 'site_ready') = 'in_progress', 'الفني لم يعدّل المرحلة مباشرة');
select pg_temp.expect_error($$insert into public.stage_requests (project_id, checkpoint, action) values ('33333333-3333-3333-3333-333333333333', 'piping', 'start')$$,
  'تقرير عن مرحلة فرقة أخرى');
select pg_temp.expect_error($$insert into public.stage_requests (project_id, checkpoint, action) values ('33333333-3333-3333-3333-333333333333', 'site_ready', 'start')$$,
  'بدء مرحلة بدأت من قبل');
select pg_temp.expect_error($$insert into public.stage_requests (project_id, checkpoint, action) values ('33333333-3333-3333-3333-333333333333', 'site_ready', 'done')$$,
  'إكمال بلا صورة');
select pg_temp.expect_error(format($$insert into public.stage_requests (project_id, checkpoint, action, photo_path) values ('33333333-3333-3333-3333-333333333333', 'site_ready', 'done', '33333333-3333-3333-3333-333333333333/%s/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg')$$, :'S'),
  'صورة في مجلد مستخدم آخر');
with x as (
  insert into public.stage_requests (project_id, checkpoint, action, photo_path, status, requested_by)
  values ('33333333-3333-3333-3333-333333333333', 'site_ready', 'done',
          '33333333-3333-3333-3333-333333333333/' || :'T' || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg', 'approved', :'A')
  returning id)
insert into ids select 'req1', id from x;
select pg_temp.ok((select status = 'pending' and requested_by = :'T' from public.stage_requests where id = (select v from ids where k = 'req1')),
  'الحالة ومن أرسل يضبطهما الخادم مهما أرسل الهاتف');
select pg_temp.expect_error($$insert into public.stage_requests (project_id, checkpoint, action, photo_path) values ('33333333-3333-3333-3333-333333333333', 'site_ready', 'done', '33333333-3333-3333-3333-333333333333/00000000-0000-0000-0000-0000000000c3/bbbbbbbb-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg')$$,
  'طلبان معلّقان لنفس المرحلة');
select pg_temp.expect_error(format($$select public.review_stage_request(%L, true)$$, (select v from ids where k = 'req1')), 'الفني يوافق على تقريره');
reset role;

-- ---- المشرف: الرفض يحتاج سبباً، والموافقة تكمل المرحلة وتبدأ التالية بنفس الفرقة ----
select pg_temp.login(:'S');
select pg_temp.expect_error(format($$select public.review_stage_request(%L, false, '  ')$$, (select v from ids where k = 'req1')), 'رفض بلا سبب');
select public.review_stage_request((select v from ids where k = 'req1'), true);
select pg_temp.ok((select status = 'done' and end_date = public.today_iq() from public.project_stages where checkpoint = 'site_ready'), 'الموافقة تكمل المرحلة');
select pg_temp.ok((select status = 'in_progress' and crew_id = '11111111-1111-1111-1111-111111111111'
  from public.project_stages where checkpoint = 'equipment_set'), 'المرحلة التالية بدأت وبقيت مع الفرقة');
select pg_temp.expect_error(format($$select public.review_stage_request(%L, true)$$, (select v from ids where k = 'req1')), 'مراجعة الطلب مرتين');
reset role;
select pg_temp.ok((select count(*) from public.audit_log where table_name = 'stage_requests') >= 2, 'التقارير في سجل العمليات');

-- ---- القراءات: من سجّل كل قسم يُحفظ على الخادم ----
insert into public.units (id, project_id, code) values ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'V-001');
select pg_temp.login(:'T');
insert into public.test_records (unit_id, start_mpa, end_mpa, vacuum_by) values ('44444444-4444-4444-4444-444444444444', 4.15, 4.14, :'A');
select pg_temp.ok((select pressure_by = :'T' and vacuum_by is null from public.test_records), 'قسم الضغط باسم الفني، والفاكيوم الفارغ بلا اسم مهما أرسل الهاتف');
reset role;
select pg_temp.login(:'S');
update public.test_records set vacuum_microns = 400;
select pg_temp.ok((select pressure_by = :'T' and vacuum_by = :'S' from public.test_records), 'تعديل الفاكيوم لا يغيّر صاحب قراءة الضغط');
reset role;

-- ---- رابط الخريطة https فقط ----
select pg_temp.expect_error($$update public.projects set map_url = 'javascript:alert(1)' where client = 'مشروع المراحل'$$, 'رابط خريطة غير آمن');
