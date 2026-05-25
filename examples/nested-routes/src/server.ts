/**
 * nested-routes example — shows how to use the http override for
 * nested resource URLs like /projects/:projectId/tasks.
 *
 * Capix's automatic route inference produces flat routes from group keys.
 * For hierarchical REST URLs, supply { http: { method, path } } explicitly.
 * The REST transport merges URL params, query string, and body into a single
 * typed input object, so :projectId arrives alongside page and status.
 *
 * Routes:
 *   GET  /projects
 *   GET  /projects/:id
 *   POST /projects
 *   GET  /projects/:projectId/tasks        ← nested, explicit override
 *   POST /projects/:projectId/tasks        ← nested, explicit override
 *   GET  /projects/:projectId/tasks/:id    ← nested, explicit override
 *   PATCH /projects/:projectId/tasks/:id   ← nested, explicit override
 *   DELETE /projects/:projectId/tasks/:id  ← nested, explicit override
 */

import { z } from 'zod';
import { capability, defineContext, defineError, defineGuard, createServer } from 'capix';
import { restTransport } from 'capix-transport-rest';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

type Project = { id: string; name: string; ownerId: string };
type Task = { id: string; projectId: string; title: string; status: 'todo' | 'in_progress' | 'done' };

// ---------------------------------------------------------------------------
// In-memory data
// ---------------------------------------------------------------------------

const projects: Project[] = [
  { id: 'p1', name: 'Alpha', ownerId: 'u1' },
  { id: 'p2', name: 'Beta', ownerId: 'u2' },
];

const tasks: Task[] = [
  { id: 't1', projectId: 'p1', title: 'Setup repo', status: 'done' },
  { id: 't2', projectId: 'p1', title: 'Write tests', status: 'in_progress' },
  { id: 't3', projectId: 'p2', title: 'Initial design', status: 'todo' },
];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const errors = {
  NotFound: defineError(404, 'Not found'),
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const buildContext = defineContext(async (_req) => ({
  requestId: crypto.randomUUID(),
}));

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const ensureProjectExists = defineGuard(
  (ctx: ReturnType<typeof buildContext> extends Promise<infer T> ? T : never) => void ctx,
);
void ensureProjectExists;

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

// Flat routes — no override needed
const listProjects = capability(
  z.object({}),
  async () => projects,
  'query',
);

const getProject = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const p = projects.find((p) => p.id === id);
    if (!p) throw errors.NotFound();
    return p;
  },
  'query',
);

const createProject = capability(
  z.object({ name: z.string().min(1) }),
  async ({ name }) => {
    const p: Project = { id: `p${Date.now()}`, name, ownerId: 'u1' };
    projects.push(p);
    return p;
  },
);

// Nested routes — explicit http override
// The REST transport merges :projectId from the URL path with query/body fields.

const listTasks = capability(
  z.object({
    projectId: z.string(),
    page:      z.coerce.number().int().positive().default(1),
    status:    z.enum(['todo', 'in_progress', 'done']).optional(),
  }),
  async ({ projectId, page, status }) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) throw errors.NotFound();

    let items = tasks.filter((t) => t.projectId === projectId);
    if (status) items = items.filter((t) => t.status === status);

    const pageSize = 10;
    const start = (page - 1) * pageSize;
    return {
      items: items.slice(start, start + pageSize),
      total: items.length,
      page,
    };
  },
  'query',
  { http: { method: 'GET', path: '/projects/:projectId/tasks' } },
);

const getTask = capability(
  z.object({ projectId: z.string(), id: z.string() }),
  async ({ projectId, id }) => {
    const task = tasks.find((t) => t.projectId === projectId && t.id === id);
    if (!task) throw errors.NotFound();
    return task;
  },
  'query',
  { http: { method: 'GET', path: '/projects/:projectId/tasks/:id' } },
);

const createTask = capability(
  z.object({ projectId: z.string(), title: z.string().min(1) }),
  async ({ projectId, title }) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) throw errors.NotFound();

    const task: Task = { id: `t${Date.now()}`, projectId, title, status: 'todo' };
    tasks.push(task);
    return task;
  },
  'mutation',
  { http: { method: 'POST', path: '/projects/:projectId/tasks' } },
);

const updateTask = capability(
  z.object({
    projectId: z.string(),
    id:        z.string(),
    title:     z.string().min(1).optional(),
    status:    z.enum(['todo', 'in_progress', 'done']).optional(),
  }),
  async ({ projectId, id, title, status }) => {
    const task = tasks.find((t) => t.projectId === projectId && t.id === id);
    if (!task) throw errors.NotFound();
    if (title !== undefined) task.title = title;
    if (status !== undefined) task.status = status;
    return task;
  },
  'update',
  { http: { method: 'PATCH', path: '/projects/:projectId/tasks/:id' } },
);

const deleteTask = capability(
  z.object({ projectId: z.string(), id: z.string() }),
  async ({ projectId, id }) => {
    const idx = tasks.findIndex((t) => t.projectId === projectId && t.id === id);
    if (idx === -1) throw errors.NotFound();
    tasks.splice(idx, 1);
    return null;
  },
  'delete',
  { http: { method: 'DELETE', path: '/projects/:projectId/tasks/:id' } },
);

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

createServer({
  context: buildContext,
  capabilities: {
    projects: { listProjects, getProject, createProject },
    tasks:    { listTasks, getTask, createTask, updateTask, deleteTask },
  },
  transports: [restTransport({ port: 3000 })],
}).start();
