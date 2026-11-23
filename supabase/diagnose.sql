-- 調査用（読み取りだけ・何も変更しません）
select 'grant' as kind, grantee || ' : ' || string_agg(privilege_type, ',' order by privilege_type) as info
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'reminders'
group by grantee
union all
select 'role', rolname || ' bypassrls=' || rolbypassrls
from pg_roles where rolname in ('service_role', 'authenticated', 'anon')
union all
select 'cron', jobname || ' / ' || schedule || ' / active=' || active
from cron.job
union all
select 'cron-run', status || ' ' || coalesce(left(return_message, 80), '') || ' @ ' || start_time::text
from (select * from cron.job_run_details order by start_time desc limit 3) r;
