-- اختبارات تقوية الحماية (المجموعة 2): الحساب الجديد غير مفعّل، من أنشأ، رابط الخريطة، تثبيت المرحلة، آخر مدير، حذف المواد.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'adm2@x.iq'),
  ('00000000-0000-0000-0000-0000000000e2', 'sup2@x.iq'),
  ('00000000-0000-0000-0000-0000000000e3', 'new@x.iq');
create function pg_temp.login(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create function pg_temp.expect_error(q text, what text) returns void language plpgsql as $$
begin begin execute q; exception when others then return; end; raise exception 'كان يجب أن يُمنع: %', what; end $$;
create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'فشل: %', what; end if; end $$;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.ok((select not active from public.profiles where id = '00000000-0000-0000-0000-0000000000e3'), 'الحساب الجديد غير مفعّل');
update public.profiles set active = true, role = 'admin' where id = '00000000-0000-0000-0000-0000000000e1';
update public.profiles set active = true, role = 'supervisor' where id = '00000000-0000-0000-0000-0000000000e2';
-- الحساب غير المفعّل لا يرى شيئاً
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select pg_temp.ok((select count(*) from public.projects) = 0, 'غير المفعّل لا يرى المشاريع');
reset role;

-- المشرف: من أنشأ = هو، مهما أرسل
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
insert into public.projects (client, created_by) values ('تزوير', '00000000-0000-0000-0000-0000000000e1');
select pg_temp.ok((select created_by from public.projects where client = 'تزوير') = '00000000-0000-0000-0000-0000000000e2', 'created_by يُفرض على الخادم');
-- رابط الخريطة
update public.projects set map_url = 'https://maps.app.goo.gl/abc123' where client = 'تزوير';
update public.projects set map_url = 'https://www.google.com/maps/place/x?y=1' where client = 'تزوير';
update public.projects set map_url = 'https://waze.com/ul?ll=33.3,44.4' where client = 'تزوير';
select pg_temp.expect_error($$update public.projects set map_url = 'https://evil.example/phish' where client = 'تزوير'$$, 'رابط ليس خريطة');
select pg_temp.expect_error($$update public.projects set map_url = 'https://maps.app.goo.gl.evil.com/x' where client = 'تزوير'$$, 'نطاق شبيه');
select pg_temp.expect_error($$update public.projects set map_url = 'javascript:alert(1)' where client = 'تزوير'$$, 'javascript');
-- المرحلة لا تنتقل لمشروع آخر
insert into public.projects (client) values ('مشروع ثان');
insert into public.project_stages (project_id, checkpoint, status) values ((select id from public.projects where client = 'تزوير'), 'site_ready', 'in_progress');
update public.project_stages set project_id = (select id from public.projects where client = 'مشروع ثان'), checkpoint = 'handover'
  where project_id = (select id from public.projects where client = 'تزوير');
select pg_temp.ok((select count(*) from public.project_stages where project_id = (select id from public.projects where client = 'تزوير') and checkpoint = 'site_ready') = 1, 'المرحلة مثبّتة بمشروعها');
-- المشرف لا يحذف المواد
insert into public.materials (project_id, name) values ((select id from public.projects where client = 'تزوير'), 'نحاس');
delete from public.materials where name = 'نحاس';
select pg_temp.ok((select count(*) from public.materials where name = 'نحاس') = 1, 'المشرف لا يحذف المواد');
reset role;

-- آخر مدير: نخفّض كل المديرين إلا واحداً، ثم نحاول تعطيله
update public.profiles set role = 'technician' where role = 'admin' and id <> '00000000-0000-0000-0000-0000000000e1';
select pg_temp.expect_error($$update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000000e1'$$, 'تعطيل آخر مدير');
select pg_temp.expect_error($$update public.profiles set role = 'supervisor' where id = '00000000-0000-0000-0000-0000000000e1'$$, 'تخفيض آخر مدير');
