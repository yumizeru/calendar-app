grant select, insert, update, delete on table public.user_data to service_role;
grant select, insert, update, delete on table public.reminders to service_role;
grant select, insert, update, delete on table public.push_subscriptions to service_role;
grant select, insert, update, delete on table public.widget_tokens to service_role;
select table_name, string_agg(privilege_type, ',' order by privilege_type) as service_role_privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'service_role'
group by table_name order by table_name;
