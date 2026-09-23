import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Gauge, Mail, MessageCircleMore, Pencil, Search, X } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui';
import { api, formatApiError, jsonBody } from '../lib/api';

type Agent = { id: string; name: string; email: string; phone: string | null; status: boolean; is_online: boolean; last_activity: string | null; active_conversations: number; closed_today: number };
type TeamAnalytics = { summary: { open_conversations: number; average_load: number; closed_today: number }; agents: Agent[] };
type Closure = { id: string; contact_phone: string; contact_name: string | null; started_at: string; ended_at: string; duration_minutes: number };

export function TeamPage() {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [editing, setEditing] = useState(false);
  const query = useQuery({ queryKey: ['team-analytics'], queryFn: () => api<TeamAnalytics>('/team/analytics'), refetchInterval: 15_000 });
  const closures = useQuery({ queryKey: ['team-closures', selected?.id], queryFn: () => api<Closure[]>(`/team/${selected!.id}/closures`), enabled: Boolean(selected) });
  const rename = useMutation({ mutationFn: (name: string) => api<{ id: string; name: string }>(`/team/${selected!.id}/name`, { method: 'PATCH', ...jsonBody({ name }) }), onSuccess: async (updated) => { setSelected((current) => current ? { ...current, name: updated.name } : current); setEditing(false); await Promise.all([client.invalidateQueries({ queryKey: ['team-analytics'] }), client.invalidateQueries({ queryKey: ['team'] })]); } });
  const agents = useMemo(() => query.data?.agents.filter((agent) => `${agent.name} ${agent.email}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [], [query.data, search]);
  const pageCount = Math.max(1, Math.ceil(agents.length / pageSize));
  const rows = agents.slice(page * pageSize, page * pageSize + pageSize);
  if (query.isError) return <ErrorState message={formatApiError(query.error)} />;
  if (query.isLoading || !query.data) return <LoadingState label="Cargando analítica de agentes…" />;
  const { summary } = query.data;
  return <><PageHeader title="Agentes" />
    <div className="stat-grid stat-grid--three"><TeamStat icon={MessageCircleMore} label="Conversaciones abiertas" value={summary.open_conversations} /><TeamStat icon={Gauge} label="Carga promedio" value={Number(summary.average_load).toFixed(1)} /><TeamStat icon={CheckCircle2} label="Cierres hoy" value={summary.closed_today} /></div>
    <Card className="table-card"><div className="table-toolbar table-toolbar--original"><label className="table-length">Mostrar <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }}>{[5,10,25,50,100].map((size) => <option key={size} value={size}>{size}</option>)}</select> registros</label><div className="search-box"><Search size={17} /><input aria-label="Buscar agentes" placeholder="Buscar agente o correo…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} onKeyDown={(event) => { if (event.key === 'Escape') setSearch(''); }} /></div></div>
      {rows.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Agente</th><th>Correo</th><th>Cierres hoy</th><th>Detalle</th></tr></thead><tbody>{rows.map((agent) => <tr key={agent.id}><td><div className="table-person"><span className="avatar avatar--small">{agent.name.slice(0, 1).toUpperCase()}</span><strong>{agent.name}</strong></div></td><td>{agent.email}</td><td><strong>{agent.closed_today}</strong></td><td><Button variant="ghost" onClick={() => { setSelected(agent); setEditing(false); }}>Ver</Button></td></tr>)}</tbody></table></div> : <EmptyState title="No hay agentes" detail="No se encontraron agentes para esta empresa." />}
      {agents.length > 0 && <div className="table-pagination"><span>Mostrando {page * pageSize + 1} a {Math.min((page + 1) * pageSize, agents.length)} de {agents.length}</span><div><Button variant="ghost" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Anterior</Button><span>{page + 1} / {pageCount}</span><Button variant="ghost" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Siguiente</Button></div></div>}
    </Card>
    {selected && <><button className="drawer-backdrop drawer-backdrop--visible" aria-label="Cerrar detalle" onClick={() => setSelected(null)} /><aside className="detail-drawer" aria-label={`Detalle de ${selected.name}`}><header><div><p className="eyebrow">Cierres — Agente</p><h2>{selected.name}</h2></div><Button variant="ghost" aria-label="Cerrar" onClick={() => setSelected(null)}><X size={18} /></Button></header><div className="detail-drawer__identity"><span className="avatar avatar--large">{selected.name.slice(0, 1).toUpperCase()}</span><div>{editing ? <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); rename.mutate(String(new FormData(event.currentTarget).get('name'))); }}><input name="name" defaultValue={selected.name} required /><Button type="submit">Guardar</Button></form> : <><strong>{selected.name}</strong><button aria-label="Editar nombre" onClick={() => setEditing(true)}><Pencil size={14} /></button></>}<span><Mail size={14} />{selected.email}</span></div></div><div className="drawer-summary drawer-summary--single"><div><span>Cierres totales</span><strong>{closures.data?.length ?? '—'}</strong></div></div>{rename.isError && <p className="form-error">{formatApiError(rename.error)}</p>}<h3>Listado de cierres</h3>{closures.isLoading ? <LoadingState /> : closures.data?.length ? <div className="closure-list">{closures.data.map((item) => <article key={item.id}><div><strong>{item.contact_name ?? item.contact_phone}</strong><span>Conversación #{item.id} · {item.contact_phone}</span></div><time>{new Intl.DateTimeFormat('es-GT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.ended_at))}</time><b>{Number(item.duration_minutes).toFixed(1)} min</b></article>)}</div> : <EmptyState title="Sin cierres" detail="Este agente todavía no tiene conversaciones cerradas." />}</aside></>}
  </>;
}

function TeamStat({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: string | number }) {
  return <Card className="stat-card"><span className="stat-card__icon"><Icon size={19} /></span><div><span>{label}</span><strong>{value}</strong></div></Card>;
}
