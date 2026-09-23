import { z } from 'zod';

export const appRoleSchema = z.enum(['super_admin', 'admin', 'agent']);
export type AppRole = z.infer<typeof appRoleSchema>;

export const appCapabilities = {
  dashboard: ['super_admin', 'admin', 'agent'],
  tenantOperations: ['admin', 'agent'],
  manageContacts: ['admin'],
  manageTeam: ['admin'],
  viewReports: ['admin'],
  assignConversations: ['admin'],
  managePlatform: ['super_admin'],
  manageAutomation: ['super_admin'],
  reviewCompanyWorkspace: ['super_admin'],
  viewProfile: ['super_admin', 'admin', 'agent'],
} as const satisfies Record<string, readonly AppRole[]>;

export type AppCapability = keyof typeof appCapabilities;

export function canRole(role: AppRole, capability: AppCapability): boolean {
  return (appCapabilities[capability] as readonly AppRole[]).includes(role);
}

export function rolesFor(capability: AppCapability): readonly AppRole[] {
  return appCapabilities[capability];
}

export const channelSchema = z.enum(['whatsapp', 'webchat']);
export type Channel = z.infer<typeof channelSchema>;

export const sessionContextSchema = z.object({
  authUserId: z.uuid(),
  userId: z.string().regex(/^\d+$/),
  companyId: z.string().regex(/^\d+$/).nullable(),
  role: appRoleSchema,
  name: z.string().min(1),
  email: z.email(),
});
export type SessionContext = z.infer<typeof sessionContextSchema>;

export interface ApiErrorShape {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export interface DashboardSummary {
  openConversations: number;
  waitingConversations: number;
  onlineAgents: number;
  contactsToday: number;
  averageFirstResponseSeconds: number | null;
  aiMessagesToday: number;
  conversationsByChannel: Array<{ channel: Channel; count: number }>;
  recentActivity: Array<{ id: string; label: string; detail: string; at: string }>;
}

export interface ContactSummary {
  id: string;
  name: string | null;
  phoneNumber: string;
  country: string | null;
  status: 'active' | 'blocked' | 'archived';
  lastMessageAt: string | null;
}

export interface ConversationSummary {
  id: string;
  contact: ContactSummary;
  channel: Channel;
  status: 'open' | 'waiting' | 'closed';
  assignedUserId: string | null;
  assignedUserName: string | null;
  lastActivityAt: string | null;
  lastMessage: string | null;
  unreadCount: number;
  agentRequested: boolean;
}

export interface MessageView {
  id: string;
  conversationId: string;
  sender: 'contact' | 'agent' | 'bot' | 'ai' | 'system';
  message: string | null;
  type: 'text' | 'image' | 'document' | 'audio' | 'location' | 'template' | 'system';
  channel: Channel;
  sentAt: string;
  attachment?: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number | null;
    downloadUrl: string;
  };
}

export const conversationListQuerySchema = z.object({
  status: z.enum(['open', 'waiting', 'closed', 'all']).default('open'),
  channel: z.enum(['whatsapp', 'webchat', 'all']).default('all'),
  assignment: z.enum(['mine', 'unassigned', 'all']).default('all'),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(4096),
  idempotencyKey: z.string().min(16).max(120),
});

export const assignConversationSchema = z.object({
  userId: z.string().regex(/^\d+$/).nullable(),
});

export const companyUpsertSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().regex(/^[a-z0-9-]{2,60}$/),
  description: z.string().trim().max(1000).nullable().optional(),
  contactEmail: z.email().nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  timeZone: z.string().trim().min(1).max(100).default('America/Costa_Rica'),
  isEnabled: z.boolean().default(true),
  flowKey: z.string().trim().max(160).nullable().optional(),
  notificationMode: z.enum(['disabled', 'always', 'outside_business_hours']).default('disabled'),
  notificationRecipients: z.array(z.email()).max(50).default([]),
  businessHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  businessHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  agentFarewellMessage: z.string().trim().max(1000).nullable().optional(),
});

export const userUpsertSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.email(),
  phone: z.string().trim().max(40).nullable().optional(),
  role: z.enum(['admin', 'agent']),
  status: z.boolean().default(true),
  password: z.string().min(8).max(72).optional(),
});

export const integrationUpsertSchema = z.object({
  phoneNumberId: z.string().trim().min(3).max(100),
  wabaId: z.string().trim().max(100).nullable().optional(),
  appId: z.string().trim().max(100).nullable().optional(),
  accessToken: z.string().min(20).max(4096).optional(),
  appSecret: z.string().min(20).max(4096).optional(),
  verifyToken: z.string().min(16).max(255).optional(),
  apiBaseUrl: z.url().default('https://graph.facebook.com'),
  apiVersion: z.string().regex(/^v\d+(\.\d+)?$/),
  isActive: z.boolean(),
});

export const aiSettingsSchema = z.object({
  isEnabled: z.boolean(),
  provider: z.enum(['openai', 'deepseek', 'gemini']),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().min(16).max(4096).optional(),
  apiBaseUrl: z.url().nullable().optional(),
  responseMode: z.enum(['disabled', 'always', 'outside_business_hours', 'unassigned_only']),
  systemPrompt: z.string().max(20_000).nullable().optional(),
  fallbackMessage: z.string().max(1000).nullable().optional(),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(1).max(8000),
  dailyMessageLimit: z.number().int().positive().nullable().optional(),
  monthlyMessageLimit: z.number().int().positive().nullable().optional(),
  pauseWhenAssigned: z.boolean(),
  escalateOnHumanRequest: z.boolean(),
});

export const flowNodeSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(['start', 'text', 'menu', 'question', 'condition', 'template', 'image', 'document', 'location', 'handoff', 'end']),
  label: z.string().max(160),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown()).default({}),
});

export const flowEdgeSchema = z.object({
  id: z.string().min(1).max(100),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullable().optional(),
});

export const flowDocumentSchema = z.object({
  version: z.literal(1),
  nodes: z.array(flowNodeSchema).max(250),
  edges: z.array(flowEdgeSchema).max(500),
}).superRefine((flow, context) => {
  const ids = new Set(flow.nodes.map((node) => node.id));
  const startNodes = flow.nodes.filter((node) => node.type === 'start');
  if (startNodes.length !== 1) {
    context.addIssue({ code: 'custom', message: 'El flujo debe tener exactamente un inicio.' });
  }
  for (const edge of flow.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      context.addIssue({ code: 'custom', message: `La conexión ${edge.id} referencia un nodo inexistente.` });
    }
  }
});
export type FlowDocument = z.infer<typeof flowDocumentSchema>;

export const webchatStartSchema = z.object({
  activationKey: z.string().min(20).max(255),
  origin: z.url(),
  pageUrl: z.url().optional(),
  referrerUrl: z.url().optional(),
  visitor: z.object({
    name: z.string().trim().max(160).optional(),
    email: z.email().optional(),
    phone: z.string().trim().max(40).optional(),
  }).default({}),
});

export const publicMessageSchema = z.object({
  sessionKey: z.string().min(20).max(255),
  text: z.string().trim().min(1).max(4096),
  clientMessageId: z.string().min(8).max(120),
});

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export function hasRole(actual: AppRole, allowed: readonly AppRole[]): boolean {
  return allowed.includes(actual);
}

export function toPublicId(value: bigint | number | string): string {
  return String(value);
}
