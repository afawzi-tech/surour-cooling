-- استيراد Excel بدفعات (set_unit_checks) وسجل العمليات بلا تعديلات فارغة.
\set ON_ERROR_STOP 1
\ir helpers.sql
insert into public.projects (id, client, project_type, unit_label) values ('44444444-4444-4444-4444-444444444444', 'مجمّع الدفعات', 'compound', 'فيلا');
insert into public.units (id, project_id, code) values
  ('55555555-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'B-001'),
  ('55555555-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'B-002');

-- المشرف: دفعة واحدة تغيّر 3 نتائج، والرابعة مطابقة لما هو موجود فلا تُحتسب
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select pg_temp.ok(public.set_unit_checks('[
  {"unit_id":"55555555-0000-0000-0000-000000000001","checkpoint":"site_ready","result":"pass"},
  {"unit_id":"55555555-0000-0000-0000-000000000001","checkpoint":"equipment_set","result":"fail"},
  {"unit_id":"55555555-0000-0000-0000-000000000002","checkpoint":"site_ready","result":"na"},
  {"unit_id":"55555555-0000-0000-0000-000000000002","checkpoint":"piping","result":"pending"}]'::jsonb) = 3, 'الدفعة تغيّر 3 نتائج');
select pg_temp.ok((select result from public.unit_checks where unit_id = '55555555-0000-0000-0000-000000000001' and checkpoint = 'equipment_set') = 'fail', 'النتيجة حُفظت');
select pg_temp.ok((select inspected_by from public.unit_checks where unit_id = '55555555-0000-0000-0000-000000000001' and checkpoint = 'site_ready') = '00000000-0000-0000-0000-0000000000b2', 'الختم على الخادم');
reset role;

-- الفني: الدالة لا تتجاوز الصلاحيات (لا يغيّر النتائج)
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select pg_temp.ok(public.set_unit_checks('[{"unit_id":"55555555-0000-0000-0000-000000000002","checkpoint":"handover","result":"pass"}]'::jsonb) = 0, 'الفني لا يغيّر النتائج عبر الدفعة');
reset role;

-- غير المسجّل لا يستدعيها
set role anon;
select pg_temp.expect_error($$select public.set_unit_checks('[]'::jsonb)$$, 'anon يستدعي set_unit_checks');
reset role;

-- تعديل بلا تغيير لا يُسجَّل في سجل العمليات
select count(*) as before from public.audit_log where table_name = 'units' \gset
update public.units set code = code where project_id = '44444444-4444-4444-4444-444444444444';
select pg_temp.ok((select count(*) from public.audit_log where table_name = 'units') = :before, 'تعديل فارغ لا يُسجَّل');
update public.units set remarks = 'تغيير حقيقي' where id = '55555555-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) from public.audit_log where table_name = 'units') = :before + 1, 'التعديل الحقيقي يُسجَّل');
