import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MessageView } from '@movensa/shared';
import { Download, Eye, X } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui';
import { api, formatApiError } from '../lib/api';
import { exportAgentReportPdf } from '../lib/reportPdf';

type AgentPerformance = {
  id: string; name: string; email: string; status: boolean; is_online: boolean; last_activity: string | null;
  handled_conversations: number; closed_conversations: number; open_load: number; sent_messages: number;
  average_first_response_seconds: number | null; average_resolution_minutes: number | null; sla_under_five_rate: number | null;
};
type Report = { team: AgentPerformance[] };
type Closure = {
  id: string; contact_phone: string; contact_name: string | null; started_at: string; ended_at: string;
  first_response_minutes: number | null; duration_minutes: number | null;
};

const dateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Costa_Rica' }).format(new Date(value))
  : 'N/D';

const minutes = (value: number | null) => value === null || value === undefined ? '—' : Number(value).toFixed(1);

export function AgentReportsPage() {
  const { companyId } = useParams();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [agentId, setAgentId] = useState('');
  const [conversation, setConversation] = useState<Closure | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const company = companyId ? `&companyId=${encodeURIComponent(companyId)}` : '';
  const range = `from=${encodeURIComponent(`${from}T00:00:00.000Z`)}&to=${encodeURIComponent(`${to}T23:59:59.999Z`)}${company}`;
  const validRange = Boolean(from && to && from <= to);
  const report = useQuery({
    queryKey: ['agent-report-options', companyId, from, to],
    queryFn: () => api<Report>(`/reports/overview?${range}`),
    enabled: validRange,
  });
  useEffect(() => {
    if (agentId && report.data?.team.some((agent) => agent.id === agentId)) return;
    setAgentId('');
  }, [agentId, report.data]);
  const selected = useMemo(() => report.data?.team.find((agent) => agent.id === agentId) ?? null, [agentId, report.data]);
  const closures = useQuery({
    queryKey: ['agent-closures-report', companyId, agentId, from, to],
    queryFn: () => api<Closure[]>(`/team/${agentId}/closures?${range}`),
    enabled: validRange && Boolean(agentId),
  });
  const messages = useQuery({
    queryKey: ['agent-report-conversation-messages', companyId, conversation?.id],
    queryFn: () => api<MessageView[]>(`/conversations/${conversation!.id}/messages?${companyId ? `companyId=${encodeURIComponent(companyId)}` : ''}`),
    enabled: Boolean(conversation),
  });

  const action = <div className="agent-report-controls">
    <div className="report-range">
      <label><span>Desde</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
      <label><span>Hasta</span><input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} /></label>
    </div>
    <label className="agent-report-select"><span>Agente</span><select value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={!report.data?.team.length}><option value="">Seleccione un agente</option>{report.data?.team.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agent.email})</option>)}</select></label>
    <Button variant="secondary" disabled={!selected || !validRange || closures.isLoading || exporting} onClick={() => { if (!selected) return; setExporting(true); setExportError(''); void exportAgentReportPdf({ agent: selected, closures: closures.data ?? [], from, to }).catch(() => setExportError('No se pudo generar el PDF.')).finally(() => setExporting(false)); }}><Download size={16} />{exporting ? 'Generando…' : 'Exportar PDF'}</Button>
  </div>;

  if (!validRange) return <><PageHeader eyebrow="Analíticas" title="Analíticas por agente" action={action} /><ErrorState message="Selecciona un rango de fechas válido." /></>;
  if (report.isError) return <><PageHeader eyebrow="Analíticas" title="Analíticas por agente" action={action} /><ErrorState message={formatApiError(report.error)} /></>;
  if (report.isLoading) return <><PageHeader eyebrow="Analíticas" title="Analíticas por agente" action={action} /><LoadingState label="Cargando agentes…" /></>;

  return <>
    <PageHeader eyebrow="Analíticas" title="Analíticas por agente" description="Consulta el rendimiento y las conversaciones cerradas de un agente en el periodo seleccionado." action={action} />
    {exportError && <p className="form-error standalone-message">{exportError}</p>}
    {!selected ? <EmptyState title="Selecciona un agente" detail="Elige un agente para consultar los indicadores y las conversaciones que cerró." /> : <>
      <div className="report-secondary-grid agent-report-kpis">
        <Metric label="Conversaciones cerradas" value={selected.closed_conversations} />
        <Metric label="Última actividad" value={dateTime(selected.last_activity)} />
        <Metric label="Estado" value={selected.is_online ? 'En línea' : 'Desconectado'} />
        <Metric label="Duración prom." value={`${minutes(selected.average_resolution_minutes)} min`} />
        <Metric label="1ra resp. prom." value={selected.average_first_response_seconds === null ? '—' : `${minutes(selected.average_first_response_seconds / 60)} min`} />
        <Metric label="Mensajes enviados" value={selected.sent_messages} />
        <Metric label="Conversaciones atendidas" value={selected.handled_conversations} />
        <Metric label="SLA < 5 min" value={selected.sla_under_five_rate === null ? '—' : `${Number(selected.sla_under_five_rate).toFixed(1)}%`} />
      </div>
      <Card className="table-card">
        <div className="card-heading table-card__heading"><div><p className="eyebrow">Detalle</p><h2>Conversaciones cerradas por agente</h2></div><Badge>{closures.data?.length ?? 0}</Badge></div>
        {closures.isError ? <ErrorState message={formatApiError(closures.error)} /> : closures.isLoading ? <LoadingState label="Cargando conversaciones cerradas…" /> : closures.data?.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Teléfono cliente</th><th>Inicio</th><th>Cierre</th><th>1ra resp. (min)</th><th>Duración (min)</th><th>Acciones</th></tr></thead><tbody>{closures.data.map((item) => <tr key={item.id}><td><strong>{item.contact_phone}</strong></td><td>{dateTime(item.started_at)}</td><td>{dateTime(item.ended_at)}</td><td>{minutes(item.first_response_minutes)}</td><td>{minutes(item.duration_minutes)}</td><td><Button variant="ghost" onClick={() => setConversation(item)}><Eye size={15} />Ver</Button></td></tr>)}</tbody></table></div> : <p className="empty-inline">No hay conversaciones cerradas por este agente en el periodo.</p>}
      </Card>
    </>}
    {conversation && <><button className="detail-backdrop" aria-label="Cerrar mensajes" onClick={() => setConversation(null)} /><aside className="detail-drawer conversation-report-drawer"><header><div><p className="eyebrow">Conversación</p><h2>{conversation.contact_name || conversation.contact_phone}</h2><span>{conversation.contact_phone}</span></div><Button variant="ghost" aria-label="Cerrar" onClick={() => setConversation(null)}><X size={18} /></Button></header><dl className="contact-history-meta"><div><dt>Inicio</dt><dd>{dateTime(conversation.started_at)}</dd></div><div><dt>Cierre</dt><dd>{dateTime(conversation.ended_at)}</dd></div></dl><h3>Mensajes</h3>{messages.isError ? <ErrorState message={formatApiError(messages.error)} /> : messages.isLoading ? <LoadingState label="Cargando mensajes…" /> : messages.data?.length ? <div className="report-conversation-messages">{messages.data.map((message) => <article className={`report-message report-message--${message.sender}`} key={message.id}><small>{message.sender === 'agent' ? 'Agente' : message.sender === 'ai' ? 'IA' : message.sender === 'bot' ? 'Bot' : message.sender === 'system' ? 'Sistema' : 'Contacto'} · {dateTime(message.sentAt)}</small><p>{message.message || `[${message.type}]`}</p></article>)}</div> : <p className="muted">Sin mensajes.</p>}</aside></>}
  </>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <Card className="report-metric"><span>{label}</span><strong>{value}</strong></Card>;
}
