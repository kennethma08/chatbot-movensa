import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Chart from 'chart.js/auto';
import { CheckCircle2, Download, Globe2, MessageCircle, MessagesSquare, UsersRound } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader } from '../components/ui';
import { api, formatApiError } from '../lib/api';
import { exportGeneralReportPdf } from '../lib/reportPdf';

Chart.defaults.font.family = 'Poppins, ui-sans-serif, system-ui, sans-serif';

type Overview = {
  conversations: number; total_messages: number; closed: number; new_clients: number; open_conversations: number;
  active_clients: number; active_countries: number; messages_per_conversation: number | null;
  average_first_response_seconds: number | null; average_resolution_minutes: number | null;
  sla_under_five_rate: number | null; escalated_conversations: number; average_rating: number | null; ai_messages: number;
};
type AgentPerformance = { id: string; name: string; email: string; status: boolean; is_online: boolean; last_activity: string | null; handled_conversations: number; closed_conversations: number; open_load: number; sent_messages: number; average_first_response_seconds: number | null; average_resolution_minutes: number | null; sla_under_five_rate: number | null };
type Report = { from: string; to: string; overview: Overview; series: Array<{ day: string; messages: number }>; countries: Array<{ country: string; count: number }>; channels: Array<{ channel: string; count: number }>; topClients: Array<{ id: string; name: string; phone_number: string; messages: number }>; team: AgentPerformance[] };

function duration(seconds: number | null) {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
}

export function ReportsPage() {
  const { companyId } = useParams();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const range = `from=${encodeURIComponent(`${from}T00:00:00.000Z`)}&to=${encodeURIComponent(`${to}T23:59:59.999Z`)}${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ''}`;
  const query = useQuery({ queryKey: ['reports', companyId, from, to], queryFn: () => api<Report>(`/reports/overview?${range}`), enabled: Boolean(from && to && from <= to) });
  const header = <PageHeader eyebrow="Analíticas" title="Analíticas generales" description="Indicadores generales de conversaciones, mensajes, clientes y rendimiento del equipo." action={<div className="report-range"><label><span>Desde</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label><span>Hasta</span><input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} /></label><Button variant="secondary" disabled={!from || !to || from > to || !query.data || exporting} onClick={() => { if (!query.data) return; setExporting(true); setExportError(''); void exportGeneralReportPdf(query.data, from, to).catch(() => setExportError('No se pudo generar el PDF.')).finally(() => setExporting(false)); }}><Download size={16} />{exporting ? 'Generando…' : 'Exportar PDF'}</Button></div>} />;
  if (!from || !to || from > to) return <>{header}<ErrorState message="Selecciona un rango de fechas válido." /></>;
  if (query.isError) return <>{header}<ErrorState message={formatApiError(query.error)} /></>;
  if (query.isLoading || !query.data) return <>{header}<LoadingState label="Calculando todos los indicadores…" /></>;
  const report = query.data;
  const overview = report.overview;
  return <>{header}
    {exportError && <p className="form-error standalone-message">{exportError}</p>}
    <div className="stat-grid stat-grid--three report-primary-kpis"><ReportStat icon={MessagesSquare} label="Total de mensajes" value={overview.total_messages} /><ReportStat icon={CheckCircle2} label="Conversaciones cerradas" value={overview.closed} /><ReportStat icon={UsersRound} label="Clientes nuevos" value={overview.new_clients} /></div>
    <div className="report-secondary-grid"><Metric label="Conversaciones abiertas" value={overview.open_conversations} hint="Sesiones activas" /><Metric label="Clientes activos" value={overview.active_clients} hint="Con mensajes en el rango" /><Metric label="Países activos" value={overview.active_countries} hint="Distribución geográfica" /><Metric label="Msgs por conversación" value={overview.messages_per_conversation ?? '—'} hint="Promedio del periodo" /><Metric label="1ra respuesta prom." value={duration(overview.average_first_response_seconds)} hint="Tiempo de atención" /><Metric label="Resolución prom." value={overview.average_resolution_minutes === null ? '—' : `${Number(overview.average_resolution_minutes).toFixed(1)} min`} hint="Conversaciones cerradas" /><Metric label="SLA < 5 min" value={overview.sla_under_five_rate === null ? '—' : `${Number(overview.sla_under_five_rate).toFixed(1)}%`} hint="Primera respuesta" /><Metric label="Escaladas a agente" value={overview.escalated_conversations} hint="Solicitud humana" /></div>
    <div className="report-chart-grid"><Card className="panel-card"><div className="card-heading"><div><p className="eyebrow">Volumen</p><h2>Mensajes por fecha</h2></div></div><ReportLineChart items={report.series} /></Card><Card className="panel-card"><div className="card-heading"><div><p className="eyebrow">Geografía</p><h2>Países de los contactos</h2></div><Globe2 size={19} /></div><CountryDoughnut items={report.countries} /></Card></div>
    <div className="report-table-grid"><Card className="table-card"><div className="card-heading table-card__heading"><div><p className="eyebrow">Clientes</p><h2>Top clientes por mensajes</h2></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Cliente</th><th>Teléfono</th><th>Mensajes</th></tr></thead><tbody>{report.topClients.map((client) => <tr key={client.id}><td><strong>{client.name}</strong></td><td>{client.phone_number}</td><td><Badge tone="orange">{client.messages}</Badge></td></tr>)}</tbody></table></div>{!report.topClients.length && <p className="empty-inline">Sin actividad.</p>}</Card><Card className="table-card"><div className="card-heading table-card__heading"><div><p className="eyebrow">Agentes</p><h2>Rendimiento del equipo</h2></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Agente</th><th>Atendidas</th><th>Cerradas</th><th>Carga abierta</th><th>1ra resp. prom.</th><th>Resolución prom.</th><th>SLA &lt; 5 min</th></tr></thead><tbody>{report.team.map((agent) => <tr key={agent.id}><td><div className="table-person"><span className="avatar avatar--small">{agent.name.slice(0, 2).toUpperCase()}</span><div><strong>{agent.name}</strong><span>{agent.email}</span></div></div></td><td>{agent.handled_conversations}</td><td>{agent.closed_conversations}</td><td>{agent.open_load}</td><td>{duration(agent.average_first_response_seconds)}</td><td>{agent.average_resolution_minutes === null ? '—' : `${Number(agent.average_resolution_minutes).toFixed(1)} min`}</td><td>{agent.sla_under_five_rate === null ? '—' : `${Number(agent.sla_under_five_rate).toFixed(1)}%`}</td></tr>)}</tbody></table></div>{!report.team.length && <p className="empty-inline">Sin agentes.</p>}</Card></div>
  </>;
}

function ReportStat({ icon: Icon, label, value }: { icon: typeof MessageCircle; label: string; value: string | number }) { return <Card className="stat-card"><span className="stat-card__icon"><Icon size={19} /></span><div><span>{label}</span><strong>{value}</strong></div></Card>; }
function Metric({ label, value, hint }: { label: string; value: string | number; hint: string }) { return <Card className="report-metric"><span>{label}</span><strong>{value}</strong><small>{hint}</small></Card>; }

function ReportLineChart({ items }: { items: Report['series'] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const chart = new Chart(canvas.current, {
      type: 'line',
      data: { labels: items.map((item) => new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'short' }).format(new Date(`${item.day}T12:00:00`))), datasets: [{ label: 'Mensajes', data: items.map((item) => item.messages), tension: .3, fill: true, borderColor: '#df6b22', backgroundColor: 'rgba(223,107,34,.16)' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    });
    return () => chart.destroy();
  }, [items]);
  return <div className="report-chart-canvas" role="img" aria-label="Mensajes por fecha"><canvas ref={canvas} /></div>;
}

function CountryDoughnut({ items }: { items: Report['countries'] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const hasData = items.length > 0;
    const chart = new Chart(canvas.current, {
      type: 'doughnut',
      data: { labels: hasData ? items.map((item) => item.country) : ['Sin datos'], datasets: [{ data: hasData ? items.map((item) => item.count) : [1], backgroundColor: hasData ? ['#df6b22', '#f08a46', '#f5a66f', '#b84d0c', '#7d350d'] : ['#eee9e4'], borderColor: '#fff', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'bottom' } } },
    });
    return () => chart.destroy();
  }, [items]);
  return <div className="report-chart-canvas" role="img" aria-label="Países de los contactos"><canvas ref={canvas} /></div>;
}
