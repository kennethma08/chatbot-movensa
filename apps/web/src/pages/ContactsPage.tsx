import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Save, Search, X } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SkeletonRows } from '../components/ui';
import { api, formatApiError, jsonBody } from '../lib/api';

type Contact = { id: string; name: string | null; phone_number: string; country: string | null; status: string; created_at: string; last_message_at: string | null; conversation_count: number };
type ContactConversation = { id: string; channel: string; status: string; started_at: string; ended_at: string | null; last_activity_at: string; total_messages: number; assigned_user_name: string | null; last_message: string | null };
type ContactMessage = { id: string; sender: string; message: string | null; type: string; sentAt: string };

const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Costa_Rica' }).format(new Date(value)) : '—';

export function ContactsPage() {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['contacts'], queryFn: () => api<Contact[]>('/contacts') });
  const history = useQuery({ queryKey: ['contact-conversations', selected?.id], queryFn: () => api<ContactConversation[]>(`/contacts/${selected!.id}/conversations`), enabled: Boolean(selected) });
  const latest = history.data?.[0] ?? null;
  const previewMessages = useQuery({ queryKey: ['contact-preview-messages', latest?.id], queryFn: () => api<ContactMessage[]>(`/conversations/${latest!.id}/messages`), enabled: Boolean(latest) });
  const messages = useQuery({ queryKey: ['contact-messages', conversationId], queryFn: () => api<ContactMessage[]>(`/conversations/${conversationId}/messages`), enabled: showAll && Boolean(conversationId) });
  const rename = useMutation({
    mutationFn: (name: string) => api<Contact>(`/contacts/${selected!.id}/name`, { method: 'PATCH', ...jsonBody({ name }) }),
    onSuccess: async (updated) => {
      setSelected((current) => current ? { ...current, name: updated.name } : current);
      setEditingName(false);
      await client.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
  const filtered = useMemo(() => {
    const value = search.trim().toLocaleLowerCase();
    return (query.data ?? []).filter((contact) => !value || `${contact.name ?? ''} ${contact.phone_number}`.toLocaleLowerCase().includes(value));
  }, [query.data, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const rows = filtered.slice(page * pageSize, page * pageSize + pageSize);
  useEffect(() => setPage(0), [search, pageSize]);
  useEffect(() => { if (page >= pageCount) setPage(pageCount - 1); }, [page, pageCount]);

  function openDetail(contact: Contact) { setSelected(contact); setEditingName(false); setShowAll(false); setConversationId(null); }
  function openAll() { const first = history.data?.[0]; setConversationId(first?.id ?? null); setShowAll(true); }
  function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (name) rename.mutate(name);
  }

  return <>
    <PageHeader title="Clientes que han contactado" />
    <Card className="table-card">
      <div className="table-toolbar table-toolbar--original">
        <label className="table-length">Mostrar <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{[5,10,25,50,100].map((size) => <option key={size} value={size}>{size}</option>)}</select> registros</label>
        <div className="search-box"><Search size={17} /><input aria-label="Buscar clientes" placeholder="Buscar cliente o teléfono..." value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setSearch(''); }} /></div>
      </div>
      {query.isLoading ? <SkeletonRows count={5} /> : query.isError ? <ErrorState message={formatApiError(query.error)} /> : rows.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Cliente</th><th>País</th><th>Último mensaje</th><th>Acción</th></tr></thead><tbody>{rows.map((contact) => { const isWeb = contact.phone_number.startsWith('webchat:'); const displayName = contact.name || (isWeb ? 'Visitante del sitio web' : contact.phone_number); return <tr key={contact.id}><td><div className="table-person"><span className="avatar avatar--small">{displayName.slice(0, 1).toUpperCase()}</span><div><strong>{displayName}</strong><span>{isWeb ? 'Sitio web' : contact.phone_number}</span></div></div></td><td>{isWeb ? 'Sitio web' : contact.country ?? '—'}</td><td>{dateTime(contact.last_message_at)}</td><td><Button variant="ghost" aria-label={`Ver ${displayName}`} onClick={() => openDetail(contact)}><Eye size={14} />Ver</Button></td></tr>; })}</tbody></table></div> : <EmptyState title="Sin clientes" detail="Los clientes aparecerán cuando contacten a la empresa." />}
      {filtered.length > 0 && <div className="table-pagination"><span>Mostrando {page * pageSize + 1} a {Math.min((page + 1) * pageSize, filtered.length)} de {filtered.length}</span><div><Button variant="ghost" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Anterior</Button><span>{page + 1} / {pageCount}</span><Button variant="ghost" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Siguiente</Button></div></div>}
    </Card>

    {selected && <><button className="detail-backdrop" aria-label="Cerrar detalle" onClick={() => setSelected(null)} /><aside className="detail-drawer contact-history-drawer"><header><div><p className="eyebrow">Detalles del contacto</p><h2>{selected.name ?? (selected.phone_number.startsWith('webchat:') ? 'Visitante del sitio web' : selected.phone_number)}</h2></div><Button variant="ghost" aria-label="Cerrar" onClick={() => setSelected(null)}><X size={18} /></Button></header>
      <div className="contact-detail-identity"><span className="avatar avatar--large">{(selected.name || 'C').slice(0,1).toUpperCase()}</span>{editingName ? <form onSubmit={submitName}><input name="name" defaultValue={selected.name ?? ''} required autoFocus /><Button type="submit" disabled={rename.isPending}><Save size={14} />Guardar</Button></form> : <div><strong>{selected.name ?? 'Sin nombre'}</strong><Button variant="ghost" aria-label="Editar nombre" onClick={() => setEditingName(true)}><Pencil size={14} /></Button></div>}</div>
      {rename.isError && <p className="form-error">{formatApiError(rename.error)}</p>}
      <dl className="contact-history-meta"><div><dt>Teléfono</dt><dd>{selected.phone_number.startsWith('webchat:') ? 'Sitio web' : selected.phone_number}</dd></div><div><dt>País</dt><dd>{selected.phone_number.startsWith('webchat:') ? 'Sitio web' : selected.country ?? '—'}</dd></div><div><dt>Último mensaje</dt><dd>{dateTime(selected.last_message_at)}</dd></div></dl>
      <div className="contact-last-heading"><h3>Última conversación</h3><Button variant="secondary" onClick={openAll} disabled={!history.data?.length}>Ver todo</Button></div>
      {history.isLoading ? <LoadingState label="Cargando última conversación…" /> : latest ? <><p className="conversation-caption">Conversación #{latest.id} — Estado: {latest.status}</p><MessageList messages={previewMessages.data} loading={previewMessages.isLoading} error={previewMessages.error} /></> : <EmptyState title="Sin conversaciones" detail="Este contacto no tiene conversaciones." />}
    </aside></>}

    {selected && showAll && <div className="conversation-modal" role="dialog" aria-modal="true" aria-label={`Conversaciones de ${selected.name ?? selected.phone_number}`}><button className="conversation-modal__backdrop" aria-label="Cerrar conversaciones" onClick={() => setShowAll(false)} /><section className="conversation-modal__panel"><header><div><h2>Conversaciones — {selected.name ?? selected.phone_number}</h2><span>{selected.phone_number.startsWith('webchat:') ? 'Sitio web' : selected.phone_number}</span></div><Button variant="ghost" aria-label="Cerrar" onClick={() => setShowAll(false)}><X size={18} /></Button></header><div className="conversation-modal__body"><nav>{history.data?.map((item) => <button key={item.id} className={conversationId === item.id ? 'is-active' : ''} onClick={() => setConversationId(item.id)}><strong>#{item.id} — {item.status}</strong><span>Inicio: {dateTime(item.started_at)}</span><small>Última: {dateTime(item.last_activity_at)}</small></button>)}</nav><div><p className="conversation-caption">{conversationId ? `Conversación #${conversationId}` : 'Selecciona una conversación'}</p><MessageList messages={messages.data} loading={messages.isLoading} error={messages.error} /></div></div></section></div>}
  </>;
}

function MessageList({ messages, loading, error }: { messages: ContactMessage[] | undefined; loading: boolean; error: unknown }) {
  if (loading) return <LoadingState label="Cargando mensajes…" />;
  if (error) return <ErrorState message={formatApiError(error)} />;
  if (!messages?.length) return <p className="muted">Sin mensajes.</p>;
  return <div className="contact-message-history">{messages.map((message) => <article className={`history-message history-message--${message.sender}`} key={message.id}><strong>{message.sender === 'agent' ? 'Agente' : message.sender === 'ai' ? 'IA' : message.sender === 'bot' ? 'Bot' : 'Contacto'}</strong><p>{message.message ?? `[${message.type}]`}</p><time>{dateTime(message.sentAt)}</time></article>)}</div>;
}
