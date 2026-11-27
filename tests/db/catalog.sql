-- وصف بنية القاعدة للمقارنة: السياسات، والدوال وإعداداتها، والفهارس، والصلاحيات (مرتّبة)
select 'policy', schemaname, tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname in ('public', 'storage') order by 2, 3, 4;
select 'function', p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef, p.proconfig::text, md5(p.prosrc)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') order by 2, 3;
select 'index', tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 2, 3;
select 'column', table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' order by 2, 3;
select 'trigger', event_object_table, trigger_name, action_timing, event_manipulation from information_schema.triggers where trigger_schema = 'public' order by 2, 3, 5;
select 'grant', table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role') order by 2, 3, 4;
select 'colgrant', table_name, column_name, grantee, privilege_type from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated') and table_name = 'backups' order by 2, 3, 4, 5;
