import { describe, expect, it } from 'vitest';
import type { FlowDocument } from '@movensa/shared';
import { executeFlow } from '../src/services/flow-engine.js';

function node(id: string, type: FlowDocument['nodes'][number]['type'], data: Record<string, unknown> = {}) {
  return { id, type, label: id, position: { x: 0, y: 0 }, data };
}

describe('deterministic flow engine', () => {
  it('waits for an answer and follows the matching condition branch', () => {
    const flow: FlowDocument = {
      version: 1,
      nodes: [
        node('start', 'start'),
        node('ask', 'question', { text: '¿Aceptas?', variable: 'accepted' }),
        node('check', 'condition', { variable: 'accepted', operator: 'equals', value: 'sí' }),
        node('yes', 'text', { text: 'Perfecto, {{accepted}}.' }),
        node('no', 'text', { text: 'Entendido.' }),
        node('end', 'end'),
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask' },
        { id: 'e2', source: 'ask', target: 'check' },
        { id: 'e3', source: 'check', sourceHandle: 'true', target: 'yes' },
        { id: 'e4', source: 'check', sourceHandle: 'false', target: 'no' },
        { id: 'e5', source: 'yes', target: 'end' },
        { id: 'e6', source: 'no', target: 'end' },
      ],
    };
    const waiting = executeFlow(flow, null);
    expect(waiting.state.status).toBe('waiting');
    expect(waiting.effects).toEqual([{ type: 'text', text: '¿Aceptas?' }]);
    const completed = executeFlow(flow, waiting.state, 'Sí');
    expect(completed.state.status).toBe('completed');
    expect(completed.effects).toEqual([{ type: 'text', text: 'Perfecto, Sí.' }]);
  });

  it('keeps a menu waiting on invalid input and routes a valid option', () => {
    const flow: FlowDocument = {
      version: 1,
      nodes: [node('start', 'start'), node('menu', 'menu', { text: 'Elige:', variable: 'choice', retryText: 'Opción inválida.', options: [{ id: 'sales', label: 'Ventas', value: 'ventas' }] }), node('handoff', 'handoff', { reason: '{{choice}}' })],
      edges: [{ id: 'e1', source: 'start', target: 'menu' }, { id: 'e2', source: 'menu', sourceHandle: 'sales', target: 'handoff' }],
    };
    const waiting = executeFlow(flow, null);
    const retry = executeFlow(flow, waiting.state, 'desconocida');
    expect(retry.state.status).toBe('waiting');
    expect(retry.effects[0]).toEqual({ type: 'text', text: 'Opción inválida.' });
    const routed = executeFlow(flow, retry.state, '1');
    expect(routed.state.variables.choice).toBe('ventas');
    expect(routed.effects).toContainEqual({ type: 'handoff', reason: 'ventas' });
  });

  it('emits template, media and location effects without external calls', () => {
    const flow: FlowDocument = {
      version: 1,
      nodes: [
        node('start', 'start'), node('template', 'template', { name: 'bienvenida', language: 'es', parameters: ['{{name}}'] }),
        node('image', 'image', { url: 'https://example.com/{{name}}.jpg', caption: 'Hola {{name}}' }),
        node('document', 'document', { url: 'https://example.com/file.pdf' }),
        node('location', 'location', { latitude: 14.63, longitude: -90.5, name: 'Oficina' }), node('end', 'end'),
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'template' }, { id: 'e2', source: 'template', target: 'image' },
        { id: 'e3', source: 'image', target: 'document' }, { id: 'e4', source: 'document', target: 'location' },
        { id: 'e5', source: 'location', target: 'end' },
      ],
    };
    const result = executeFlow(flow, { currentNodeId: 'start', status: 'active', variables: { name: 'Ana' } });
    expect(result.state.status).toBe('completed');
    expect(result.effects).toEqual([
      { type: 'template', name: 'bienvenida', language: 'es', parameters: ['Ana'] },
      { type: 'media', mediaType: 'image', url: 'https://example.com/Ana.jpg', caption: 'Hola Ana' },
      { type: 'media', mediaType: 'document', url: 'https://example.com/file.pdf' },
      { type: 'location', latitude: 14.63, longitude: -90.5, name: 'Oficina' },
    ]);
  });
});
