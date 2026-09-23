import { describe, expect, it } from 'vitest';
import { normalizeFlowDocument, normalizeInstallType, normalizeWidgetPosition } from './transformers.js';

describe('legacy migration transformers', () => {
  it('converts legacy webchat nodes and branches to the v1 graph', () => {
    const flow = normalizeFlowDocument({
      version: '1.0', startNodeId: 'start', nodes: [
        { id: 'start', type: 'start', title: 'Inicio', nextNodeId: 'welcome', x: 10, y: 20 },
        { id: 'welcome', type: 'message', title: 'Bienvenida', text: 'Hola', nextNodeId: 'menu' },
        { id: 'menu', type: 'menu', title: 'Menú', text: 'Elige', options: [{ label: 'Ventas', value: 'sales', nextNodeId: 'transfer' }] },
        { id: 'transfer', type: 'transfer', title: 'Agente', text: 'Te conectamos' },
      ],
    });
    expect(flow.version).toBe(1);
    expect(flow.nodes.find((node) => node.id === 'welcome')?.type).toBe('text');
    expect(flow.nodes.find((node) => node.id === 'transfer')).toMatchObject({ type: 'handoff', data: { reason: 'Te conectamos' } });
    expect(flow.edges).toContainEqual(expect.objectContaining({ source: 'menu', target: 'transfer', sourceHandle: 'option-1' }));
  });

  it('normalizes legacy enum values accepted by the target schema', () => {
    expect(normalizeWidgetPosition('right')).toBe('bottom-right');
    expect(normalizeWidgetPosition('left')).toBe('bottom-left');
    expect(normalizeInstallType('code')).toBe('script');
    expect(normalizeInstallType('wordpress')).toBe('wordpress');
  });
});
