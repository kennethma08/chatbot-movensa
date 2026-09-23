import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationSummary, MessageView, Page } from '@movensa/shared';
import { CheckCheck, ChevronLeft, CircleUserRound, Download, Mic, Paperclip, Pencil, Search, Square } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Badge, Button, EmptyState, IconButton, LoadingState } from '../components/ui';
import { api, downloadApiAsset, formatApiError, getApiAssetObjectUrl, jsonBody } from '../lib/api';
import { dateKey, formatDate } from '../lib/date';

type ConversationDetail = {
  id: string; contact_id: string; contact_name: string | null; phone_number: string; country: string | null; channel: string;
  status: string; assigned_user_name: string | null; assigned_user_id: string | null; agent_requested_at: string | null;
};
type TeamMember = { id: string; name: string; role: string; status: boolean };

export function ConversationsPage() {
  const { user } = useAuth();
  const { companyId } = useParams();
  const scoped = (path: string) => companyId ? `${path}${path.includes('?') ? '&' : '?'}companyId=${encodeURIComponent(companyId)}` : path;
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('selected');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [editingContactName, setEditingContactName] = useState(false);
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingStream = useRef<MediaStream | null>(null);
  const recordedChunks = useRef<Blob[]>([]);
  const listQuery = useQuery({
    queryKey: ['conversations', companyId, status, search],
    queryFn: () => api<Page<ConversationSummary>>(scoped(`/conversations?status=${status}&assignment=all&channel=all&limit=60${search ? `&search=${encodeURIComponent(search)}` : ''}`)),
    refetchInterval: 10_000,
  });
  const detailQuery = useQuery({ queryKey: ['conversation', companyId, selectedId], queryFn: () => api<ConversationDetail>(scoped(`/conversations/${selectedId}`)), enabled: Boolean(selectedId) });
  const messagesQuery = useQuery({ queryKey: ['messages', companyId, selectedId], queryFn: () => api<MessageView[]>(scoped(`/conversations/${selectedId}/messages`)), enabled: Boolean(selectedId), refetchInterval: 4_000 });
  const teamQuery = useQuery({ queryKey: ['team', 'conversation-assignment', companyId], queryFn: () => api<TeamMember[]>(scoped('/team')), enabled: user?.role === 'admin' || user?.role === 'super_admin' });
  const action = useMutation({
    mutationFn: ({ route, body }: { route: string; body?: unknown }) => api(scoped(`/conversations/${selectedId}/${route}`), { method: 'POST', ...(body === undefined ? {} : jsonBody(body)) }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['conversations'] }), queryClient.invalidateQueries({ queryKey: ['conversation', companyId, selectedId] }), queryClient.invalidateQueries({ queryKey: ['messages', companyId, selectedId] })]); },
  });
  const send = useMutation({
    mutationFn: (text: string) => api(scoped(`/conversations/${selectedId}/messages`), { method: 'POST', ...jsonBody({ text, idempotencyKey: crypto.randomUUID() }) }),
    onSuccess: async () => { setDraft(''); await Promise.all([queryClient.invalidateQueries({ queryKey: ['messages', companyId, selectedId] }), queryClient.invalidateQueries({ queryKey: ['conversations'] })]); },
  });
  const upload = useMutation({
    mutationFn: (file: File) => { const body = new FormData(); body.append('file', file); return api(scoped(`/conversations/${selectedId}/attachments`), { method: 'POST', body }); },
    onSuccess: async () => { if (fileInput.current) fileInput.current.value = ''; await Promise.all([queryClient.invalidateQueries({ queryKey: ['messages', companyId, selectedId] }), queryClient.invalidateQueries({ queryKey: ['conversations'] })]); },
  });
  const renameContact = useMutation({
    mutationFn: (name: string) => api(scoped(`/contacts/${detailQuery.data!.contact_id}/name`), { method: 'PATCH', ...jsonBody({ name }) }),
    onSuccess: async () => { setEditingContactName(false); await Promise.all([queryClient.invalidateQueries({ queryKey: ['conversation', companyId, selectedId] }), queryClient.invalidateQueries({ queryKey: ['conversations'] })]); },
  });
  async function toggleRecording() {
    setRecordError(null);
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { audioInput.current?.click(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStream.current = stream;
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const nextRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorder.current = nextRecorder;
      recordedChunks.current = [];
      nextRecorder.ondataavailable = (event) => { if (event.data.size) recordedChunks.current.push(event.data); };
      nextRecorder.onerror = () => setRecordError('No se pudo completar la grabación.');
      nextRecorder.onstop = () => {
        const cleanMime = String(nextRecorder.mimeType || mimeType || 'audio/webm').split(';')[0] || 'audio/webm';
        const blob = new Blob(recordedChunks.current, { type: cleanMime });
        recordingStream.current?.getTracks().forEach((track) => track.stop());
        recordingStream.current = null;
        recorder.current = null;
        recordedChunks.current = [];
        setRecording(false);
        if (!blob.size) return;
        if (blob.size > 16 * 1024 * 1024) { setRecordError('El audio supera 16 MB. Graba uno más corto.'); return; }
        const extension = cleanMime === 'audio/ogg' ? 'ogg' : cleanMime === 'audio/mpeg' ? 'mp3' : 'webm';
        upload.mutate(new File([blob], `audio-whatsapp-${Date.now()}.${extension}`, { type: cleanMime }));
      };
      nextRecorder.start(250);
      setRecording(true);
    } catch {
      recordingStream.current?.getTracks().forEach((track) => track.stop());
      recordingStream.current = null;
      setRecordError('No se pudo acceder al micrófono. Revisa el permiso del navegador.');
    }
  }
  useEffect(() => () => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recordingStream.current?.getTracks().forEach((track) => track.stop());
  }, []);
  useEffect(() => { if (!selectedId && listQuery.data?.items[0] && window.innerWidth > 900) setParams({ selected: listQuery.data.items[0].id }, { replace: true }); }, [listQuery.data, selectedId, setParams]);
  const messages = messagesQuery.data ?? [];
  const grouped = useMemo(() => messages.map((message, index) => ({ message, showDay: index === 0 || dateKey(messages[index - 1]!.sentAt) !== dateKey(message.sentAt) })), [messages]);
  const assignedToMe = detailQuery.data?.assigned_user_id === user?.userId;
  const canSupervise = user?.role === 'admin' || user?.role === 'super_admin';
  const canRelease = Boolean(detailQuery.data?.assigned_user_id) && (canSupervise || assignedToMe);
  const canClose = detailQuery.data?.status !== 'closed' && (canSupervise || assignedToMe);
  const canReply = detailQuery.data?.status !== 'closed' && (canSupervise || !detailQuery.data?.assigned_user_id || assignedToMe);
  function submit(event: FormEvent) { event.preventDefault(); if (draft.trim() && !send.isPending) send.mutate(draft.trim()); }
  return <div className={`inbox ${selectedId ? 'inbox--selected' : ''}`}>
    <section className="inbox-list">
      <div className="conversation-filter"><div className="search-box"><Search size={17} /><input aria-label="Filtrar conversaciones" placeholder="Filtrar conversaciones..." value={search} onChange={(event) => setSearch(event.target.value)} /></div><select aria-label="Estado" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All</option><option value="open">Open</option><option value="closed">Closed</option></select></div>
      <div className="conversation-list">
        {listQuery.isLoading && <LoadingState label="Cargando conversaciones…" />}
        {listQuery.data?.items.map((conversation) => <button type="button" key={conversation.id} className={`conversation-row ${selectedId === conversation.id ? 'conversation-row--active' : ''}`} onClick={() => setParams({ selected: conversation.id })}>
          <span className="avatar avatar--contact">{(conversation.contact.name ?? conversation.contact.phoneNumber).slice(0, 2).toUpperCase()}</span>
          <span className="conversation-row__body"><span><strong>{conversation.contact.name ?? conversation.contact.phoneNumber}</strong><time>{formatDate(conversation.lastActivityAt, { hour: '2-digit', minute: '2-digit' }, '')}</time></span><span><small className={`channel-dot channel-dot--${conversation.channel}`} />{conversation.lastMessage ?? 'Sin mensajes'}</span><em>{conversation.assignedUserName ?? 'Sin asignar'}{conversation.agentRequested && <b>Solicita agente</b>}</em></span>
        </button>)}
        {listQuery.data && !listQuery.data.items.length && <EmptyState title="Bandeja al día" detail="No hay conversaciones con estos filtros." />}
      </div>
    </section>
    <section className="chat-panel">
      {!selectedId ? <EmptyState title="Elige una conversación" detail="Aquí verás el historial completo y las acciones disponibles." /> : <>
        <header className="chat-header"><IconButton className="chat-back" label="Volver a la lista" onClick={() => setParams({})}><ChevronLeft size={20} /></IconButton><span className="avatar avatar--contact"><CircleUserRound size={22} /></span><div className="chat-header__identity">{editingContactName ? <form onSubmit={(event) => { event.preventDefault(); const name = String(new FormData(event.currentTarget).get('name') ?? '').trim(); if (name) renameContact.mutate(name); }}><input name="name" defaultValue={detailQuery.data?.contact_name ?? ''} required autoFocus /><Button type="submit" disabled={renameContact.isPending}>Guardar</Button></form> : <span className="chat-contact-name"><strong>{detailQuery.data?.contact_name ?? detailQuery.data?.phone_number ?? 'Conversación'}</strong><button type="button" aria-label="Editar nombre" onClick={() => setEditingContactName(true)}><Pencil size={14} /></button><Badge tone={detailQuery.data?.status === 'closed' ? 'neutral' : 'green'}>{detailQuery.data?.status ?? 'open'}</Badge><Badge>#{detailQuery.data?.id}</Badge></span>}<span>{detailQuery.data?.phone_number} · {detailQuery.data?.channel === 'webchat' ? 'Webchat' : 'WhatsApp'}</span><small>{detailQuery.data?.assigned_user_name ? `Asignada a ${detailQuery.data.assigned_user_name}` : 'Sin asignar'}</small></div><div className="chat-header__actions">{canSupervise && <select className="compact-select" aria-label="Agentes" value={detailQuery.data?.assigned_user_id ?? ''} onChange={(event) => action.mutate({ route: 'assign', body: { userId: event.target.value || null } })}><option value="">Agentes...</option>{teamQuery.data?.filter((member) => member.status).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>}<Button variant="secondary" disabled={Boolean(detailQuery.data?.assigned_user_id) || detailQuery.data?.status === 'closed'} onClick={() => action.mutate({ route: 'claim' })}>Tomar</Button><Button variant="secondary" disabled={!canRelease || detailQuery.data?.status === 'closed'} onClick={() => action.mutate({ route: 'release' })}>Soltar</Button><Button variant="secondary" disabled={!canClose} onClick={() => action.mutate({ route: 'close' })}>{detailQuery.data?.status === 'closed' ? 'Cerrada' : 'Cerrar'}</Button></div></header>
        <div className="message-stream" aria-live="polite">
          {messagesQuery.isLoading && <LoadingState label="Cargando historial…" />}
          {grouped.map(({ message, showDay }) => <div key={message.id}>{showDay && <div className="day-divider"><span>{formatDate(message.sentAt, { dateStyle: 'medium' })}</span></div>}<article className={`message message--${message.sender === 'contact' ? 'incoming' : 'outgoing'} ${message.sender === 'ai' || message.sender === 'bot' ? 'message--automated' : ''}`}><div>{(message.sender === 'ai' || message.sender === 'bot') && <Badge tone="orange">{message.sender === 'ai' ? 'IA' : 'Bot'}</Badge>}<p>{message.message}</p>{message.attachment && <MessageAttachment attachment={message.attachment} path={scoped(message.attachment.downloadUrl)} />}<time>{formatDate(message.sentAt, { hour: '2-digit', minute: '2-digit' })}{message.sender !== 'contact' && <CheckCheck size={14} />}</time></div></article></div>)}
        </div>
        <form className="composer" onSubmit={submit}><input className="sr-only" ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,audio/mpeg,audio/ogg,audio/webm" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); }} /><input className="sr-only" ref={audioInput} type="file" accept="audio/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); }} /><IconButton type="button" label="Adjuntar archivo" onClick={() => fileInput.current?.click()} disabled={!canReply || upload.isPending}><Paperclip size={19} /></IconButton><IconButton className={recording ? 'composer__recording' : ''} type="button" label={recording ? 'Detener y enviar audio' : 'Grabar audio'} onClick={() => void toggleRecording()} disabled={!canReply || upload.isPending}>{recording ? <Square size={17} /> : <Mic size={19} />}</IconButton><input aria-label="Mensaje" placeholder={recording ? 'Grabando audio…' : 'Escribe un mensaje…'} disabled={!canReply || recording} value={draft} onChange={(event) => setDraft(event.target.value)} /><Button type="submit" disabled={!canReply || recording || !draft.trim() || send.isPending}>Enviar</Button></form>
        {(send.isError || action.isError || upload.isError || recordError) && <div className="toast toast--error">{recordError ?? formatApiError(send.error ?? action.error ?? upload.error)}</div>}
      </>}
    </section>
  </div>;
}

function MessageAttachment({ attachment, path }: { attachment: NonNullable<MessageView['attachment']>; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const previewable = attachment.mimeType.startsWith('audio/') || attachment.mimeType.startsWith('image/');
  useEffect(() => {
    if (!previewable) return;
    let active = true;
    let objectUrl: string | null = null;
    void getApiAssetObjectUrl(path).then((next) => { objectUrl = next; if (active) setUrl(next); else URL.revokeObjectURL(next); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, previewable]);
  return <div className="message-attachment">
    {url && attachment.mimeType.startsWith('audio/') && <audio controls controlsList="nodownload noplaybackrate" preload="metadata" src={url} />}
    {url && attachment.mimeType.startsWith('image/') && <img src={url} alt={attachment.fileName} />}
    {!attachment.mimeType.startsWith('audio/') && <button className="attachment-link" type="button" onClick={() => void downloadApiAsset(path, attachment.fileName)}>{failed || !previewable ? <Paperclip size={15} /> : <Download size={15} />}{attachment.fileName}</button>}
  </div>;
}
