import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CircleAlert, Download, Radio, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { api, downloadApiAsset, formatApiError } from '../../lib/api';

type Operations = {
  summary: {
    total_alerts: number;
    companies_with_recent_failures: number;
    active_sessions: number;
    stale_online_users: number;
  };
  alerts: Array<{ company_id: string; company_name: string; severity: 'high' | 'medium'; category: string; message: string }>;
  recentActivities: Array<{ id: string; company_id: string | null; company_name: string; activity_type: string; summary: string; success: boolean | null; created_at: string }>;
};

const pageSize = 10;

export function OperationsPage() {
  const [alertPage, setAlertPage] = useState(0);
  const [activityPage, setActivityPage] = useState(0);
  const query = useQuery({ queryKey: ['operations'], queryFn: () => api<Operations>('/admin/operations'), refetchInterval: 15_000 });
  if (query.isLoading) return <LoadingState label="Consultando operación…" />;
  if (query.isError) return <ErrorState message={formatApiError(query.error)} />;
  const { summary, alerts, recentActivities } = query.data!;
  const alertPages = Math.max(1, Math.ceil(alerts.length / pageSize));
  const activityPages = Math.max(1, Math.ceil(recentActivities.length / pageSize));
  const visibleAlerts = alerts.slice(alertPage * pageSize, alertPage * pageSize + pageSize);
  const visibleActivities = recentActivities.slice(activityPage * pageSize, activityPage * pageSize + pageSize);

  return <>
    <PageHeader
      eyebrow="Superadministración"
      title="Operación"
      description="Alertas y actividad reciente de todas las empresas."
      action={<div className="inline-actions">
        <Link className="button button--secondary" to="/administracion/configuracion">Configuración global</Link>
        <Button variant="secondary" onClick={() => void downloadApiAsset('/v1/admin/operations/export/events', 'movensa-eventos.csv')}><Download size={15} />Exportar eventos</Button>
        <Button variant="secondary" onClick={() => void downloadApiAsset('/v1/admin/operations/export/sessions', 'movensa-sesiones.csv')}><Download size={15} />Exportar sesiones</Button>
      </div>}
    />
    <div className="stat-grid">
      <OpsStat icon={AlertTriangle} label="Alertas activas" value={summary.total_alerts} detail="Pendientes de revisión" warn />
      <OpsStat icon={CircleAlert} label="Fallos recientes" value={summary.companies_with_recent_failures} detail="Empresas con errores recientes" warn />
      <OpsStat icon={UsersRound} label="Sesiones activas" value={summary.active_sessions} detail="Actividad actual del sistema" />
      <OpsStat icon={Radio} label="Online pegados" value={summary.stale_online_users} detail="Sesiones viejas sin cierre" warn />
    </div>
    <div className="dashboard-super-grid">
      <Card className="panel-card">
        <div className="card-heading"><div><p className="eyebrow">Empresas</p><h2>Alertas operativas</h2></div><Badge tone={alerts.length ? 'orange' : 'green'}>{alerts.length}</Badge></div>
        <div className="activity-list">
          {visibleAlerts.map((alert) => <Link className="activity-item" to={`/administracion/empresas/${alert.company_id}/general`} key={`${alert.category}-${alert.company_id}`}><span className={`alert-severity alert-severity--${alert.severity}`} /><div><strong>{alert.company_name} · {alert.category}</strong><span>{alert.message}</span></div><small>Abrir</small></Link>)}
          {!alerts.length && <p className="muted">No hay alertas operativas activas.</p>}
        </div>
        <Pager page={alertPage} pages={alertPages} onPage={setAlertPage} />
      </Card>
      <Card className="panel-card">
        <div className="card-heading"><div><p className="eyebrow">Sistema</p><h2>Actividad reciente</h2></div><Badge tone="neutral">{recentActivities.length}</Badge></div>
        <div className="activity-list">
          {visibleActivities.map((item) => <div className="activity-item" key={item.id}><span className={`activity-mark ${item.success === false ? 'activity-mark--error' : ''}`} /><div><strong>{item.company_name} · {item.activity_type}</strong><span>{item.summary}</span></div><time>{new Intl.DateTimeFormat('es-GT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.created_at))}</time></div>)}
          {!recentActivities.length && <p className="muted">Todavía no hay actividad reciente consolidada.</p>}
        </div>
        <Pager page={activityPage} pages={activityPages} onPage={setActivityPage} />
      </Card>
    </div>
  </>;
}

function OpsStat({ icon: Icon, label, value, detail, warn = false }: { icon: typeof AlertTriangle; label: string; value: number; detail: string; warn?: boolean }) {
  return <Card className={`stat-card ${warn && value ? 'stat-card--warning' : ''}`}><span className="stat-card__icon"><Icon size={19} /></span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></Card>;
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <div className="table-pagination"><span>Página {page + 1} de {pages}</span><div><Button variant="ghost" disabled={page === 0} onClick={() => onPage(page - 1)}>Anterior</Button><Button variant="ghost" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Siguiente</Button></div></div>;
}
