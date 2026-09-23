begin;

create or replace function public.claim_conversation(target_conversation_id bigint)
returns public.conversations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed public.conversations;
  actor_id bigint := app.current_user_id();
  actor_company bigint := app.current_company_id();
begin
  if actor_id is null or actor_company is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  update public.conversations
  set assigned_user_id = actor_id,
      assigned_by_user_id = actor_id,
      assigned_at = now(),
      status = case when status = 'waiting' then 'open' else status end
  where id = target_conversation_id
    and company_id = actor_company
    and status <> 'closed'
    and (assigned_user_id is null or assigned_user_id = actor_id)
  returning * into claimed;

  if claimed.id is null then
    raise exception 'Conversation unavailable or assigned to another agent' using errcode = 'P0001';
  end if;

  return claimed;
end;
$$;

create or replace function public.close_conversation(target_conversation_id bigint, farewell_text text default null)
returns public.conversations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  closed public.conversations;
  actor_id bigint := app.current_user_id();
  actor_company bigint := app.current_company_id();
  contact bigint;
  active_channel text;
begin
  if actor_id is null or actor_company is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select contact_id, channel into contact, active_channel
  from public.conversations
  where id = target_conversation_id and company_id = actor_company
  for update;

  if contact is null then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  if nullif(btrim(farewell_text), '') is not null then
    insert into public.messages(company_id, conversation_id, contact_id, sender, message, type, channel)
    values (actor_company, target_conversation_id, contact, 'agent', left(farewell_text, 1000), 'text', active_channel);
  end if;

  update public.conversations
  set status = 'closed', ended_at = now(), closed_by_user_id = actor_id, last_activity_at = now()
  where id = target_conversation_id and company_id = actor_company and status <> 'closed'
  returning * into closed;

  if closed.id is null then
    raise exception 'Conversation already closed' using errcode = 'P0001';
  end if;

  return closed;
end;
$$;

revoke all on function public.claim_conversation(bigint) from public, anon;
revoke all on function public.close_conversation(bigint, text) from public, anon;
grant execute on function public.claim_conversation(bigint) to authenticated;
grant execute on function public.close_conversation(bigint, text) to authenticated;

commit;
