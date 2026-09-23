import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Building2, ContactRound, MessageCircleMore, MessagesSquare, Plus, Power, Search, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui';
import { api, formatApiError, jsonBody } from '../../lib/api';

type Company = {
  id: string;
  name: string;
  code: string;
  contact_email: string | null;
  contact_phone: string | null;
  time_zone: string;
  is_enabled: boolean;
  users: number;
  contacts: number;
  open_conversations: number;
  messages: number;
  last_inbound_message_at: string | null;
  recent_failures: number;
  alerts_count: number;
  integration_ready: boolean;
};

function health(company: Company): { label: string; tone: 'neutral' | 'orange' | 'green' | 'red' } {
  if (!company.is_enabled) return { label: 'Deshabilitada', tone: 'neutral' };
  if (company.alerts_count > 0 || company.recent_failures > 0) return { label: 'Con alertas', tone: 'red' };
  if (!company.integration_ready) return { label: 'Sin integración', tone: 'red' };
  if (company.users === 0) return { label: 'Sin usuarios', tone: 'red' };
  if (!company.last_inbound_message_at) return { label: 'Sin tráfico', tone: 'orange' };
  if (company.open_conversations > 10) return { label: 'Carga alta', tone: 'orange' };
  return { label: 'Operativa', tone: 'green' };
}

function inboundLabel(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function CompaniesPage() {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [coverage, setCoverage] = useState('all');
  const [page, setPage] = useState(0);
  const query = useQuery({ queryKey: ['companies'], queryFn: () => api<Company[]>('/admin/companies') });
  const toggle = useMutation({
    mutationFn: (id: string) => api(`/admin/companies/${id}/toggle`, { method: 'PATCH', ...jsonBody({}) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['companies'] }),
  });
  const filtered = useMemo(() => query.data?.filter((company) => {
    const matchesSearch = `${company.name} ${company.code} ${company.contact_email ?? ''}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase());
    const matchesStatus = status === 'all' || (status === 'enabled') === company.is_enabled;
    const matchesCoverage = coverage === 'all'
      || (coverage === 'ready' && company.integration_ready)
      || (coverage === 'pending' && !company.integration_ready)
      || (coverage === 'attention' && company.is_enabled && (!company.integration_ready || company.users === 0));
    return matchesSearch && matchesStatus && matchesCoverage;
  }) ?? [], [query.data, search, status, coverage]);
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const rows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  return <>
    <PageHeader
      eyebrow="Administración global"
      title="Empresas"
      action={<Link className="button button--primary" to="/administracion/empresas/nueva"><Plus size={16} />Nueva empresa</Link>}
    />
    <Card className="company-filters">
      <label>Buscar<div className="search-box"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Nombre, código o correo de empresa" /></div></label>
      <label>Estado<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="all">Todos</option><option value="enabled">Habilitadas</option><option value="disabled">Deshabilitadas</option></select></label>
      <label>Cobertura<select value={coverage} onChange={(event) => { setCoverage(event.target.value); setPage(0); }}><option value="all">Todas</option><option value="ready">Con integración</option><option value="pending">Sin integración</option><option value="attention">Requieren atención</option></select></label>
    </Card>
    {toggle.isError && <p className="form-error standalone-message">{formatApiError(toggle.error)}</p>}
    {query.isLoading ? <SkeletonRows count={5} /> : query.isError ? <ErrorState message={formatApiError(query.error)} /> : rows.length ? <>
      <div className="company-grid">
        {rows.map((company) => {
          const state = health(company);
          return <Card className="company-card" key={company.id}>
            <div className="company-card__head">
              <span className="company-logo"><Building2 size={20} /></span>
              <div className="company-card__badges"><Badge tone={state.tone}>{state.label}</Badge><Badge tone={company.is_enabled ? 'green' : 'neutral'}>{company.is_enabled ? 'Habilitada' : 'Deshabilitada'}</Badge></div>
            </div>
            <h2>{company.name}</h2>
            <p>{company.code || 'Sin código'}{company.contact_email ? ` · ${company.contact_email}` : ''}</p>
            <div className="company-card__stats company-card__stats--four">
              <span><UsersRound size={15} /><b>{company.users}</b> Usuarios</span>
              <span><ContactRound size={15} /><b>{company.contacts}</b> Contactos</span>
              <span><MessageCircleMore size={15} /><b>{company.open_conversations}</b> Chats abiertos</span>
              <span><MessagesSquare size={15} /><b>{company.messages}</b> Mensajes</span>
            </div>
            <div className="company-card__health">
              <span className={state.tone === 'green' ? 'health-ok' : state.tone === 'neutral' ? 'health-off' : 'health-warn'} />
              Último inbound: {inboundLabel(company.last_inbound_message_at)}
              {company.alerts_count > 0 && <strong>{company.alerts_count} alerta(s)</strong>}
            </div>
            <div className="company-card__actions">
              <Link to={`/administracion/empresas/${company.id}/general`}>Administrar empresa <ArrowRight size={16} /></Link>
              <Button variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(company.id)}><Power size={14} />{company.is_enabled ? 'Deshabilitar' : 'Habilitar'}</Button>
            </div>
          </Card>;
        })}
      </div>
      <div className="table-pagination"><span>Página {page + 1} de {pageCount}</span><div><Button variant="ghost" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Anterior</Button><Button variant="ghost" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Siguiente</Button></div></div>
    </> : <EmptyState title="No hay empresas" detail="No hay empresas que coincidan con los filtros." />}
  </>;
}
