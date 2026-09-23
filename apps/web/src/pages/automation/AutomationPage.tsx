import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FlowDocument } from '@movensa/shared';
import { ArrowRight, Bot, CheckCircle2, CircleDot, Code2, Copy, Download, FileJson, FileText, GitBranch, Globe2, GripVertical, Image as ImageIcon, LayoutTemplate, ListTree, MapPin, MessageSquareText, MonitorSmartphone, Plus, Power, Rocket, Save, Settings2, Shrink, Trash2, Webhook, ZoomIn, ZoomOut } from 'lucide-react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, PageHeader } from '../../components/ui';
import { api, downloadApiAsset, formatApiError, jsonBody } from '../../lib/api';
import { WidgetContentEditor } from './WidgetContentEditor';

type Flow = { id: string; name: string; description: string | null; status: string; is_active: boolean; builder: FlowDocument; published: FlowDocument | null; updated_at: string | null };
type WidgetState = { widgets: Array<Record<string, unknown>>; installations: Array<Record<string, unknown>>; analytics?: { started_sessions: number; active_sessions: number; live_chat_requests: number } };
type FlowNode = FlowDocument['nodes'][number];

const flowNodeNames: Record<FlowNode['type'], string> = {
  start: 'Inicio', text: 'Mensaje', menu: 'Menú', question: 'Pregunta', condition: 'Condición', template: 'Plantilla',
  image: 'Imagen', document: 'Documento', location: 'Ubicación', handoff: 'Transferir', end: 'Final',
};

function initialNodeData(type: FlowNode['type']): Record<string, unknown> {
  if (type === 'text') return { text: 'Escribe aquí…' };
  if (type === 'question') return { text: '¿Cuál es tu respuesta?', variable: 'respuesta' };
  if (type === 'menu') return { text: 'Elige una opción:', variable: 'opcion', retryText: 'Elige una de las opciones disponibles.', options: [{ id: 'option-1', label: 'Opción 1', value: 'opcion_1' }] };
  if (type === 'condition') return { variable: 'respuesta', operator: 'equals', value: '' };
  if (type === 'template') return { name: '', language: 'es', parameters: [] };
  if (type === 'image' || type === 'document') return { url: '', caption: '' };
  if (type === 'location') return { latitude: 14.6349, longitude: -90.5069, name: '' };
  if (type === 'handoff') return { reason: 'Solicitud de agente' };
  return {};
}

export function AutomationPage() {
  const { companyId: selectedCompanyId, channel = 'whatsapp', section = 'resumen' } = useParams();
  const { user } = useAuth();
  const companyId = selectedCompanyId ?? user?.companyId;
  const isWebchat = channel === 'webchat';
  const basePath = selectedCompanyId
    ? `/administracion/empresas/${selectedCompanyId}/automatizacion/${channel}`
    : `/automatizacion/${channel}`;
  if (!companyId) return <ErrorState message="Esta sección necesita una empresa seleccionada." />;
  return <><PageHeader eyebrow="Automatización" title={isWebchat ? 'Webchat' : 'Bot de WhatsApp'} description={isWebchat ? 'Diseña la experiencia, el contenido y la instalación del widget.' : 'Construye recorridos visuales y publica una sola versión activa.'} action={<Badge tone="orange">{isWebchat ? <><Webhook size={14} /> Canal web</> : <><Bot size={14} /> WhatsApp</>}</Badge>} />
    {selectedCompanyId && <nav className="tabs" aria-label="Canal de automatización"><NavLink to={`/administracion/empresas/${selectedCompanyId}/automatizacion/whatsapp`}>Bot WhatsApp</NavLink><NavLink to={`/administracion/empresas/${selectedCompanyId}/automatizacion/webchat`}>Webchat</NavLink></nav>}
    {isWebchat && <nav className="tabs"><NavLink to={basePath} end>Resumen</NavLink><NavLink to={`${basePath}/flujos`}>Flujos</NavLink><NavLink to={`${basePath}/widget`}>Widget</NavLink><NavLink to={`${basePath}/accesos`}>Accesos rápidos</NavLink><NavLink to={`${basePath}/preguntas`}>Preguntas frecuentes</NavLink><NavLink to={`${basePath}/articulos`}>Artículos</NavLink><NavLink to={`${basePath}/instalaciones`}>Instalaciones</NavLink></nav>}
    {isWebchat && section === 'resumen' && <WebchatOverview companyId={companyId} basePath={basePath} />}
    {(!isWebchat || section === 'flujos') && <FlowWorkspace companyId={companyId} kind={isWebchat ? 'webchat' : 'whatsapp'} />}
    {isWebchat && section === 'widget' && <WidgetEditor companyId={companyId} mode="appearance" />}
    {isWebchat && section === 'accesos' && <WidgetEditor companyId={companyId} mode="quick-links" />}
    {isWebchat && section === 'preguntas' && <WidgetEditor companyId={companyId} mode="faqs" />}
    {isWebchat && section === 'articulos' && <WidgetEditor companyId={companyId} mode="articles" />}
    {isWebchat && section === 'contenido' && <WidgetEditor companyId={companyId} mode="texts" />}
    {isWebchat && section === 'instalaciones' && <Installations companyId={companyId} />}
  </>;
}

function blankFlow(): FlowDocument {
  return { version: 1, nodes: [{ id: 'start', type: 'start', label: 'Inicio', position: { x: 80, y: 80 }, data: {} }], edges: [] };
}

function WebchatOverview({ companyId, basePath }: { companyId: string; basePath: string }) {
  const flows = useQuery({ queryKey: ['flows', companyId, 'webchat'], queryFn: () => api<Flow[]>(`/admin/companies/${companyId}/flows/webchat`) });
  const state = useQuery({ queryKey: ['widgets', companyId], queryFn: () => api<WidgetState>(`/admin/companies/${companyId}/widgets`) });
  if (flows.isLoading || state.isLoading) return <LoadingState />;
  if (flows.isError || state.isError) return <ErrorState message={formatApiError(flows.error ?? state.error)} />;
  const published = flows.data?.filter((flow) => flow.published).length ?? 0;
  const activeInstallations = state.data?.installations.filter((item) => Boolean(item.is_active)).length ?? 0;
  const analytics = state.data?.analytics ?? { started_sessions: 0, active_sessions: 0, live_chat_requests: 0 };
  const widget = state.data?.widgets[0];
  return <div className="webchat-overview">
    <div className="webchat-stat-grid">
      <Card><span>Sesiones 7 días</span><strong>{analytics.started_sessions}</strong></Card>
      <Card><span>Sesiones activas</span><strong>{analytics.active_sessions}</strong></Card>
      <Card><span>Solicitudes live chat</span><strong>{analytics.live_chat_requests}</strong></Card>
      <Card><span>Flujos publicados</span><strong>{published}</strong></Card>
      <Card><span>Keys activas</span><strong>{activeInstallations}</strong></Card>
    </div>
    <div className="webchat-summary-grid">
      <Card className="panel-card"><div className="card-heading"><div><p className="eyebrow">Automatización</p><h2>Flujos</h2></div><Link className="button button--secondary" to={`${basePath}/flujos`}>Ver flujos</Link></div><div className="overview-list">{flows.data?.slice(0, 5).map((flow) => <Link key={flow.id} to={`${basePath}/flujos`}><span><strong>{flow.name}</strong><small>{flow.description || 'Sin descripción'}</small></span><Badge tone={flow.published ? 'green' : 'neutral'}>{flow.published ? 'Publicado' : 'Borrador'}</Badge></Link>)}{!flows.data?.length && <EmptyState title="No hay flujos" detail="Crea el primer recorrido del chatbot." />}</div></Card>
      <Card className="panel-card"><div className="card-heading"><div><p className="eyebrow">Apariencia</p><h2>Widget</h2></div><Link className="button button--secondary" to={`${basePath}/widget`}>Configurar</Link></div>{widget ? <div className="overview-widget"><div style={{ background: String(widget.primary_color) }}>{String(widget.header_title)}</div><p>{String(widget.welcome_text)}</p><small>Posición: {String(widget.position)} · Texto libre: {widget.allow_free_text ? 'Sí' : 'No'}</small></div> : <EmptyState title="Sin widget" detail="No hay un widget configurado." />}</Card>
      <Card className="panel-card"><div className="card-heading"><div><p className="eyebrow">Publicación</p><h2>Instalaciones</h2></div><Link className="button button--secondary" to={`${basePath}/instalaciones`}>Administrar</Link></div><div className="overview-list">{state.data?.installations.slice(0, 4).map((item) => <Link key={String(item.id)} to={`${basePath}/instalaciones`}><span><strong>{String(item.name)}</strong><small>{String(item.install_type)} · {String(item.activation_key_prefix ?? '')}</small></span><Badge tone={item.is_active ? 'green' : 'neutral'}>{item.is_active ? 'Activa' : 'Pausada'}</Badge></Link>)}{!state.data?.installations.length && <EmptyState title="Sin instalaciones" detail="Crea una clave para publicar el widget." />}</div></Card>
    </div>
  </div>;
}

function FlowWorkspace({ companyId, kind }: { companyId: string; kind: 'whatsapp' | 'webchat' }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['flows', companyId, kind], queryFn: () => api<Flow[]>(`/admin/companies/${companyId}/flows/${kind}`) });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<FlowDocument>(blankFlow());
  const [name, setName] = useState('Nuevo flujo');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [compact, setCompact] = useState(false);
  const [rawJson, setRawJson] = useState(JSON.stringify(blankFlow(), null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const active = query.data?.find((flow) => flow.id === selected) ?? null;
  const save = useMutation({ mutationFn: () => api<Flow>(selected ? `/admin/companies/${companyId}/flows/${kind}/${selected}` : `/admin/companies/${companyId}/flows/${kind}`, { method: selected ? 'PUT' : 'POST', ...jsonBody({ name, description, isActive, document: draft }) }), onSuccess: async (flow) => { setSelected(flow.id); setIsActive(flow.is_active); await client.invalidateQueries({ queryKey: ['flows', companyId, kind] }); } });
  const publish = useMutation({ mutationFn: (id: string) => api(`/admin/companies/${companyId}/flows/${kind}/${id}/publish`, { method: 'POST' }), onSuccess: () => client.invalidateQueries({ queryKey: ['flows', companyId, kind] }) });
  const activate = useMutation({ mutationFn: (id: string) => api(`/admin/companies/${companyId}/flows/${kind}/${id}/activate`, { method: 'POST' }), onSuccess: () => client.invalidateQueries({ queryKey: ['flows', companyId, kind] }) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/admin/companies/${companyId}/flows/${kind}/${id}`, { method: 'DELETE' }), onSuccess: async () => { resetFlow(); await client.invalidateQueries({ queryKey: ['flows', companyId, kind] }); } });
  useEffect(() => { setRawJson(JSON.stringify(draft, null, 2)); }, [draft]);
  function resetFlow() { const fresh = blankFlow(); setSelected(null); setDraft(fresh); setName('Nuevo flujo'); setDescription(''); setIsActive(false); setZoom(100); setCompact(false); setJsonError(null); }
  function choose(flow: Flow) { setSelected(flow.id); setDraft(flow.builder); setName(flow.name); setDescription(flow.description ?? ''); setIsActive(flow.is_active); setZoom(100); setCompact(false); setJsonError(null); }
  function applyJson() {
    try {
      const parsed = JSON.parse(rawJson) as FlowDocument;
      if (parsed.version !== 1 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error('El JSON debe incluir version 1, nodes y edges.');
      setDraft(parsed);
      setJsonError(null);
    } catch (error) { setJsonError(error instanceof Error ? error.message : 'JSON inválido.'); }
  }
  function formatJson() {
    try { setRawJson(JSON.stringify(JSON.parse(rawJson), null, 2)); setJsonError(null); }
    catch { setJsonError('No se puede formatear porque el JSON es inválido.'); }
  }
  function loadJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then((text) => { setRawJson(text); setJsonError(null); }).catch(() => setJsonError('No se pudo leer el archivo JSON.'));
    event.target.value = '';
  }
  function addNode(type: FlowDocument['nodes'][number]['type']) {
    const id = `${type}-${crypto.randomUUID().slice(0, 7)}`;
    const previous = draft.nodes.at(-1);
    const positionIndex = draft.nodes.length;
    setDraft({
      ...draft,
      nodes: [...draft.nodes, { id, type, label: flowNodeNames[type], position: { x: 80 + (positionIndex % 4) * 320, y: 80 + Math.floor(positionIndex / 4) * 280 }, data: initialNodeData(type) }],
      edges: previous ? [...draft.edges, { id: `edge-${crypto.randomUUID().slice(0, 7)}`, source: previous.id, target: id }] : draft.edges,
    });
  }
  function updateNode(nodeId: string, changes: Partial<FlowNode>) {
    setDraft((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, ...changes } : node) }));
  }
  function connect(source: string, target: string, sourceHandle?: string) {
    setDraft((current) => {
      const matches = (edge: FlowDocument['edges'][number]) => edge.source === source && (edge.sourceHandle ?? '') === (sourceHandle ?? '');
      const edges = current.edges.filter((edge) => !matches(edge));
      if (target) edges.push({ id: `edge-${crypto.randomUUID().slice(0, 7)}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
      return { ...current, edges };
    });
  }
  function connection(source: string, sourceHandle?: string) {
    return draft.edges.find((edge) => edge.source === source && (edge.sourceHandle ?? '') === (sourceHandle ?? ''))?.target ?? '';
  }
  const validation = useMemo(() => draft.nodes.length > 1 && draft.nodes.some((node) => node.type === 'end' || node.type === 'handoff'), [draft]);
  const nodeWidth = compact ? 210 : 260;
  const worldSize = useMemo(() => ({
    width: Math.max(1360, ...draft.nodes.map((node) => node.position.x + nodeWidth + 180)),
    height: Math.max(720, ...draft.nodes.map((node) => node.position.y + 370)),
  }), [draft.nodes, nodeWidth]);
  const positionedEdges = useMemo(() => draft.edges.flatMap((edge) => {
    const source = draft.nodes.find((node) => node.id === edge.source);
    const target = draft.nodes.find((node) => node.id === edge.target);
    if (!source || !target) return [];
    return [{
      ...edge,
      x1: source.position.x + nodeWidth,
      y1: source.position.y + 58,
      x2: target.position.x,
      y2: target.position.y + 58,
    }];
  }), [draft.edges, draft.nodes, nodeWidth]);
  function startNodeDrag(event: ReactPointerEvent<HTMLDivElement>, node: FlowNode) {
    if ((event.target as HTMLElement).closest('button, input, textarea, select, label')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = node.position;
    const scale = zoom / 100;
    const move = (pointer: PointerEvent) => updateNode(node.id, {
      position: {
        x: Math.max(24, Math.round(origin.x + (pointer.clientX - startX) / scale)),
        y: Math.max(24, Math.round(origin.y + (pointer.clientY - startY) / scale)),
      },
    });
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  }
  function fitCanvas() {
    setZoom(Math.max(50, Math.min(100, Math.floor((920 / worldSize.width) * 100))));
  }
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState message={formatApiError(query.error)} />;
  return <div className="flow-layout">
    <aside className="flow-list"><div className="section-toolbar"><div><h2>Flujos</h2><p>{query.data?.length ?? 0} guardados</p></div><button onClick={resetFlow}><Plus size={16} /></button></div>{query.data?.map((flow) => <button key={flow.id} className={selected === flow.id ? 'active' : ''} onClick={() => choose(flow)}><span><strong>{flow.name}</strong><small>{flow.status === 'published' ? 'Publicado' : 'Borrador'}</small></span>{flow.is_active && <i />}</button>)}{!query.data?.length && <p className="muted padded">Crea tu primer recorrido.</p>}</aside>
    <Card className={`flow-builder${compact ? ' flow-builder--compact' : ''}`}>
      <header>
        <div className="flow-identity">
          <input className="flow-title-input" value={name} onChange={(event) => setName(event.target.value)} aria-label="Nombre del flujo" />
          <input className="flow-description-input" value={description} onChange={(event) => setDescription(event.target.value)} aria-label="Descripción del flujo" placeholder="Descripción" />
          <label><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Activo</label>
          <span>{active ? `Editando #${active.id}` : 'Borrador nuevo'}</span>
        </div>
        <div>
          <Button variant="secondary" onClick={() => save.mutate()} disabled={!validation || save.isPending}><Save size={16} />{selected ? 'Guardar cambios' : 'Crear flujo'}</Button>
          {selected && active?.published && !active.is_active && <Button variant="secondary" onClick={() => activate.mutate(selected)} disabled={activate.isPending}><Power size={16} />Activar</Button>}
          {selected && <Button onClick={() => publish.mutate(selected)} disabled={!validation || publish.isPending}><Rocket size={16} />Publicar</Button>}
          {selected && <Button variant="ghost" aria-label="Archivar flujo" onClick={() => { if (window.confirm('¿Archivar este flujo? Las conversaciones históricas se conservarán.')) remove.mutate(selected); }}><Trash2 size={16} /></Button>}
        </div>
      </header>
      <div className="builder-tools">
        <div className="node-toolbar">
          <span>Agregar bloque</span>
          <button onClick={() => addNode('text')}><MessageSquareText size={15} />Mensaje</button>
          <button onClick={() => addNode('question')}><CircleDot size={15} />Pregunta</button>
          <button onClick={() => addNode('menu')}><ListTree size={15} />Menú</button>
          <button onClick={() => addNode('condition')}><GitBranch size={15} />Condición</button>
          <button onClick={() => addNode('template')}><LayoutTemplate size={15} />Plantilla</button>
          <button onClick={() => addNode('image')}><ImageIcon size={15} />Imagen</button>
          <button onClick={() => addNode('document')}><FileText size={15} />Documento</button>
          <button onClick={() => addNode('location')}><MapPin size={15} />Ubicación</button>
          <button onClick={() => addNode('handoff')}><ArrowRight size={15} />Agente</button>
          <button onClick={() => addNode('end')}><CheckCircle2 size={15} />Final</button>
        </div>
        <div className="canvas-toolbar">
          <button onClick={() => setZoom((value) => Math.max(50, value - 10))} aria-label="Alejar"><ZoomOut size={15} /></button>
          <button onClick={() => setZoom(100)}>{zoom}%</button>
          <button onClick={() => setZoom((value) => Math.min(150, value + 10))} aria-label="Acercar"><ZoomIn size={15} /></button>
          <button onClick={fitCanvas}><Shrink size={15} />Encajar</button>
          <button className={compact ? 'active' : ''} onClick={() => setCompact((value) => !value)}>Modo compacto</button>
        </div>
      </div>
      <div className="flow-canvas">
        <div className="canvas-grid" />
        <div className="flow-canvas__world" style={{ zoom: zoom / 100, width: worldSize.width, height: worldSize.height }}>
          <svg className="flow-edges" width={worldSize.width} height={worldSize.height} aria-hidden="true">
            {positionedEdges.map((edge) => {
              const bend = Math.max(70, Math.abs(edge.x2 - edge.x1) * 0.45);
              return <path key={edge.id} d={`M ${edge.x1} ${edge.y1} C ${edge.x1 + bend} ${edge.y1}, ${edge.x2 - bend} ${edge.y2}, ${edge.x2} ${edge.y2}`} />;
            })}
          </svg>
          {draft.nodes.map((node) => <div className={`flow-node flow-node--${node.type}`} key={node.id} style={{ left: node.position.x, top: node.position.y, width: nodeWidth }}>
            <div className="flow-node__header" onPointerDown={(event) => startNodeDrag(event, node)}>
              <GripVertical size={14} />
              <Badge tone={node.type === 'start' ? 'green' : node.type === 'handoff' ? 'orange' : 'neutral'}>{flowNodeNames[node.type]}</Badge>
              <button aria-label="Eliminar bloque" disabled={node.type === 'start'} onClick={() => setDraft((current) => ({ ...current, nodes: current.nodes.filter((item) => item.id !== node.id), edges: current.edges.filter((edge) => edge.source !== node.id && edge.target !== node.id) }))}><Trash2 size={14} /></button>
            </div>
            <input value={node.label} onChange={(event) => updateNode(node.id, { label: event.target.value })} />
            <FlowNodeFields node={node} nodes={draft.nodes} onData={(data) => updateNode(node.id, { data })} connect={connect} connection={connection} />
          </div>)}
        </div>
        <div className="flow-minimap" aria-hidden="true">
          {draft.nodes.map((node) => <i key={node.id} className={`flow-minimap__node flow-minimap__node--${node.type}`} style={{ left: `${(node.position.x / worldSize.width) * 100}%`, top: `${(node.position.y / worldSize.height) * 100}%` }} />)}
        </div>
      </div>
      <details className="flow-json-panel">
        <summary><FileJson size={16} />JSON del chatbot</summary>
        <div className="flow-json-actions"><label className="button button--secondary">Cargar JSON<input type="file" accept=".json,application/json" onChange={loadJson} hidden /></label><Button type="button" variant="secondary" onClick={formatJson}>Formatear</Button><Button type="button" onClick={applyJson}>Aplicar JSON</Button></div>
        <textarea aria-label="JSON del chatbot" spellCheck={false} rows={16} value={rawJson} onChange={(event) => setRawJson(event.target.value)} />
        {jsonError && <p className="form-error">{jsonError}</p>}
      </details>
      <footer>
        <span className={validation ? 'success-text' : 'muted'}>{validation ? <><CheckCircle2 size={15} />Listo para publicar</> : 'Agrega al menos un bloque y un final.'}</span>
        {(save.isError || publish.isError || activate.isError || remove.isError) && <span className="form-error">{formatApiError(save.error ?? publish.error ?? activate.error ?? remove.error)}</span>}
      </footer>
    </Card>
  </div>;
}

function FlowNodeFields({ node, nodes, onData, connect, connection }: { node: FlowNode; nodes: FlowNode[]; onData: (data: Record<string, unknown>) => void; connect: (source: string, target: string, handle?: string) => void; connection: (source: string, handle?: string) => string }) {
  const set = (key: string, value: unknown) => onData({ ...node.data, [key]: value });
  const targets = <>{nodes.filter((candidate) => candidate.id !== node.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label} · {candidate.type}</option>)}</>;
  const route = (label: string, handle?: string) => <label key={`${node.id}:${handle ?? 'next'}`} className="node-route"><span>{label}</span><select aria-label={label} value={connection(node.id, handle)} onChange={(event) => connect(node.id, event.target.value, handle)}><option value="">Sin conexión</option>{targets}</select></label>;
  const options = Array.isArray(node.data.options) ? node.data.options as Array<Record<string, unknown>> : [];
  return <div className="node-fields">
    {(node.type === 'text' || node.type === 'question' || node.type === 'menu') && <textarea aria-label="Texto" value={String(node.data.text ?? '')} onChange={(event) => set('text', event.target.value)} />}
    {node.type === 'question' && <input aria-label="Variable de respuesta" placeholder="Variable" value={String(node.data.variable ?? '')} onChange={(event) => set('variable', event.target.value)} />}
    {node.type === 'menu' && <><textarea aria-label="Opciones del menú" title="Una opción por línea: etiqueta|valor" value={options.map((option) => `${String(option.label ?? '')}|${String(option.value ?? '')}`).join('\n')} onChange={(event) => set('options', event.target.value.split('\n').filter(Boolean).map((line, index) => { const [label, value] = line.split('|'); return { id: `option-${index + 1}`, label: label?.trim() || `Opción ${index + 1}`, value: value?.trim() || label?.trim() || `opcion_${index + 1}` }; }))} />{options.map((option, index) => route(String(option.label ?? `Opción ${index + 1}`), String(option.id ?? `option-${index + 1}`)))}</>}
    {node.type === 'condition' && <><input aria-label="Variable" placeholder="Variable" value={String(node.data.variable ?? '')} onChange={(event) => set('variable', event.target.value)} /><select aria-label="Operador" value={String(node.data.operator ?? 'equals')} onChange={(event) => set('operator', event.target.value)}><option value="equals">Es igual a</option><option value="not_equals">No es igual a</option><option value="contains">Contiene</option><option value="exists">Existe</option></select>{node.data.operator !== 'exists' && <input aria-label="Valor esperado" placeholder="Valor esperado" value={String(node.data.value ?? '')} onChange={(event) => set('value', event.target.value)} />}{route('Si se cumple', 'true')}{route('Si no se cumple', 'false')}</>}
    {node.type === 'template' && <><input aria-label="Nombre de plantilla" placeholder="Nombre de plantilla" value={String(node.data.name ?? '')} onChange={(event) => set('name', event.target.value)} /><input aria-label="Idioma de plantilla" placeholder="Idioma (es)" value={String(node.data.language ?? '')} onChange={(event) => set('language', event.target.value)} /><textarea aria-label="Parámetros" placeholder="Un parámetro por línea" value={(Array.isArray(node.data.parameters) ? node.data.parameters : []).join('\n')} onChange={(event) => set('parameters', event.target.value.split('\n'))} /></>}
    {(node.type === 'image' || node.type === 'document') && <><input aria-label="URL del archivo" type="url" placeholder="https://…" value={String(node.data.url ?? '')} onChange={(event) => set('url', event.target.value)} /><input aria-label="Descripción" placeholder="Descripción opcional" value={String(node.data.caption ?? '')} onChange={(event) => set('caption', event.target.value)} /></>}
    {node.type === 'location' && <><input aria-label="Nombre del lugar" placeholder="Nombre del lugar" value={String(node.data.name ?? '')} onChange={(event) => set('name', event.target.value)} /><div className="node-coordinate"><input aria-label="Latitud" type="number" step="any" value={Number(node.data.latitude ?? 0)} onChange={(event) => set('latitude', Number(event.target.value))} /><input aria-label="Longitud" type="number" step="any" value={Number(node.data.longitude ?? 0)} onChange={(event) => set('longitude', Number(event.target.value))} /></div></>}
    {node.type === 'handoff' && <textarea aria-label="Motivo de transferencia" value={String(node.data.reason ?? '')} onChange={(event) => set('reason', event.target.value)} />}
    {!['menu', 'condition', 'handoff', 'end'].includes(node.type) && route('Siguiente bloque')}
  </div>;
}

type WidgetDefaults = {
  name: string; isActive: boolean; activeFlowId: string | null; primaryColor: string; accentColor: string;
  backgroundColor: string; textColor: string; fontFamily: string; position: string; headerTitle: string;
  welcomeText: string; placeholderText: string; bubbleText: string; brandText: string; showBranding: boolean;
  allowFreeText: boolean; allowLiveChat: boolean; borderRadius: number; launcherIcon: string | null;
  conversationEmptyImage: string | null; content: Record<string, unknown>;
};

function widgetDefaults(widget: Record<string, unknown>): WidgetDefaults {
  return {
    name: String(widget.name), isActive: Boolean(widget.is_active), activeFlowId: widget.active_flow_id ? String(widget.active_flow_id) : null,
    primaryColor: String(widget.primary_color), accentColor: String(widget.accent_color), backgroundColor: String(widget.background_color), textColor: String(widget.text_color),
    fontFamily: 'Poppins', position: String(widget.position), headerTitle: String(widget.header_title), welcomeText: String(widget.welcome_text),
    placeholderText: String(widget.placeholder_text), bubbleText: String(widget.bubble_text), brandText: String(widget.brand_text), showBranding: Boolean(widget.show_branding),
    allowFreeText: Boolean(widget.allow_free_text), allowLiveChat: Boolean(widget.allow_live_chat), borderRadius: Number(widget.border_radius),
    launcherIcon: widget.launcher_icon ? String(widget.launcher_icon) : null,
    conversationEmptyImage: widget.conversation_empty_image ? String(widget.conversation_empty_image) : null,
    content: widget.content && typeof widget.content === 'object' ? widget.content as Record<string, unknown> : {},
  };
}

function ColorControl({ name, value, onChange }: { name: string; value: string; onChange: (value: string) => void }) {
  return <div className="color-control"><input aria-label={`${name}: ${value}`} name={name} type="color" value={value} onChange={(event) => onChange(event.target.value)} /><code>{value}</code></div>;
}

function displayAllowedDomain(value: string): string {
  const candidate = value.trim().toLowerCase();
  const wildcard = candidate.startsWith('*.');
  const withoutWildcard = wildcard ? candidate.slice(2) : candidate;
  try {
    const parsed = new URL(/^https?:\/\//i.test(withoutWildcard) ? withoutWildcard : `http://${withoutWildcard}`);
    return `${wildcard ? '*.' : ''}${parsed.hostname.replace(/\.$/, '')}`;
  } catch {
    return value;
  }
}

function WidgetEditor({ companyId, mode }: { companyId: string; mode: 'appearance' | 'texts' | 'quick-links' | 'faqs' | 'articles' }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['widgets', companyId], queryFn: () => api<WidgetState>(`/admin/companies/${companyId}/widgets`) });
  const flows = useQuery({ queryKey: ['flows', companyId, 'webchat'], queryFn: () => api<Flow[]>(`/admin/companies/${companyId}/flows/webchat`) });
  const widget = query.data?.widgets[0];
  const mutation = useMutation({ mutationFn: (body: unknown) => api(`/admin/companies/${companyId}/widgets/${String(widget?.id)}`, { method: 'PUT', ...jsonBody(body) }), onSuccess: () => client.invalidateQueries({ queryKey: ['widgets', companyId] }) });
  const asset = useMutation({ mutationFn: ({ kind, file }: { kind: 'launcher' | 'empty'; file: File }) => { const body = new FormData(); body.set('file', file); return api(`/admin/companies/${companyId}/widgets/${String(widget?.id)}/assets/${kind}`, { method: 'POST', body }); }, onSuccess: () => client.invalidateQueries({ queryKey: ['widgets', companyId] }) });
  const defaults = useMemo(() => widget ? widgetDefaults(widget) : null, [widget]);
  const [appearance, setAppearance] = useState<WidgetDefaults | null>(null);
  useEffect(() => { if (defaults) setAppearance(defaults); }, [defaults]);
  if (query.isLoading) return <LoadingState />;
  if (!widget || !defaults) return <EmptyState title="Sin widget" detail="Crea el widget inicial desde la importación o la API administrativa." />;
  const formState = appearance ?? defaults;
  const update = <K extends keyof WidgetDefaults>(key: K, value: WidgetDefaults[K]) => setAppearance((current) => ({ ...(current ?? defaults), [key]: value }));
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); mutation.mutate(formState); }
  if (mode !== 'appearance') return <WidgetContentEditor mode={mode} initial={defaults.content} saving={mutation.isPending} saved={mutation.isSuccess} error={mutation.error} onSave={(content) => mutation.mutate({ ...defaults, content })} />;
  return <>
    <div className="widget-layout">
      <Card className="form-card"><form onSubmit={submit}>
        <div className="form-section"><div><span className="section-icon"><Settings2 size={19} /></span><h2>Configuración</h2></div><div className="form-grid">
          <Field label="Flujo en uso"><select name="activeFlowId" value={formState.activeFlowId ?? ''} onChange={(event) => update('activeFlowId', event.target.value || null)}><option value="">Sin flujo</option>{flows.data?.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}</select></Field>
          <Field label="Posición"><select name="position" value={formState.position} onChange={(event) => update('position', event.target.value)}><option value="bottom-right">Derecha</option><option value="bottom-left">Izquierda</option></select></Field>
          <Field label="Color principal"><ColorControl name="primaryColor" value={formState.primaryColor} onChange={(value) => update('primaryColor', value)} /></Field><Field label="Color secundario"><ColorControl name="accentColor" value={formState.accentColor} onChange={(value) => update('accentColor', value)} /></Field>
          <Field label="Fondo"><ColorControl name="backgroundColor" value={formState.backgroundColor} onChange={(value) => update('backgroundColor', value)} /></Field><Field label="Texto"><ColorControl name="textColor" value={formState.textColor} onChange={(value) => update('textColor', value)} /></Field>
          <Field label="Título"><input name="headerTitle" value={formState.headerTitle} onChange={(event) => update('headerTitle', event.target.value)} /></Field><Field label="Bienvenida"><input name="welcomeText" value={formState.welcomeText} onChange={(event) => update('welcomeText', event.target.value)} /></Field>
          <Field label="Placeholder del chat"><input name="placeholderText" value={formState.placeholderText} onChange={(event) => update('placeholderText', event.target.value)} /></Field><Field label="Tipografía"><select name="fontFamily" value="Poppins" disabled><option value="Poppins">Poppins</option></select></Field>
        </div></div>
        <div className="form-section"><div><span className="section-icon"><ImageIcon size={19} /></span><h2>Recursos visuales</h2></div><div className="widget-assets">
          <label><span>Avatar o logo</span>{defaults.launcherIcon && <img src={defaults.launcherIcon} alt="Icono actual" />}<input type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => { const file = event.target.files?.[0]; if (file) asset.mutate({ kind: 'launcher', file }); }} /></label>
          <label><span>Imagen vacía de conversación</span>{defaults.conversationEmptyImage && <img src={defaults.conversationEmptyImage} alt="Ilustración actual" />}<input type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => { const file = event.target.files?.[0]; if (file) asset.mutate({ kind: 'empty', file }); }} /></label>
        </div></div>
        <div className="form-actions">{(mutation.isError || asset.isError) && <span className="form-error">{formatApiError(mutation.error ?? asset.error)}</span>}{mutation.isSuccess && !mutation.isPending && <span className="success-text"><CheckCircle2 size={15} />Guardado</span>}{asset.isPending && <span className="muted">Subiendo imagen…</span>}<Button type="submit" disabled={mutation.isPending || asset.isPending}><Save size={16} />Guardar widget</Button></div>
      </form></Card>
      <div className="widget-preview"><p className="eyebrow">Vista previa</p><div className="browser-frame"><div className="browser-dots"><i /><i /><i /></div><div className="fake-site"><span /><span /><span /></div><div className={`chat-widget ${formState.position === 'bottom-left' ? 'chat-widget--left' : ''}`} style={{ '--widget-primary': formState.primaryColor, '--widget-accent': formState.accentColor, '--widget-background': formState.backgroundColor, '--widget-text': formState.textColor, '--widget-radius': `${formState.borderRadius}px` } as React.CSSProperties}><header><span>{formState.launcherIcon ? <img src={formState.launcherIcon} alt="" /> : <Webhook size={17} />}</span><div><strong>{formState.headerTitle}</strong><small>En línea</small></div></header><main>{formState.conversationEmptyImage && <img src={formState.conversationEmptyImage} alt="" />}<div>{formState.welcomeText}</div></main><footer>{formState.placeholderText}</footer></div></div></div>
    </div>
    <WidgetContentEditor mode="texts" initial={defaults.content} saving={mutation.isPending} saved={mutation.isSuccess} error={mutation.error} onSave={(content) => mutation.mutate({ ...defaults, content })} />
    <Card className="panel-card widget-installation-summary">
      <div className="card-heading"><div><p className="eyebrow">Publicación</p><h2>Instalación</h2></div><Link className="button button--secondary" to={`/administracion/empresas/${companyId}/automatizacion/webchat/instalaciones`}>Administrar instalaciones</Link></div>
      {query.data?.installations.length ? <div className="overview-list">{query.data.installations.map((item) => <Link key={String(item.id)} to={`/administracion/empresas/${companyId}/automatizacion/webchat/instalaciones`}><span><strong>{String(item.name)}</strong><small>{String(item.install_type)} · {(item.allowed_domains as string[]).join(', ') || 'Sin dominios'}</small><small>Activation Key: {String(item.activation_key_prefix ?? 'Oculta')}</small></span><Badge tone={item.is_active ? 'green' : 'neutral'}>{item.is_active ? 'Activa' : 'Pausada'}</Badge></Link>)}</div> : <EmptyState title="Sin instalaciones" detail="Crea una instalación para obtener la clave, Script URL y snippet." />}
    </Card>
  </>;
}

function Installations({ companyId }: { companyId: string }) {
  const client = useQueryClient();
  const [created, setCreated] = useState<{ id: string; key: string; type: string } | null>(null);
  const [installType, setInstallType] = useState<'script' | 'wordpress'>('script');
  const query = useQuery({ queryKey: ['widgets', companyId], queryFn: () => api<WidgetState>(`/admin/companies/${companyId}/widgets`) });
  const mutation = useMutation({ mutationFn: (body: unknown) => api<Record<string, unknown>>(`/admin/companies/${companyId}/installations`, { method: 'POST', ...jsonBody(body) }), onSuccess: async (data) => { setCreated({ id: String(data.id), key: String(data.activationKey), type: String(data.install_type) }); await client.invalidateQueries({ queryKey: ['widgets', companyId] }); } });
  const toggle = useMutation({ mutationFn: (id: string) => api(`/admin/companies/${companyId}/installations/${id}/toggle`, { method: 'PATCH', ...jsonBody({}) }), onSuccess: () => client.invalidateQueries({ queryKey: ['widgets', companyId] }) });
  const widget = query.data?.widgets[0];
  const widgetUrl = import.meta.env.VITE_WIDGET_URL || `${window.location.origin}/widget/movensa-widget.js`;
  const apiBaseUrl = String(import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '');
  const widgetApiUrl = apiBaseUrl.endsWith('/v1') ? apiBaseUrl : `${apiBaseUrl}/v1`;
  const installCode = created ? `<script src="${widgetUrl}" data-key="${created.key}" data-api-url="${widgetApiUrl}" defer></script>` : '';
  if (query.isLoading) return <LoadingState />;
  return <div className="settings-columns"><Card className="form-card"><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); mutation.mutate({ widgetId: String(widget?.id), name: form.get('name'), installType, allowedDomains: String(form.get('domains')).split(',').map((item) => item.trim()).filter(Boolean) }); }}><div className="form-section"><div><span className="section-icon"><Globe2 size={19} /></span><h2>Nueva instalación</h2><p>Elige cómo publicar el widget. La clave y el paquete se muestran una sola vez.</p></div><div className="form-grid"><Field label="Nombre"><input name="name" required placeholder="Sitio principal" /></Field><Field label="Dominios permitidos" hint="Solo dominios, separados por coma. Admite *.ejemplo.com"><input name="domains" required placeholder="www.ejemplo.com, ejemplo.com" /></Field><Field label="Método de instalación"><div className="installation-kind-grid"><label className="installation-kind"><input type="radio" name="type" value="script" checked={installType === 'script'} onChange={() => setInstallType('script')} /><span><strong>JavaScript</strong><small>Snippet para HTML, React, Vue u otro sitio.</small></span></label><label className="installation-kind"><input type="radio" name="type" value="wordpress" checked={installType === 'wordpress'} onChange={() => setInstallType('wordpress')} /><span><strong>Plugin WordPress</strong><small>ZIP listo para subir y activar.</small></span></label></div></Field></div></div><div className="form-actions">{(mutation.isError || toggle.isError) && <span className="form-error">{formatApiError(mutation.error ?? toggle.error)}</span>}<Button type="submit" disabled={!widget || mutation.isPending}><Plus size={16} />{installType === 'wordpress' ? 'Generar plugin' : 'Generar script'}</Button></div></form>{created && <div className="one-time-secret"><strong>{created.type === 'wordpress' ? 'Descarga ahora el plugin; la clave no volverá a mostrarse' : 'Copia ahora el snippet; la clave no volverá a mostrarse'}</strong><code>{installCode}</code><div className="inline-actions"><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(installCode)}><Copy size={15} />Copiar snippet</Button>{created.type === 'wordpress' && <Button variant="secondary" onClick={() => void downloadApiAsset(`/v1/admin/companies/${companyId}/installations/${created.id}/wordpress-plugin`, 'movensa-webchat.zip', { method: 'POST', ...jsonBody({ activationKey: created.key }) })}><Download size={15} />Descargar plugin WordPress (.zip)</Button>}</div></div>}<div className="installation-guide"><h3>{installType === 'wordpress' ? 'Cómo instalar en WordPress' : 'Cómo instalar con JavaScript'}</h3><p>{installType === 'wordpress' ? 'Genera la instalación, descarga el ZIP y súbelo desde Plugins > Añadir plugin > Subir plugin. Actívalo y limpia la caché del sitio.' : 'Genera la instalación y pega el snippet antes de cerrar </body>. El cargador usa defer, no bloquea la página y valida el dominio en el servidor.'}</p></div></Card><Card className="panel-card"><div className="card-heading"><div><p className="eyebrow">Configuradas</p><h2>Instalaciones</h2></div><MonitorSmartphone size={20} /></div>{query.data?.installations.length ? query.data.installations.map((item) => <article className="installation-row" key={String(item.id)}><span className="section-icon">{item.install_type === 'wordpress' ? <Download size={17} /> : <Code2 size={17} />}</span><div><strong>{String(item.name)}</strong><small>{item.install_type === 'wordpress' ? 'Plugin WordPress' : 'JavaScript'} · {(item.allowed_domains as string[]).map(displayAllowedDomain).join(', ')}</small></div><div className="installation-actions"><Badge tone={item.is_active ? 'green' : 'neutral'}>{item.is_active ? 'Activa' : 'Pausada'}</Badge><Button variant="ghost" aria-label={item.is_active ? 'Pausar instalación' : 'Activar instalación'} onClick={() => toggle.mutate(String(item.id))}><Power size={14} /></Button></div></article>) : <EmptyState title="Sin instalaciones" detail="Crea una clave para publicar el widget." />}</Card></div>;
}
