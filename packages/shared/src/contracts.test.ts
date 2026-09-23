import { describe, expect, it } from 'vitest';
import { aiSettingsSchema, canRole, flowDocumentSchema, integrationUpsertSchema, rolesFor } from './index.js';

describe('shared contracts', () => {
  it('rejects a flow without exactly one start node', () => {
    const result = flowDocumentSchema.safeParse({ version: 1, nodes: [], edges: [] });
    expect(result.success).toBe(false);
  });

  it('does not accept weak webhook verify tokens', () => {
    const result = integrationUpsertSchema.safeParse({
      phoneNumberId: '12345',
      accessToken: 'a'.repeat(20),
      appSecret: 'b'.repeat(20),
      verifyToken: 'short',
      apiBaseUrl: 'https://graph.facebook.com',
      apiVersion: 'v23.0',
      isActive: true,
    });
    expect(result.success).toBe(false);
  });

  it('preserves the original unassigned_only AI response mode', () => {
    const base = {
      isEnabled: true,
      provider: 'openai',
      model: 'gpt-4.1-mini',
      responseMode: 'unassigned_only',
      temperature: 0.3,
      maxTokens: 500,
      pauseWhenAssigned: true,
      escalateOnHumanRequest: true,
    } as const;
    expect(aiSettingsSchema.safeParse(base).success).toBe(true);
    expect(aiSettingsSchema.safeParse({ ...base, responseMode: 'unassigned' }).success).toBe(false);
  });
});

describe('role capabilities', () => {
  it('keeps tenant operation out of the super administrator role', () => {
    expect(canRole('super_admin', 'tenantOperations')).toBe(false);
    expect(canRole('admin', 'tenantOperations')).toBe(true);
    expect(canRole('agent', 'tenantOperations')).toBe(true);
  });

  it('limits team and reports to company administrators', () => {
    expect(rolesFor('manageTeam')).toEqual(['admin']);
    expect(rolesFor('viewReports')).toEqual(['admin']);
  });

  it('limits platform and automation administration to super administrators', () => {
    expect(rolesFor('managePlatform')).toEqual(['super_admin']);
    expect(rolesFor('manageAutomation')).toEqual(['super_admin']);
    expect(rolesFor('reviewCompanyWorkspace')).toEqual(['super_admin']);
  });
});
