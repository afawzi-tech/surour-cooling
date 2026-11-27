-- مشترك بين ملفات الاختبار: أربعة مستخدمين (مدير، مشرف، فني، موقوف) ودوال مساعدة.
-- a1 = مدير، b2 = مشرف، c3 = فني، d4 = حساب موقوف
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@x.iq'),
  ('00000000-0000-0000-0000-0000000000b2', 'sup@x.iq'),
  ('00000000-0000-0000-0000-0000000000c3', 'tech@x.iq'),
  ('00000000-0000-0000-0000-0000000000d4', 'off@x.iq')
on conflict (id) do nothing;
update public.profiles set role = 'admin'      where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'supervisor' where id = '00000000-0000-0000-0000-0000000000b2';
update public.profiles set active = false      where id = '00000000-0000-0000-0000-0000000000d4';

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

