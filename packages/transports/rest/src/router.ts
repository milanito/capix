/**
 * router.ts — radix-tree router for the REST transport
 * No core dependency except types (CapabilityRegistry, AnyCapability).
 */

import type { CapabilityRegistry, AnyCapability } from 'capix';
import { inferIntent } from 'capix';

export type RouteDefinition = {
  readonly method: string;
  readonly path: string;
  readonly capability: string;
};

export type RouterMatch =
  | { readonly found: true; readonly capability: string; readonly params: Record<string, string> }
  | { readonly found: false; readonly allowedMethods?: string[] };

export type Router = {
  match(method: string, path: string): RouterMatch;
  readonly routes: ReadonlyArray<RouteDefinition>;
};

// ---------------------------------------------------------------------------
// Radix tree node
// ---------------------------------------------------------------------------

type RadixNode = {
  // method → capability name for routes that end at this node
  handlers: Map<string, string>;
  // static children: segment → node
  staticChildren: Map<string, RadixNode>;
  // param child: stores the param name and child node
  paramChild?: { name: string; node: RadixNode };
};

function newNode(): RadixNode {
  return { handlers: new Map(), staticChildren: new Map() };
}

function insertRoute(root: RadixNode, method: string, path: string, capability: string): void {
  const segments = path.split('/').filter((s) => s.length > 0);
  let node = root;

  for (const seg of segments) {
    if (seg.startsWith(':')) {
      const paramName = seg.slice(1);
      if (!node.paramChild) {
        node.paramChild = { name: paramName, node: newNode() };
      } else if (node.paramChild.name !== paramName) {
        // Two routes differ only by param name at the same level
        throw new Error(
          `[capix] Router conflict: param name mismatch at same level ` +
            `(':${node.paramChild.name}' vs ':${paramName}') for capability '${capability}'`,
        );
      }
      node = node.paramChild.node;
    } else {
      if (!node.staticChildren.has(seg)) {
        node.staticChildren.set(seg, newNode());
      }
      node = node.staticChildren.get(seg)!;
    }
  }

  if (node.handlers.has(method)) {
    throw new Error(
      `[capix] Duplicate route: ${method} ${path} (capability: ${capability})`,
    );
  }
  node.handlers.set(method, capability);
}

function matchRoute(
  root: RadixNode,
  method: string,
  segments: string[],
  index: number,
  params: Record<string, string>,
): RouterMatch {
  if (index === segments.length) {
    if (node_hasAnyHandler(root)) {
      const cap = root.handlers.get(method);
      if (cap !== undefined) {
        return { found: true, capability: cap, params };
      }
      return { found: false, allowedMethods: [...root.handlers.keys()] };
    }
    return { found: false };
  }

  const seg = segments[index];
  if (seg === undefined) return { found: false };

  // Static match preferred over param match
  const staticChild = root.staticChildren.get(seg);
  if (staticChild !== undefined) {
    const result = matchRoute(staticChild, method, segments, index + 1, params);
    if (result.found) return result;
    // If static matched path but not method, return that result
    if (!result.found && result.allowedMethods !== undefined) return result;
  }

  // Param match
  if (root.paramChild !== undefined) {
    const decoded = decodeURIComponent(seg);
    const newParams = { ...params, [root.paramChild.name]: decoded };
    return matchRoute(root.paramChild.node, method, segments, index + 1, newParams);
  }

  return { found: false };
}

function node_hasAnyHandler(node: RadixNode): boolean {
  return node.handlers.size > 0;
}

// ---------------------------------------------------------------------------
// compileRouter
// ---------------------------------------------------------------------------

/** Builds a Router from route definitions. Throws on duplicate routes. */
export function compileRouter(routes: RouteDefinition[]): Router {
  const root = newNode();

  for (const route of routes) {
    insertRoute(root, route.method.toUpperCase(), route.path, route.capability);
  }

  return {
    routes,
    match(method: string, rawPath: string): RouterMatch {
      // Strip query string for matching
      const pathOnly = rawPath.split('?')[0] ?? rawPath;
      const segments = pathOnly.split('/').filter((s) => s.length > 0);
      return matchRoute(root, method.toUpperCase(), segments, 0, {});
    },
  };
}

// ---------------------------------------------------------------------------
// generateRoutes
// ---------------------------------------------------------------------------

/**
 * Generates route definitions from a compiled capability registry.
 * Applies HTTP override if cap.http is set; otherwise infers from intent and key name.
 */
export function generateRoutes(registry: CapabilityRegistry): RouteDefinition[] {
  const routes: RouteDefinition[] = [];

  for (const [dotPath, cap] of registry) {
    // HTTP override takes full precedence
    if (cap.http !== undefined) {
      routes.push({ method: cap.http.method, path: cap.http.path, capability: dotPath });
      continue;
    }

    routes.push(...inferRoutes(dotPath, cap));
  }

  return routes;
}

function inferRoutes(dotPath: string, cap: AnyCapability): RouteDefinition[] {
  const segments = dotPath.split('.');
  const key = segments[segments.length - 1] ?? dotPath;

  // Group path = all segments except the last one (the capability key)
  const groupSegments = segments.slice(0, -1);
  const groupPath = '/' + groupSegments.join('/');

  // Use cap.intent when the user set it explicitly; otherwise infer from key name
  const intent = cap._intentExplicit ? cap.intent : inferIntent(key);
  const hasIdField = cap.inputSchema
    ? 'shape' in cap.inputSchema &&
      typeof cap.inputSchema.shape === 'object' &&
      cap.inputSchema.shape !== null &&
      'id' in (cap.inputSchema.shape as object)
    : false;

  switch (intent) {
    case 'query':
      if (hasIdField) {
        // get* with id → GET /group/:id
        return [{ method: 'GET', path: groupPath + '/:id', capability: dotPath }];
      }
      // Standard collection prefixes (list*, get*, find*, etc.) → GET /group
      if (/^(list|get|find|fetch|read|search|filter|all)/i.test(key)) {
        return [{ method: 'GET', path: groupPath || '/', capability: dotPath }];
      }
      // Named query (me, status, health, etc.) → GET /group/key
      {
        const namedPath = groupSegments.length > 0 ? '/' + [...groupSegments, key].join('/') : '/' + key;
        return [{ method: 'GET', path: namedPath, capability: dotPath }];
      }

    case 'mutation': {
      // create* → POST /group (drop capability key from path)
      const isCreate = /^(create|add|register|new)/i.test(key);
      if (isCreate) {
        return [{ method: 'POST', path: groupPath || '/', capability: dotPath }];
      }
      // Named action → POST /group/key
      const actionPath = groupSegments.length > 0 ? '/' + [...groupSegments, key].join('/') : '/' + key;
      return [{ method: 'POST', path: actionPath, capability: dotPath }];
    }

    case 'update':
      return [{ method: 'PATCH', path: groupPath + '/:id', capability: dotPath }];

    case 'replace':
      return [{ method: 'PUT', path: groupPath + '/:id', capability: dotPath }];

    case 'delete':
      return [{ method: 'DELETE', path: groupPath + '/:id', capability: dotPath }];
  }
}
