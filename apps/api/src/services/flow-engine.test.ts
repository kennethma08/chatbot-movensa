import { describe, expect, it } from 'vitest';
import { executeFlow } from './flow-engine.js';

const flow = {
  version: 1 as const,
  nodes: [
    { id: 'start', type: 'start' as const, label: 'Inicio', position: { x: 0, y: 0 }, data: {} },
    { id: 'hello', type: 'text' as const, label: 'Saludo', position: { x: 0, y: 100 }, data: { text: 'Hola' } },
    { id: 'menu', type: 'menu' as const, label: 'Menú', position: { x: 0, y: 200 }, data: { text: 'Elige', options: [{ id: 'sales', label: 'Ventas', value: 'sales' }] } },
    { id: 'handoff', type: 'handoff' as const, label: 'Agente', position: { x: 0, y: 300 }, data: { reason: 'Ventas' } },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'hello' },
    { id: 'e2', source: 'hello', target: 'menu' },
    { id: 'e3', source: 'menu', target: 'handoff', sourceHandle: 'sales' },
  ],
};

describe('flow engine', () => {
  it('stops at an input node and resumes deterministically', () => {
    const first = executeFlow(flow, null);
    expect(first.effects.map((effect) => effect.type)).toEqual(['text', 'text']);
    expect(first.state.status).toBe('waiting');
    const second = executeFlow(flow, first.state, '1');
    expect(second.effects[0]).toEqual({ type: 'handoff', reason: 'Ventas' });
    expect(second.state.status).toBe('completed');
  });

  it('re-prompts for an invalid menu selection', () => {
    const first = executeFlow(flow, null);
    const second = executeFlow(flow, first.state, 'desconocido');
    expect(second.state.status).toBe('waiting');
    expect(second.effects[0]?.type).toBe('text');
  });
});
