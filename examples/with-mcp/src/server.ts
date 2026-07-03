/**
 * with-mcp example — the same capabilities served over REST and MCP at once.
 *
 * Start: pnpm start (from examples/with-mcp)
 *   REST:  http://localhost:5050         (GET /notes, POST /notes, ...)
 *   MCP:   http://localhost:5051/mcp     (Streamable HTTP, stateless)
 *
 * Connect an MCP client to the HTTP endpoint:
 *   claude mcp add notes --transport http http://localhost:5051/mcp \
 *     --header "x-api-key: admin-key"
 *
 * Tools exposed (same registry as the REST routes):
 *   notes_listNotes    readOnlyHint  — { tag? }
 *   notes_getNote      readOnlyHint  — { id }
 *   notes_createNote                 — { title, body, tag? }
 *   notes_deleteNote   destructiveHint, admin only — { id }
 *
 * The x-api-key header reaches the context builder on both transports, so
 * the admin guard on deleteNote behaves identically over REST and MCP.
 *
 * Prefer stdio (no HTTP port, for clients that spawn the server directly)?
 * Swap the transport for: mcpTransport({ name: 'notes' })
 * — or serve a capabilities file straight from the CLI: `capix mcp`.
 */

import { z } from 'zod';
import { capability, defineContext, defineGuard, defineError, createServer, getHeader } from '@capixjs/core';
import type { BaseContext } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { mcpTransport } from '@capixjs/transport-mcp';

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

type Note = { id: string; title: string; body: string; tag: string | null };

const NOTES = new Map<string, Note>([
  ['1', { id: '1', title: 'Groceries', body: 'Oat milk, rye bread', tag: 'home' }],
  ['2', { id: '2', title: 'Standup', body: 'Demo the MCP transport', tag: 'work' }],
]);
let nextId = 3;

// ---------------------------------------------------------------------------
// Errors + context
// ---------------------------------------------------------------------------

const errors = {
  Forbidden: defineError(403, 'Forbidden'),
  NotFound: defineError(404, 'Note not found'),
};

type Context = BaseContext & { isAdmin: boolean };

const buildContext = defineContext(async (req): Promise<Context> => ({
  requestId: crypto.randomUUID(),
  isAdmin: getHeader(req, 'x-api-key') === 'admin-key',
}));

const cap = capability.withContext<Context>();

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const mustBeAdmin = defineGuard((ctx: Context) => {
  if (!ctx.isAdmin) throw errors.Forbidden();
});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

const NoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  tag: z.string().nullable(),
});

const listNotes = cap(
  z.object({ tag: z.string().optional() }),
  ({ tag }) => [...NOTES.values()].filter((n) => tag === undefined || n.tag === tag),
  'query',
);

const getNote = cap(
  z.object({ id: z.string() }),
  ({ id }) => {
    const note = NOTES.get(id);
    if (note === undefined) throw errors.NotFound();
    return note;
  },
  'query',
).output(NoteSchema);

const createNote = cap(
  z.object({ title: z.string().min(1), body: z.string(), tag: z.string().optional() }),
  ({ title, body, tag }) => {
    const note: Note = { id: String(nextId++), title, body, tag: tag ?? null };
    NOTES.set(note.id, note);
    return note;
  },
  'mutation',
).output(NoteSchema);

const deleteNote = cap(
  z.object({ id: z.string() }),
  ({ id }) => {
    if (!NOTES.delete(id)) throw errors.NotFound();
    return { deleted: id };
  },
  'delete',
).guard(mustBeAdmin);

// ---------------------------------------------------------------------------
// Server — one registry, two transports
// ---------------------------------------------------------------------------

createServer({
  context: buildContext,
  capabilities: {
    notes: { listNotes, getNote, createNote, deleteNote },
  },
  transports: [
    restTransport({ port: 5050 }),
    mcpTransport({ port: 5051, name: 'notes', version: '1.0.0' }),
  ],
}).start();
