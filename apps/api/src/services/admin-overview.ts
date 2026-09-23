import type { Database } from '../database.js';

export type AdminOverview = {
  summary: Record<string, number>;
  alerts: Array<Record<string, unknown>>;
  recentActivities: Array<Record<string, unknown>>;
  modules: Array<Record<string, unknown>>;
};

export async function loadAdminOverview(db: Database): Promise<AdminOverview> {
  const [summary] = await db<Array<Record<string, number>>>`
    select
      (select count(*)::int from public.companies) as total_companies,
      (select count(*)::int from public.companies where is_enabled) as enabled_companies,
      (select count(*)::int from public.companies where not is_enabled) as disabled_companies,
      (select count(*)::int from public.companies c where not exists (
        select 1 from public.integrations i where i.company_id=c.id and i.provider='whatsapp_cloud' and i.is_active
      )) as companies_without_integration,
      (select count(*)::int from public.companies c where c.is_enabled and (
        not exists (select 1 from public.users u where u.company_id=c.id and u.status)
        or not exists (select 1 from public.integrations i where i.company_id=c.id and i.provider='whatsapp_cloud' and i.is_active)
      )) as companies_with_low_coverage,
      (select count(*)::int from public.companies c where c.is_enabled and not exists (
        select 1 from public.users u where u.company_id=c.id and u.role='admin' and u.status
      )) as companies_without_primary_admin,
      (select count(*)::int from (
        select company_id from public.outbox_messages where status in ('failed','dead_letter') and created_at >= now() - interval '7 days'
        union
        select company_id from public.company_whatsapp_events where not success and created_at >= now() - interval '7 days'
      ) failures) as companies_with_recent_failures,
      (select count(*)::int from public.users where status and is_online and last_activity >= now() - interval '15 minutes') as active_sessions,
      (select count(*)::int from public.users where status and is_online and (last_activity is null or last_activity < now() - interval '15 minutes')) as stale_online_users,
      (select count(*)::int from public.users where status) as active_users,
      (select count(*)::int from public.conversations where status <> 'closed') as open_conversations,
      (select count(*)::int from public.outbox_messages where status in ('failed','dead_letter')) as failed_outbox,
      (select count(*)::int from public.received_messages where status='failed') as failed_inbox,
      (select count(*)::int from public.integrations where is_active and (access_token_ciphertext is null or app_secret_ciphertext is null)) as incomplete_integrations
  `;

  const alerts = await db<Array<Record<string, unknown>>>`
    select alert.company_id::text, alert.company_name, alert.severity, alert.category, alert.message
    from (
      select c.id as company_id,c.name as company_name,'high'::text as severity,'Integración'::text as category,
        'La empresa no tiene una integración activa de WhatsApp Cloud.'::text as message,1 as priority
      from public.companies c where c.is_enabled and not exists (
        select 1 from public.integrations i where i.company_id=c.id and i.provider='whatsapp_cloud' and i.is_active
      )
      union all
      select c.id,c.name,'high','Administración','La empresa no tiene un administrador principal activo.',2
      from public.companies c where c.is_enabled and not exists (
        select 1 from public.users u where u.company_id=c.id and u.role='admin' and u.status
      )
      union all
      select c.id,c.name,'medium','Cobertura','La empresa no tiene usuarios activos para atender conversaciones.',3
      from public.companies c where c.is_enabled and not exists (
        select 1 from public.users u where u.company_id=c.id and u.status
      )
      union all
      select c.id,c.name,'high','Entrega',count(o.id)::text || ' envío(s) fallaron durante los últimos 7 días.',4
      from public.companies c join public.outbox_messages o on o.company_id=c.id
      where o.status in ('failed','dead_letter') and o.created_at >= now() - interval '7 days'
      group by c.id,c.name
    ) alert
    order by alert.priority,alert.company_name
    limit 50
  `;

  const recentActivities = await db<Array<Record<string, unknown>>>`
    select activity.id,activity.company_id::text,activity.company_name,activity.activity_type,
      activity.summary,activity.success,activity.created_at::text
    from (
      select 'audit-' || a.id::text as id,a.company_id,c.name as company_name,a.action as activity_type,
        coalesce(a.actor_name || ' · ', '') || coalesce(a.detail::text, 'Cambio administrativo') as summary,
        null::boolean as success,a.created_at
      from public.company_admin_audits a join public.companies c on c.id=a.company_id
      union all
      select 'wa-' || e.id::text,e.company_id,c.name,e.event_type,e.summary,e.success,e.created_at
      from public.company_whatsapp_events e join public.companies c on c.id=e.company_id
      union all
      select 'session-' || s.id::text,s.company_id,coalesce(c.name,'Sistema global'),s.event_type,
        coalesce(s.user_name,s.email,'Usuario') || ' · ' || coalesce(s.role,'sin rol'),s.success,s.created_at
      from public.user_session_events s left join public.companies c on c.id=s.company_id
    ) activity
    order by activity.created_at desc
    limit 30
  `;

  const modules = await db<Array<Record<string, unknown>>>`
    with totals as (select count(*)::int as total from public.companies where is_enabled)
    select 'WhatsApp Cloud'::text as module_name,
      (select count(*)::int from public.companies c where c.is_enabled and exists (
        select 1 from public.integrations i where i.company_id=c.id and i.provider='whatsapp_cloud' and i.is_active
      )) as enabled_companies,
      totals.total - (select count(*)::int from public.companies c where c.is_enabled and exists (
        select 1 from public.integrations i where i.company_id=c.id and i.provider='whatsapp_cloud' and i.is_active
      )) as disabled_companies
    from totals
    union all
    select 'Webchat',
      (select count(*)::int from public.companies c where c.is_enabled and exists (
        select 1 from public.webchatbot_widgets w where w.company_id=c.id and w.is_active
      )),
      totals.total - (select count(*)::int from public.companies c where c.is_enabled and exists (
        select 1 from public.webchatbot_widgets w where w.company_id=c.id and w.is_active
      ))
    from totals
    union all
    select 'Inteligencia artificial',
      (select count(*)::int from public.companies c where c.is_enabled and exists (
        select 1 from public.company_ai_settings ai where ai.company_id=c.id and ai.is_enabled
      )),
      totals.total - (select count(*)::int from public.companies c where c.is_enabled and exists (
        select 1 from public.company_ai_settings ai where ai.company_id=c.id and ai.is_enabled
      ))
    from totals
  `;

  const normalizedSummary = summary ?? {};
  normalizedSummary.total_alerts = alerts.length;
  return { summary: normalizedSummary, alerts, recentActivities, modules };
}
