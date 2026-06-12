/**
 * router.ts — radix-tree router for the REST transport
 * No core dependency except types (CapabilityRegistry, AnyCapability).
 */

import type { CapabilityRegistry, AnyCapability } from '@capixjs/core';
import { inferIntent } from '@capixjs/core';

export type RouteDefinition = {
  readonly method: string;
  readonly path: string;
  readonly capability: string;
};

export type RouterMatch =
  | { readonly found: true; readonly capability: string; readonly params: Record<string, string> | null }
  | { readonly found: false; readonly allowedMethods?: string[]; readonly malformed?: boolean };

export type Router = {
  match(method: string, path: string): RouterMatch;
  readonly routes: ReadonlyArray<RouteDefinition>;
};

export type HttpOverride = {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  readonly path: string;
};

export type GenerateRoutesOptions = {
  /** Case style for URL path segments. Default: 'kebab' (bulkStatus → bulk-status). */
  urlCase?: 'kebab' | 'camel' | 'snake';
  /** Per-capability HTTP route overrides keyed by dot-path. Takes full precedence over URL inference. */
  overrides?: Record<string, HttpOverride>;
};

// ---------------------------------------------------------------------------
// Radix tree node
// ---------------------------------------------------------------------------

type RadixNode = {
  // method → capability name for routes that end at this node
  handlers: Map<string, string>;
  // static children: segment → node
  staticChildren: Map<string, RadixNode>;
  // param child: stores the param name per method and the child node
  paramChild?: {
    node: RadixNode;
    /** method → param name for that method. Different HTTP methods may use different param names. */
    methodNames: Map<string, string>;
  };
};

function newNode(): RadixNode {
  return { handlers: new Map(), staticChildren: new Map() };
}

/**
 * decodeURIComponent that returns null instead of throwing on malformed
 * percent-encoding ('%zz', truncated '%E0%A4', overlong sequences).
 * A throwing decode here would escape the transport's synchronous request
 * path and crash the process.
 */
function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Splits a URL path into segments in a single pass (no intermediate array from filter). */
function splitPath(path: string): string[] {
  const segments: string[] = [];
  let start = path.charCodeAt(0) === 47 ? 1 : 0; // skip leading /
  for (let i = start; i <= path.length; i++) {
    if (i === path.length || path.charCodeAt(i) === 47) { // 47 = '/'
      if (i > start) segments.push(path.slice(start, i));
      start = i + 1;
    }
  }
  return segments;
}

function insertRoute(root: RadixNode, method: string, path: string, capability: string): void {
  const segments = splitPath(path);
  // method is already uppercase — compileRouter calls toUpperCase() before insertRoute
  const upperMethod = method;
  let node = root;

  for (const seg of segments) {
    if (seg.startsWith(':')) {
      const paramName = seg.slice(1);
      if (!node.paramChild) {
        node.paramChild = { node: newNode(), methodNames: new Map([[upperMethod, paramName]]) };
      } else {
        // Allow different param names per method — only error on same method with conflicting names
        const existing = node.paramChild.methodNames.get(upperMethod);
        if (existing !== undefined && existing !== paramName) {
          throw new Error(
            `[capix] Router conflict: param name mismatch for ${upperMethod} at same level ` +
              `(':${existing}' vs ':${paramName}') for capability '${capability}'`,
          );
        }
        node.paramChild.methodNames.set(upperMethod, paramName);
      }
      node = node.paramChild.node;
    } else {
      if (!node.staticChildren.has(seg)) {
        node.staticChildren.set(seg, newNode());
      }
      node = node.staticChildren.get(seg)!;
    }
  }

  if (node.handlers.has(upperMethod)) {
    throw new Error(
      `[capix] Duplicate route: ${upperMethod} ${path} (capability: ${capability})`,
    );
  }
  node.handlers.set(upperMethod, capability);
}

function matchRoute(
  root: RadixNode,
  method: string,
  segments: string[],
  index: number,
  params: Record<string, string> | null,
): RouterMatch {
  if (index === segments.length) {
    if (node_hasAnyHandler(root)) {
      const cap = root.handlers.get(method);
      if (cap !== undefined) {
        // null params means no path params were encountered — skip allocation.
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
    // If static matched path but not method (or a deeper segment was undecodable), return that result
    if (!result.found && (result.allowedMethods !== undefined || result.malformed === true)) return result;
  }

  // Param match — look up the param name for the current method
  if (root.paramChild !== undefined) {
    // Conditional decode: skip when there are no percent-encoded chars
    const decoded = seg.includes('%') ? safeDecode(seg) : seg;
    if (decoded === null) {
      // Undecodable segment can never bind to a param — the URL itself is invalid.
      return { found: false, malformed: true };
    }
    const paramName =
      root.paramChild.methodNames.get(method) ??
      root.paramChild.methodNames.values().next().value ??
      'id';
    // Lazily allocate params object (only when first param encountered).
    // Mutate in place and restore on backtrack.
    const actualParams = params ?? {};
    const prev = actualParams[paramName];
    actualParams[paramName] = decoded;
    const result = matchRoute(root.paramChild.node, method, segments, index + 1, actualParams);
    if (!result.found) {
      if (prev === undefined) delete actualParams[paramName];
      else actualParams[paramName] = prev;
    }
    return result;
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
    // Callers must pass method in uppercase — transport guarantees this via req.method.
    match(method: string, rawPath: string): RouterMatch {
      // Strip query string without creating an intermediate array.
      const qIdx = rawPath.indexOf('?');
      const pathOnly = qIdx !== -1 ? rawPath.slice(0, qIdx) : rawPath;
      const segments = splitPath(pathOnly);
      // Start with null params; allocate only if a route param is matched.
      return matchRoute(root, method, segments, 0, null);
    },
  };
}

// ---------------------------------------------------------------------------
// URL case conversion
// ---------------------------------------------------------------------------

function toKebabCase(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function toSnakeCase(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

function applyUrlCase(s: string, urlCase: 'kebab' | 'camel' | 'snake'): string {
  switch (urlCase) {
    case 'kebab': return toKebabCase(s);
    case 'snake': return toSnakeCase(s);
    case 'camel': return s;
  }
}

// ---------------------------------------------------------------------------
// generateRoutes
// ---------------------------------------------------------------------------

/**
 * Generates route definitions from a compiled capability registry.
 * Transport-level overrides take full precedence over URL inference.
 */
export function generateRoutes(
  registry: CapabilityRegistry,
  options: GenerateRoutesOptions = {},
): RouteDefinition[] {
  const urlCase = options.urlCase ?? 'kebab';
  const overrides = options.overrides ?? {};
  const routes: RouteDefinition[] = [];

  for (const key of Object.keys(overrides)) {
    if (!registry.has(key)) {
      console.warn(`[capix] REST transport: override for '${key}' does not match any registered capability.`);
    }
  }

  for (const [dotPath, cap] of registry) {
    const override = overrides[dotPath];
    if (override !== undefined) {
      routes.push({ method: override.method, path: override.path, capability: dotPath });
      continue;
    }
    routes.push(...inferRoutes(dotPath, cap, urlCase));
  }

  return routes;
}

function inferRoutes(
  dotPath: string,
  cap: AnyCapability,
  urlCase: 'kebab' | 'camel' | 'snake',
): RouteDefinition[] {
  const segments = dotPath.split('.');
  const key = segments[segments.length - 1] ?? dotPath;

  // Group path = all segments except the last one, with case conversion applied
  const groupSegments = segments.slice(0, -1).map((s) => applyUrlCase(s, urlCase));
  const groupPath = '/' + groupSegments.join('/');

  // Use cap.intent when the user set it explicitly; otherwise infer from key name
  const intent = cap._intentExplicit ? cap.intent : inferIntent(key);
  const hasIdField = cap.inputSchema
    ? 'shape' in cap.inputSchema &&
      typeof cap.inputSchema.shape === 'object' &&
      cap.inputSchema.shape !== null &&
      'id' in (cap.inputSchema.shape as object)
    : false;

  // Key after case conversion (used when key appears in the URL)
  const urlKey = applyUrlCase(key, urlCase);

  switch (intent) {
    case 'query':
      if (hasIdField) {
        // get* with id → GET /group/:id
        return [{ method: 'GET', path: groupPath + '/:id', capability: dotPath }];
      }
      // list*, find*, fetch*, read*, search*, filter*, all* → always collection → GET /group
      if (/^(list|find|fetch|read|search|filter|all)/i.test(key)) {
        return [{ method: 'GET', path: groupPath || '/', capability: dotPath }];
      }
      {
        // get* without id field: collection only when the remainder matches the parent
        // group name. getMe → GET /group/me, getStats → GET /group/stats,
        // getUsers (in users group) → GET /group.
        const getMatch = /^get([A-Z].*)?/.exec(key);
        if (getMatch) {
          const remainder = getMatch[1] ?? '';
          const lastGroup = groupSegments[groupSegments.length - 1] ?? '';
          const rLow = remainder.toLowerCase();
          const gLow = lastGroup.toLowerCase();
          const matchesGroup =
            !remainder ||
            rLow === gLow ||
            rLow === gLow.replace(/s$/, '') ||  // "User" matches "users"
            gLow === rLow.replace(/s$/, '');     // "Users" matches "user"

          if (matchesGroup) {
            return [{ method: 'GET', path: groupPath || '/', capability: dotPath }];
          }
          // Named: getMe → /group/me, getStats → /group/stats
          const namedKey = applyUrlCase(remainder || key, urlCase);
          const namedPath =
            groupSegments.length > 0
              ? '/' + [...groupSegments, namedKey].join('/')
              : remainder
                ? '/' + namedKey
                : '/' + applyUrlCase(key, urlCase);
          return [{ method: 'GET', path: namedPath, capability: dotPath }];
        }
      }
      // Named query (me, status, health, etc.) — no collection prefix → GET /group/key
      {
        const namedPath = groupSegments.length > 0 ? '/' + [...groupSegments, urlKey].join('/') : '/' + urlKey;
        return [{ method: 'GET', path: namedPath, capability: dotPath }];
      }

    case 'mutation': {
      // create* → POST /group (drop capability key from path)
      // 'register' intentionally excluded — it's a named action (POST /auth/register), not a resource creation
      const isCreate = /^(create|add|new)/i.test(key);
      if (isCreate) {
        return [{ method: 'POST', path: groupPath || '/', capability: dotPath }];
      }
      // un* → DELETE /group/:id/verb (inverse sub-resource action)
      const unMatch = /^un([A-Za-z].*)/.exec(key);
      if (unMatch) {
        const verb = applyUrlCase(unMatch[1]!, urlCase);
        const basePath = groupSegments.length > 0 ? groupPath : '';
        return [{ method: 'DELETE', path: basePath + '/:id/' + verb, capability: dotPath }];
      }
      // Named action → POST /group/key
      const actionPath = groupSegments.length > 0 ? '/' + [...groupSegments, urlKey].join('/') : '/' + urlKey;
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
