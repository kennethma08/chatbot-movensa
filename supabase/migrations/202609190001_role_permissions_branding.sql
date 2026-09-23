-- The React client uses Supabase for identity only. Business data is accessed
-- through the API, where role, tenant and action-level permissions are checked.
-- Removing direct table/RPC privileges prevents a user from bypassing that API
-- with the public project key.
revoke all on all tables in schema public from authenticated;
revoke all on all sequences in schema public from authenticated;
revoke all on all functions in schema public from public, authenticated;

drop policy if exists companies_update on public.companies;
drop policy if exists companies_super_insert on public.companies;
drop policy if exists companies_super_delete on public.companies;
drop policy if exists contacts_write on public.contacts;
drop policy if exists conversations_write on public.conversations;
drop policy if exists messages_write on public.messages;
drop policy if exists profiles_admin_write on public.profiles;
drop policy if exists users_admin_write on public.users;
drop policy if exists templates_admin_write on public.whatsapp_templates;
drop policy if exists whatsapp_flows_admin_write on public.whatsapp_bot_flows;
drop policy if exists webchat_flows_admin_write on public.webchatbot_flows;
drop policy if exists webchat_widgets_admin_write on public.webchatbot_widgets;
drop policy if exists ai_knowledge_admin_write on public.company_ai_knowledge_items;

alter table public.webchatbot_widgets alter column font_family set default 'Poppins';
alter table public.webchatbot_widgets alter column brand_text set default 'Grupo Movensa';

update public.webchatbot_widgets
set
  font_family = 'Poppins',
  brand_text = regexp_replace(brand_text, 'ULU', 'Grupo Movensa', 'gi')
where font_family <> 'Poppins' or brand_text ~* 'ULU';
