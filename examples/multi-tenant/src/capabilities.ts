import { z } from 'zod';
import { capability, defineError, defineGuard } from 'capix';

export const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
  Forbidden: defineError(403, 'Forbidden'),
  NotFound: defineError(404, 'Not found'),
  TenantNotFound: defineError(404, 'Tenant not found'),
};

export type TenantRole = 'owner' | 'admin' | 'member';

export type Tenant = {
  id: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
};

export type TenantMember = {
  userId: string;
  tenantId: string;
  role: TenantRole;
  name: string;
  email: string;
};

export type Context = {
  requestId: string;
  tenantId: string | null;
  userId: string | null;
  membership: TenantMember | null;
};

// In-memory store for demonstration
const TENANTS = new Map<string, Tenant>([
  ['acme', { id: 'acme', name: 'Acme Corp', plan: 'pro' }],
  ['widget-co', { id: 'widget-co', name: 'Widget Co', plan: 'enterprise' }],
]);

const MEMBERS = new Map<string, TenantMember[]>([
  ['acme', [
    { userId: 'u1', tenantId: 'acme', role: 'owner', name: 'Alice', email: 'alice@acme.com' },
    { userId: 'u2', tenantId: 'acme', role: 'admin', name: 'Bob', email: 'bob@acme.com' },
    { userId: 'u3', tenantId: 'acme', role: 'member', name: 'Carol', email: 'carol@acme.com' },
  ]],
  ['widget-co', [
    { userId: 'u4', tenantId: 'widget-co', role: 'owner', name: 'Dave', email: 'dave@widget.co' },
  ]],
]);

// Guards

export const mustBeAuthenticated = defineGuard(
  (ctx: Context): asserts ctx is Context & { userId: string; tenantId: string; membership: TenantMember } => {
    if (!ctx.tenantId) throw errors.TenantNotFound();
    if (!ctx.userId || !ctx.membership) throw errors.Unauthorized();
  },
);

type AuthedContext = Context & { userId: string; tenantId: string; membership: TenantMember };

const mustBeAtLeast = (minRole: TenantRole) =>
  defineGuard((ctx: AuthedContext) => {
    const ranks: Record<TenantRole, number> = { member: 0, admin: 1, owner: 2 };
    if ((ranks[ctx.membership.role] ?? -1) < ranks[minRole]) {
      throw errors.Forbidden({ required: minRole, current: ctx.membership.role });
    }
  });

export const mustBeAdmin = mustBeAtLeast('admin');
export const mustBeOwner = mustBeAtLeast('owner');

// Capabilities

const getTenant = capability(
  (_input: undefined, ctx: AuthedContext) => {
    return TENANTS.get(ctx.tenantId)!;
  },
).guard(mustBeAuthenticated);

const listMembers = capability(
  (_input: undefined, ctx: AuthedContext) => {
    return MEMBERS.get(ctx.tenantId) ?? [];
  },
).guard(mustBeAuthenticated);

const inviteMember = capability(
  z.object({ email: z.string().email(), role: z.enum(['admin', 'member']) }),
  async ({ email, role }, ctx: AuthedContext) => {
    const members = MEMBERS.get(ctx.tenantId) ?? [];
    if (members.some((m) => m.email === email)) {
      throw errors.NotFound({ message: 'User already a member' });
    }
    const newMember: TenantMember = {
      userId: `u${Date.now()}`,
      tenantId: ctx.tenantId,
      role,
      name: email.split('@')[0]!,
      email,
    };
    members.push(newMember);
    MEMBERS.set(ctx.tenantId, members);
    return newMember;
  },
).guard(mustBeAuthenticated).guard(mustBeAdmin);

const updateTenantPlan = capability(
  z.object({ plan: z.enum(['free', 'pro', 'enterprise']) }),
  async ({ plan }, ctx: AuthedContext) => {
    const tenant = TENANTS.get(ctx.tenantId)!;
    tenant.plan = plan;
    return tenant;
  },
).guard(mustBeAuthenticated).guard(mustBeOwner);

export const capabilities = {
  tenant: { getTenant, listMembers, inviteMember, updateTenantPlan },
};
