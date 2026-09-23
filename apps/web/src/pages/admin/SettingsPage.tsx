import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Building2, Download, Layers3, Radio, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { api, downloadApiAsset, formatApiError } from '../../lib/api';

type SettingsData = {
  summary: {
    total_companies: number;
    enabled_companies: number;
    disabled_companies: number;
    total_alerts: number;
    active_sessions: number;
    companies_with_recent_failures: number;
    stale_online_users: number;
    companies_without_integration: number;
    companies_without_primary_admin: number;
  };
  modules: Array<{ module_name: string; enabled_companies: number; disabled_companies: number }>;
  alerts: Array<{ company_id: string; company_name: string; severity: 'high' | 'medium'; category: string; message: string }>;
  recentActivities: Array<{ id: string; company_name: string; activity_type: string; summary: string; success: boolean | null; created_at: string }>;
};

export function SettingsPage() {
  const query = useQuery({ queryKey: ['global-settings'], queryFn: () => api<SettingsData>('/admin/operations') });
  if (query.isLoading) return <LoadingState label="Cargando configuración global…" />;
  if (query.isError) return <ErrorState message={formatApiError(query.error)} onRetry={() => void query.refetch()} />;
  const { summary, modules, alerts, recentActivities } = query.data!;
  const modulesWithPending = modules.filter((item) => item.disabled_companies > 0).length;

  return <>
    <PageHeader
      eyebrow="Superadministración"
      title="Configuración global"
      description="Cobertura de módulos, exportaciones y alertas de todas las empresas."
      action={<div className="inline-actions"><Link className="button button--secondary" to="/inicio">Dashboard</Link><Link className="button button--secondary" to="/administracion/empresas">Empresas</Link><Link className="button button--secondary" to="/administracion/operaciones">Operación</Link></div>}
    />
    <div className="stat-grid">
      <GlobalStat icon={Building2} label="Empresas registradas" value={summary.total_companies} detail={'Activas: ' + summary.enabled_companies + ' · Deshabilitadas: ' + summary.disabled_companies} />
      <GlobalStat icon={AlertTriangle} label="Alertas activas" value={summary.total_alerts} detail="Pendientes de revisión" warning={summary.total_alerts > 0} />
      <GlobalStat icon={UsersRound} label="Sesiones activas" value={summary.active_sessions} detail="Actividad actual del sistema" />
      <GlobalStat icon={Layers3} label="Módulos" value={modules.length} detail={'Con pendientes: ' + modulesWithPending} warning={modulesWithPending > 0} />
    </div>
    <div className="dashboard-super-grid">
      <Card className="panel-card">
        <div className="card-heading"><div><p className="eyebrow">Respaldo operativo</p><h2>Exportaciones globales</h2></div><Download size={19} /></div>
        <div className="global-export-list">
          <ExportRow title="Empresas" detail="Listado general de empresas y estado operativo." onClick={() => void downloadApiAsset('/v1/admin/operations/export/companies', 'movensa-empresas.csv')} />
          <ExportRow title="Eventos" detail="Eventos técnicos y actividad reciente de integraciones." onClick={() => void downloadApiAsset('/v1/admin/operations/export/events', 'movensa-eventos.csv')} />
          <ExportRow title="Sesiones" detail="Sesiones activas, cierres y presencia de usuarios." onClick={() => void downloadApiAsset('/v1/admin/operations/export/sessions', 'movensa-sesiones.csv')} />
        </div>
      </Card>
      <Card className="panel-card">
        <div className="card-heading"><div><p className="eyebrow">Sistema</p><h2>Estado operativo</h2></div><Link to="/administracion/operaciones">Abrir operación</Link></div>
        <div className="settings-health-grid">
          <MiniStat label="Fallos recientes" value={summary.companies_with_recent_failures} detail="Empresas con errores recientes" />
          <MiniStat label="Online pegados" value={summary.stale_online_users} detail="Sesiones viejas sin cierre" />
          <MiniStat label="Sin integración" value={summary.companies_without_integration} detail="WhatsApp Cloud pendiente" />
          <MiniStat label="Sin admin" value={summary.companies_without_primary_admin} detail="Admin principal pendiente" />
        </div>
      </Card>
    </div>
    <div className="dashboard-super-grid">
      <Card className="panel-card">
        <div className="card-heading"><div><p className="eyebrow">Cobertura</p><h2>Módulos</h2></div><Radio size={19} /></div>
        <div className="global-module-list">
          {modules.map((item) => <div key={item.module_name}><span><strong>{item.module_name}</strong><small>Activas: {item.enabled_companies} · Pendientes: {item.disabled_companies}</small></span><Badge tone={item.disabled_companies ? 'orange' : 'green'}>{item.disabled_companies ? 'Revisar' : 'OK'}</Badge></div>)}
        </div>
      </Card>
      <Card className="panel-card">
        <div className="card-heading"><div><p className="eyebrow">Todas las empresas</p><h2>Alertas globales</h2></div><Link to="/administracion/operaciones">Ver todas</Link></div>
        <div className="activity-list">
          {alerts.slice(0, 8).map((alert) => <Link className="activity-item" to={'/administracion/empresas/' + alert.company_id + '/general'} key={alert.category + '-' + alert.company_id}><span className={'alert-severity alert-severity--' + alert.severity} /><div><strong>{alert.company_name} · {alert.category}</strong><span>{alert.message}</span></div></Link>)}
          {!alerts.length && <p className="muted">No hay alertas globales activas.</p>}
        </div>
      </Card>
    </div>
    <Card className="panel-card">
      <div className="card-heading"><div><p className="eyebrow">Sistema</p><h2>Actividad reciente</h2></div><Badge tone="neutral">{recentActivities.length} evento(s)</Badge></div>
      <div className="activity-list">
        {recentActivities.slice(0, 8).map((item) => <div className="activity-item" key={item.id}><span className={'activity-mark ' + (item.success === false ? 'activity-mark--error' : '')} /><div><strong>{item.company_name} · {item.activity_type}</strong><span>{item.summary}</span></div><time>{new Intl.DateTimeFormat('es-GT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.created_at))}</time></div>)}
        {!recentActivities.length && <p className="muted">Todavía no hay actividad reciente consolidada.</p>}
      </div>
    </Card>
  </>;
}

function GlobalStat({ icon: Icon, label, value, detail, warning = false }: { icon: typeof Building2; label: string; value: number; detail: string; warning?: boolean }) {
  return <Card className={'stat-card ' + (warning ? 'stat-card--warning' : '')}><span className="stat-card__icon"><Icon size={19} /></span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></Card>;
}

function MiniStat({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div className="settings-mini-stat"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function ExportRow({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return <div><span><strong>{title}</strong><small>{detail}</small></span><Button variant="secondary" onClick={onClick}><Download size={15} />Exportar</Button></div>;
}
