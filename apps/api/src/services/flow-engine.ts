import { flowDocumentSchema, type FlowDocument } from '../../../../packages/shared/src/index.js';

export type FlowEffect =
  | { type: 'text'; text: string }
  | { type: 'template'; name: string; language: string; parameters: string[] }
  | { type: 'media'; mediaType: 'image' | 'document'; url: string; caption?: string }
  | { type: 'location'; latitude: number; longitude: number; name?: string }
  | { type: 'handoff'; reason: string };

export interface FlowState {
  currentNodeId: string | null;
  status: 'active' | 'waiting' | 'completed' | 'failed';
  variables: Record<string, string>;
}

export interface FlowResult {
  state: FlowState;
  effects: FlowEffect[];
}

function textValue(data: Record<string, unknown>, key: string, fallback = ''): string {
  const value = data[key];
  return typeof value === 'string' ? value : fallback;
}

function interpolate(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => variables[key] ?? '');
}

function nextNode(document: FlowDocument, source: string, handle?: string): string | null {
  const exact = handle
    ? document.edges.find((edge) => edge.source === source && edge.sourceHandle === handle)
    : undefined;
  return exact?.target ?? document.edges.find((edge) => edge.source === source && !edge.sourceHandle)?.target ?? null;
}

function evaluateCondition(data: Record<string, unknown>, variables: Record<string, string>): boolean {
  const variable = textValue(data, 'variable');
  const operator = textValue(data, 'operator', 'equals');
  const expected = interpolate(textValue(data, 'value'), variables).toLocaleLowerCase();
  const actual = (variables[variable] ?? '').toLocaleLowerCase();
  if (operator === 'exists') return actual.length > 0;
  if (operator === 'contains') return actual.includes(expected);
  if (operator === 'not_equals') return actual !== expected;
  return actual === expected;
}

function resolveMenu(data: Record<string, unknown>, input: string): { handle: string; value: string } | null {
  const options = Array.isArray(data.options) ? data.options : [];
  const normalized = input.trim().toLocaleLowerCase();
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (!option || typeof option !== 'object') continue;
    const row = option as Record<string, unknown>;
    const label = String(row.label ?? '').trim();
    const value = String(row.value ?? label).trim();
    if (normalized === String(index + 1) || normalized === label.toLocaleLowerCase() || normalized === value.toLocaleLowerCase()) {
      return { handle: String(row.id ?? value), value };
    }
  }
  return null;
}

export function executeFlow(rawDocument: unknown, initial: FlowState | null, input?: string): FlowResult {
  const document = flowDocumentSchema.parse(rawDocument);
  const variables = { ...(initial?.variables ?? {}) };
  const effects: FlowEffect[] = [];
  let currentNodeId = initial?.currentNodeId ?? document.nodes.find((node) => node.type === 'start')?.id ?? null;
  let status: FlowState['status'] = initial?.status === 'completed' ? 'completed' : 'active';

  if (status === 'completed') return { state: { currentNodeId, status, variables }, effects };

  const waitingNode = currentNodeId ? document.nodes.find((node) => node.id === currentNodeId) : undefined;
  if (initial?.status === 'waiting' && waitingNode) {
    if (!input?.trim()) return { state: { currentNodeId, status: 'waiting', variables }, effects };
    if (waitingNode.type === 'question') {
      const variable = textValue(waitingNode.data, 'variable', 'answer');
      variables[variable] = input.trim();
      currentNodeId = nextNode(document, waitingNode.id);
    } else if (waitingNode.type === 'menu') {
      const selected = resolveMenu(waitingNode.data, input);
      if (!selected) {
        effects.push({ type: 'text', text: interpolate(textValue(waitingNode.data, 'retryText', 'Elige una de las opciones disponibles.'), variables) });
        return { state: { currentNodeId, status: 'waiting', variables }, effects };
      }
      variables[textValue(waitingNode.data, 'variable', 'menu_selection')] = selected.value;
      currentNodeId = nextNode(document, waitingNode.id, selected.handle);
    }
  }

  for (let steps = 0; steps < 50 && currentNodeId; steps += 1) {
    const node = document.nodes.find((candidate) => candidate.id === currentNodeId);
    if (!node) return { state: { currentNodeId, status: 'failed', variables }, effects };
    switch (node.type) {
      case 'start':
        currentNodeId = nextNode(document, node.id);
        break;
      case 'text':
        effects.push({ type: 'text', text: interpolate(textValue(node.data, 'text'), variables) });
        currentNodeId = nextNode(document, node.id);
        break;
      case 'question':
        effects.push({ type: 'text', text: interpolate(textValue(node.data, 'text'), variables) });
        return { state: { currentNodeId: node.id, status: 'waiting', variables }, effects };
      case 'menu': {
        const options = Array.isArray(node.data.options) ? node.data.options : [];
        const menu = options.map((option, index) => {
          const row = option as Record<string, unknown>;
          return `${index + 1}. ${String(row.label ?? row.value ?? '')}`;
        }).join('\n');
        effects.push({ type: 'text', text: `${interpolate(textValue(node.data, 'text'), variables)}${menu ? `\n${menu}` : ''}`.trim() });
        return { state: { currentNodeId: node.id, status: 'waiting', variables }, effects };
      }
      case 'condition':
        currentNodeId = nextNode(document, node.id, evaluateCondition(node.data, variables) ? 'true' : 'false');
        break;
      case 'template':
        effects.push({
          type: 'template',
          name: textValue(node.data, 'name'),
          language: textValue(node.data, 'language', 'es'),
          parameters: Array.isArray(node.data.parameters)
            ? node.data.parameters.map((value) => interpolate(String(value), variables))
            : [],
        });
        currentNodeId = nextNode(document, node.id);
        break;
      case 'image':
      case 'document':
        effects.push({
          type: 'media',
          mediaType: node.type,
          url: interpolate(textValue(node.data, 'url'), variables),
          ...(textValue(node.data, 'caption') ? { caption: interpolate(textValue(node.data, 'caption'), variables) } : {}),
        });
        currentNodeId = nextNode(document, node.id);
        break;
      case 'location':
        effects.push({
          type: 'location',
          latitude: Number(node.data.latitude),
          longitude: Number(node.data.longitude),
          ...(textValue(node.data, 'name') ? { name: interpolate(textValue(node.data, 'name'), variables) } : {}),
        });
        currentNodeId = nextNode(document, node.id);
        break;
      case 'handoff':
        effects.push({ type: 'handoff', reason: interpolate(textValue(node.data, 'reason', 'Solicitud del cliente'), variables) });
        return { state: { currentNodeId: node.id, status: 'completed', variables }, effects };
      case 'end':
        return { state: { currentNodeId: node.id, status: 'completed', variables }, effects };
    }
  }

  status = currentNodeId ? 'failed' : 'completed';
  return { state: { currentNodeId, status, variables }, effects };
}
