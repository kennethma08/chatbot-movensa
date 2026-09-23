begin;

create or replace function app.current_user_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.status = true
  limit 1
$$;

create or replace function app.current_company_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select u.company_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.status = true
  limit 1
$$;

create or replace function app.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.role
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.status = true
  limit 1
$$;

create or replace function app.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_app_role() = 'super_admin', false)
$$;

create or replace function app.is_company_admin(target_company_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_super_admin() or (
    app.current_app_role() = 'admin'
    and app.current_company_id() = target_company_id
  )
$$;

create or replace function app.can_access_company(target_company_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_super_admin() or app.current_company_id() = target_company_id
$$;

revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated;
grant execute on function app.current_user_id() to authenticated;
grant execute on function app.current_company_id() to authenticated;
grant execute on function app.current_app_role() to authenticated;
grant execute on function app.is_super_admin() to authenticated;
grant execute on function app.is_company_admin(bigint) to authenticated;
grant execute on function app.can_access_company(bigint) to authenticated;

alter table public.companies enable row level security;
alter table public.companies force row level security;
create policy companies_read on public.companies for select to authenticated
  using (app.can_access_company(id));

create policy companies_update on public.companies for update to authenticated
  using (app.is_company_admin(id)) with check (app.is_company_admin(id));

create policy companies_super_insert on public.companies for insert to authenticated
  with check (app.is_super_admin());
create policy companies_super_delete on public.companies for delete to authenticated
  using (app.is_super_admin());

do $$
declare
  table_name text;
  tenant_tables text[] := array[
    'profiles','users','contacts','conversations','messages','attachments','integrations',
    'whatsapp_templates','received_messages','outbox_messages','bot_settings',
    'whatsapp_bot_flows','whatsapp_bot_execution_states','webchatbot_flows',
    'webchatbot_widgets','webchatbot_installation_keys','webchatbot_sessions',
    'webchatbot_messages','webchatbot_events','company_ai_settings',
    'company_ai_knowledge_items','ai_usage_logs','ai_conversation_logs',
    'company_admin_audits','company_whatsapp_events','data_retention_policies'
  ];
begin
  foreach table_name in array tenant_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.can_access_company(company_id))',
      table_name || '_tenant_read', table_name
    );
  end loop;
end
$$;

alter table public.user_session_events enable row level security;
alter table public.user_session_events force row level security;
create policy session_events_read on public.user_session_events for select to authenticated
  using (app.is_super_admin() or (company_id is not null and app.is_company_admin(company_id)) or user_id = app.current_user_id());

-- Direct browser access is read-only and only for non-secret operational data.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on table
  public.companies,
  public.profiles,
  public.users,
  public.contacts,
  public.conversations,
  public.messages,
  public.attachments,
  public.whatsapp_templates,
  public.whatsapp_bot_flows,
  public.webchatbot_flows,
  public.webchatbot_widgets,
  public.webchatbot_sessions,
  public.webchatbot_messages,
  public.company_ai_knowledge_items,
  public.company_admin_audits,
  public.company_whatsapp_events,
  public.user_session_events
to authenticated;

-- Sensitive ciphertext and token hashes remain behind the API.
create or replace view public.company_integration_status
with (security_invoker = true)
as
select
  id,
  company_id,
  provider,
  phone_number_id,
  waba_id,
  app_id,
  api_base_url,
  api_version,
  is_active,
  (access_token_ciphertext is not null) as has_access_token,
  (app_secret_ciphertext is not null) as has_app_secret,
  (verify_token_hash is not null) as has_verify_token,
  created_at,
  updated_at
from public.integrations;

create or replace view public.company_ai_settings_safe
with (security_invoker = true)
as
select
  id,
  company_id,
  is_enabled,
  provider,
  model,
  api_base_url,
  response_mode,
  system_prompt,
  fallback_message,
  temperature,
  max_tokens,
  daily_message_limit,
  monthly_message_limit,
  pause_when_assigned,
  escalate_on_human_request,
  (api_key_ciphertext is not null) as has_api_key,
  created_at,
  updated_at,
  last_tested_at,
  last_test_success,
  last_test_message
from public.company_ai_settings;

grant select on public.company_integration_status, public.company_ai_settings_safe to authenticated;

-- API mutations run in transactions and set these local claims. These policies are
-- also useful to exercise tenant isolation without the service role.
create policy contacts_write on public.contacts for all to authenticated
  using (app.can_access_company(company_id))
  with check (app.can_access_company(company_id));
create policy conversations_write on public.conversations for all to authenticated
  using (app.can_access_company(company_id))
  with check (app.can_access_company(company_id));
create policy messages_write on public.messages for insert to authenticated
  with check (app.can_access_company(company_id));

create policy profiles_admin_write on public.profiles for all to authenticated
  using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));
create policy users_admin_write on public.users for all to authenticated
  using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));
create policy templates_admin_write on public.whatsapp_templates for all to authenticated
  using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));
create policy whatsapp_flows_admin_write on public.whatsapp_bot_flows for all to authenticated
  using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));
create policy webchat_flows_admin_write on public.webchatbot_flows for all to authenticated
  using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));
create policy webchat_widgets_admin_write on public.webchatbot_widgets for all to authenticated
  using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));
create policy ai_knowledge_admin_write on public.company_ai_knowledge_items for all to authenticated
  using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));

grant insert, update, delete on public.contacts, public.conversations to authenticated;
grant insert on public.messages to authenticated;
grant insert, update, delete on
  public.profiles,
  public.users,
  public.whatsapp_templates,
  public.whatsapp_bot_flows,
  public.webchatbot_flows,
  public.webchatbot_widgets,
  public.company_ai_knowledge_items
to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Storage remains private. The API returns short-lived signed URLs.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'chat-attachments',
      'chat-attachments',
      false,
      20971520,
      array['image/jpeg','image/png','image/webp','image/gif','application/pdf','audio/mpeg','audio/ogg','audio/webm','audio/mp4','audio/wav']
    )
    on conflict (id) do update set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('widget-assets', 'widget-assets', true, 5242880, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do update set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$$;

commit;
