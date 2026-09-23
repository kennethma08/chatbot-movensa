import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import Chart from 'chart.js/auto';
import { AlertTriangle, ArrowUpRight, Building2, CircleOff, MessageCircleMore, MessagesSquare, PlugZap, UserCog, UserPlus, UsersRound, Wifi } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Badge, Card, ErrorState, LoadingState, PageHeader } from '../components/ui';
import { api, formatApiError } from '../lib/api';

Chart.defaults.font.family = 'Poppins, ui-sans-serif, system-ui, sans-serif';

type TenantDashboard = {
  mode: 'tenant'; totalConversations: number; newClients24h: number; totalMessages: number;
  openConversations: number; waitingConversations: number; onlineAgents: number; contactsToday: number;
  averageFirstResponseSeconds: number | null; aiMessagesToday: number;
  monthlyMessages: Array<{ month: string; count: number }>;
  messagesByChannel: Array<{ channel: string; count: number }>;
  recentActivity: Array<{ id: string; type: 'new_client' | 'conv_closed'; label: string; detail: string; at: string }>;
};
type SuperDashboard = {
  mode: 'super_admin'; total_companies: number; enabled_companies: number; disabled_companies: number;
  companies_without_integration: number; companies_with_low_coverage: number; companies_without_primary_admin: number;
  companies_with_recent_failures: number; total_alerts: number; active_sessions: number; stale_online_users: number;
  active_users: number; open_conversations: number; failed_outbox: number;
  alerts: Array<{ company_id: string; company_name: string; severity: 'high' | 'medium'; category: string; message: string }>;
  recentActivities: Array<{ id: string; company_id: string | null; company_name: string; activity_type: string; summary: string; success: boolean | null; created_at: string }>;
};

function timeGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';
}

export function DashboardPage() {
  const { user } = useAuth();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<TenantDashboard | SuperDashboard>('/dashboard') });
  if (query.isLoading) return <LoadingState label="Cargando el pulso del equipo…" />;
  if (query.isError) return <ErrorState message={formatApiError(query.error)} onRetry={() => void query.refetch()} />;
  const data = query.data!;
  if (data.mode === 'super_admin') return <>
    <PageHeader eyebrow="Vista global" title={`${timeGreeting()}, ${user?.name.split(' ')[0]}`} description="Estado operativo de todas las empresas y servicios." action={<Link className="button button--primary" to="/administracion/empresas">Ver empresas <ArrowUpRight size={16} /></Link>} />
    <div className="stat-grid stat-grid--three">
      <Stat icon={Building2} label="Empresas registradas" value={data.total_companies} />
      <Stat icon={PlugZap} label="Cobertura pendiente" value={data.companies_with_low_coverage} warning={data.companies_with_low_coverage > 0} />
      <Stat icon={AlertTriangle} label="Alertas importantes" value={data.total_alerts} warning={data.total_alerts > 0} />
    </div>
    <div className="stat-grid">
      <Stat icon={CircleOff} label="Sin integración" value={data.companies_without_integration} warning={data.companies_without_integration > 0} />
      <Stat icon={UserCog} label="Sin admin principal" value={data.companies_without_primary_admin} warning={data.companies_without_primary_admin > 0} />
      <Stat icon={Wifi} label="Sesiones activas" value={data.active_sessions} />
      <Stat icon={UsersRound} label="Online pegados" value={data.stale_online_users} warning={data.stale_online_users > 0} />
    </div>
    <div className="dashboard-super-grid">
      <Card className="panel-card"><div className="card-heading"><div><p className="eyebrow">Atención requerida</p><h2>Alertas importantes</h2></div><Link to="/administracion/configuracion">Ver todas</Link></div><div className="activity-list">
        {data.alerts.map((alert) => <Link to={`/administracion/empresas/${alert.company_id}/general`} className="activity-item" key={`${alert.category}-${alert.company_id}`}><span className={`alert-severity alert-severity--${alert.severity}`} /><div><strong>{alert.company_name} · {alert.category}</strong><span>{alert.message}</span></div><ArrowUpRight size={16} /></Link>)}
        {!data.alerts.length && <p className="muted">No hay alertas operativas activas.</p>}
      </div></Card>
      <Card className="panel-card"><div className="card-heading"><div><p className="eyebrow">Sistema</p><h2>Actividad reciente</h2></div><Link to="/administracion/operaciones">Ver toda</Link></div><div className="activity-list">
        {data.recentActivities.map((item) => <div className="activity-item" key={item.id}><span className={`activity-mark ${item.success === false ? 'activity-mark--error' : ''}`} /><div><strong>{item.company_name} · {item.activity_type}</strong><span>{item.summary}</span></div><time>{new Intl.DateTimeFormat('es-GT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.created_at))}</time></div>)}
        {!data.recentActivities.length && <p className="muted">Todavía no hay actividad reciente consolidada.</p>}
      </div></Card>
    </div>
  </>;
  return <>
    <div className="stat-grid stat-grid--two">
      <Stat icon={MessageCircleMore} label="Conversaciones" value={data.totalConversations} />
      <Stat icon={UserPlus} label="Clientes nuevos (24h)" value={data.newClients24h} />
    </div>
    <div className="dashboard-original-grid">
      <Card className="panel-card dashboard-monthly-card">
        <div className="card-heading"><div><h2>Mensajes por mes</h2></div></div>
        <MonthlyMessagesChart items={data.monthlyMessages} />
      </Card>
      <Card className="panel-card dashboard-channel-card">
        <div className="card-heading"><div><p className="eyebrow">Distribución total</p><h2>Canales</h2></div></div>
        <ChannelSummary items={data.messagesByChannel} total={data.totalMessages} />
        <div className="dashboard-total"><MessagesSquare size={16} /><span>Total mensajes</span><strong>{data.totalMessages}</strong></div>
      </Card>
      <Card className="panel-card dashboard-activity-card">
        <div className="card-heading"><div><p className="eyebrow">Últimos 7 días</p><h2>Actividad reciente</h2></div><span className="live-dot">Actualizado</span></div>
        <div className="activity-list">
          {data.recentActivity.slice(0, 5).map((item) => <Link to={item.type === 'conv_closed' ? `/conversaciones?selected=${item.id}` : '/contactos'} className="activity-item" key={`${item.type}-${item.id}`}><span className="activity-mark" /><div><strong>{item.label}</strong><span>{item.detail}</span></div><time>{new Intl.DateTimeFormat('es-GT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(item.at))}</time></Link>)}
          {!data.recentActivity.length && <p className="muted">La actividad aparecerá aquí.</p>}
        </div>
      </Card>
    </div>
  </>;
}

function Stat({ icon: Icon, label, value, warning = false }: { icon: typeof Building2; label: string; value: string | number; warning?: boolean }) {
  return <Card className={`stat-card ${warning ? 'stat-card--warning' : ''}`}><span className="stat-card__icon"><Icon size={19} /></span><div><span>{label}</span><strong>{value}</strong></div></Card>;
}

function MonthlyMessagesChart({ items }: { items: TenantDashboard['monthlyMessages'] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const palette = ['#df6b22', '#f08a46', '#f5a66f', '#b84d0c', '#7d350d'];
    const chart = new Chart(canvas.current, {
      type: 'bar',
      data: {
        labels: items.map((item) => new Intl.DateTimeFormat('es-GT', { month: 'short' }).format(new Date(`${item.month}-15T12:00:00`))),
        datasets: [{
          label: 'Mensajes',
          data: items.map((item) => item.count),
          backgroundColor: items.map((_item, index) => palette[index % palette.length]),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(184,77,12,.09)' }, ticks: { precision: 0 } },
          x: { grid: { display: false } },
        },
        plugins: { legend: { display: false } },
      },
    });
    return () => chart.destroy();
  }, [items]);
  return <div className="monthly-chart" role="img" aria-label="Mensajes por mes durante los últimos doce meses"><canvas ref={canvas} /></div>;
}

function ChannelSummary({ items, total }: { items: TenantDashboard['messagesByChannel']; total: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const hasData = items.length > 0;
    const chart = new Chart(canvas.current, {
      type: 'doughnut',
      data: {
        labels: hasData ? items.map((item) => item.channel === 'whatsapp' ? 'WhatsApp' : 'Sitio web') : ['Sin datos'],
        datasets: [{
          data: hasData ? items.map((item) => item.count) : [1],
          backgroundColor: hasData ? ['#df6b22', '#f08a46', '#f5a66f', '#b84d0c', '#7d350d'] : ['#eee9e4'],
          hoverBackgroundColor: hasData ? ['#c85b18', '#df6b22', '#f08a46', '#9e4109', '#642906'] : ['#ddd6cf'],
          borderColor: hasData ? '#fff' : '#eee9e4',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: { legend: { position: 'bottom' } },
      },
    });
    return () => chart.destroy();
  }, [items]);
  return <div className="channel-summary" role="img" aria-label={`Canales, ${total} mensajes`}><canvas ref={canvas} /></div>;
}
