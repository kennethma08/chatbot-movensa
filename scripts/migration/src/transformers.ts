import { flowDocumentSchema, type FlowDocument } from '@movensa/shared';

type Row = Record<string, unknown>;

function row(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function number(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeWidgetPosition(value: unknown): 'bottom-left' | 'bottom-right' {
  return value === 'left' || value === 'bottom-left' ? 'bottom-left' : 'bottom-right';
}

export function normalizeInstallType(value: unknown): 'script' | 'wordpress' {
  return value === 'wordpress' ? 'wordpress' : 'script';
}

export function normalizeFlowDocument(value: unknown): FlowDocument {
  const current = flowDocumentSchema.safeParse(value);
  if (current.success) return current.data;

  const legacy = row(value);
  const legacyNodes = Array.isArray(legacy.nodes) ? legacy.nodes.map(row) : [];
  if (!legacyNodes.length) throw new Error('El flujo heredado no contiene nodos.');
  const validIds = new Set(legacyNodes.map((item) => string(item.id)).filter(Boolean));
  const nodes: FlowDocument['nodes'] = legacyNodes.map((item, index) => {
    const id = string(item.id, `node-${index + 1}`);
    const legacyType = string(item.type, 'message');
    const type: FlowDocument['nodes'][number]['type'] = legacyType === 'message' ? 'text' : legacyType === 'transfer' ? 'handoff' :
      ['start','text','menu','question','condition','template','image','document','location','handoff','end'].includes(legacyType)
        ? legacyType as FlowDocument['nodes'][number]['type'] : 'text';
    const text = string(item.text);
    const storeKey = string(item.storeKey);
    let data: Record<string, unknown> = {};
    if (type === 'text') data = { text };
    else if (type === 'question') data = { text, variable: storeKey || `${id}_answer` };
    else if (type === 'menu') data = {
      text,
      variable: storeKey || `${id}_selection`,
      retryText: 'Elige una de las opciones disponibles.',
      options: (Array.isArray(item.options) ? item.options : []).map((option, optionIndex) => {
        const legacyOption = row(option);
        return { id: `option-${optionIndex + 1}`, label: string(legacyOption.label, `Opción ${optionIndex + 1}`), value: string(legacyOption.value, string(legacyOption.label)) };
      }),
    };
    else if (type === 'handoff') data = { reason: text || 'Solicitud de agente' };
    return { id, type, label: string(item.title, id), position: { x: number(item.x, 80), y: number(item.y, 80 + index * 110) }, data };
  });

  const edges: FlowDocument['edges'] = [];
  for (const item of legacyNodes) {
    const source = string(item.id);
    const target = string(item.nextNodeId);
    if (source && target && validIds.has(target)) edges.push({ id: `edge-${edges.length + 1}`, source, target });
    if (string(item.type) !== 'menu') continue;
    for (const [optionIndex, option] of (Array.isArray(item.options) ? item.options : []).entries()) {
      const target = string(row(option).nextNodeId);
      if (source && target && validIds.has(target)) edges.push({ id: `edge-${edges.length + 1}`, source, target, sourceHandle: `option-${optionIndex + 1}` });
    }
  }
  return flowDocumentSchema.parse({ version: 1, nodes, edges });
}
