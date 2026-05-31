import { createServer, defineContext } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { capabilities } from './capabilities.js';
import type { Context, TenantMember } from './capabilities.js';

const PORT = Number(process.env['PORT'] ?? 3000);

// Simulate a session store — keyed by API token
const SESSIONS = new Map<string, { userId: string; tenantId: string }>([
  ['token-alice-acme', { userId: 'u1', tenantId: 'acme' }],
  ['token-bob-acme', { userId: 'u2', tenantId: 'acme' }],
  ['token-carol-acme', { userId: 'u3', tenantId: 'acme' }],
  ['token-dave-widget', { userId: 'u4', tenantId: 'widget-co' }],
]);

const MEMBERS_LOOKUP = new Map<string, TenantMember[]>([
  ['acme', [
    { userId: 'u1', tenantId: 'acme', role: 'owner', name: 'Alice', email: 'alice@acme.com' },
    { userId: 'u2', tenantId: 'acme', role: 'admin', name: 'Bob', email: 'bob@acme.com' },
    { userId: 'u3', tenantId: 'acme', role: 'member', name: 'Carol', email: 'carol@acme.com' },
  ]],
  ['widget-co', [
    { userId: 'u4', tenantId: 'widget-co', role: 'owner', name: 'Dave', email: 'dave@widget.co' },
  ]],
]);

function header(req: { headers: Record<string, string | string[] | undefined> }, name: string): string | null {
  const v = req.headers[name];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

const buildContext = defineContext(async (req): Promise<Context> => {
  const rawAuth = header(req, 'authorization');
  const apiToken = rawAuth?.replace('Bearer ', '') ?? null;
  const tenantHeader = header(req, 'x-tenant-id');

  const session = apiToken ? (SESSIONS.get(apiToken) ?? null) : null;
  const tenantId = tenantHeader ?? session?.tenantId ?? null;
  const userId = session?.userId ?? null;

  let membership: TenantMember | null = null;
  if (tenantId && userId) {
    const members = MEMBERS_LOOKUP.get(tenantId) ?? [];
    membership = members.find((m) => m.userId === userId) ?? null;
  }

  return { requestId: crypto.randomUUID(), tenantId, userId, membership };
});

const server = createServer({
  context: buildContext,
  capabilities,
  transports: [restTransport({ port: PORT, cors: { origin: '*' } })],
});

server.start().then(() => {
  console.log(`Multi-tenant example listening on http://localhost:${PORT}`);
  console.log();
  console.log('Try it (as owner Alice in Acme):');
  console.log(`  curl -X POST http://localhost:${PORT}/tenant/getTenant -H 'Authorization: Bearer token-alice-acme'`);
  console.log(`  curl -X POST http://localhost:${PORT}/tenant/listMembers -H 'Authorization: Bearer token-alice-acme'`);
  console.log(`  curl -X POST http://localhost:${PORT}/tenant/inviteMember -H 'Authorization: Bearer token-alice-acme' -H 'Content-Type: application/json' -d '{"email":"new@acme.com","role":"member"}'`);
  console.log();
  console.log('Try it (as member Carol — cannot invite):');
  console.log(`  curl -X POST http://localhost:${PORT}/tenant/inviteMember -H 'Authorization: Bearer token-carol-acme' -H 'Content-Type: application/json' -d '{"email":"x@x.com","role":"member"}'`);
});
