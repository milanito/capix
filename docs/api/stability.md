# API stability

This page defines what "public API" means for Capix and what compatibility you can rely on at each release stage. It is the contract the beta and 1.0 releases are held to.

## Stability tiers

**Public API.** Everything exported from a package's entry point *and documented* in this site's guides or API reference: `capability`, `createServer`, `defineContext` / `defineGuard` / `defineError`, enhancers, `compileRegistry`, `resolveIntent`, transport factories (`restTransport`, `wsTransport`, `graphqlTransport`, `queueTransport`, `mcpTransport`), plugin factories, `generateOpenAPI`, the CLI commands, and the wire contracts below. Covered by the semver policy.

**Extension-author API.** The surface needed to build custom transports, enhancers, and plugins:

- `Transport` / `TransportWithCapabilities` (including the `_capabilities` field transport factories set), `MountOptions`, `InvokeFn`, `CapabilityRequest`, `CapabilityResponse`, `SerializedError`
- The enhancer contract: an enhancer receives a capability and returns `{ ...cap, resolve: wrappedFn }`, where `wrappedFn` calls `cap._resolverOnly` so guards do not run twice
- `CapabilityRegistry` and the readable capability fields: `name`, `inputSchema`, `outputSchema`, `guards`, `intent` (prefer `resolveIntent(cap, key)` — it applies key-name inference)

Also covered by the semver policy, but changes here are announced explicitly in the changelog since they affect ecosystem packages rather than applications.

**Internal.** Anything marked `@internal` in the type definitions — `_capix`, the phantom `_input` / `_output` / `_context` type fields (use `InferInput` / `InferOutput` / `InferContext` instead), `_intentExplicit` (use `resolveIntent`), `_skipValidation` — plus Zod schema internals Capix reads (`_zod.def`) and any unexported module. These can change in **any** release without notice. If you find yourself needing one, open an issue: that's a missing public API.

## Wire contracts

These are public API — clients depend on them:

- REST success envelope: `{ "data": ... }`
- Error shape on every transport: `{ "error": string, "message": string, "meta"?: object }` (REST/GraphQL extensions/MCP tool errors all derive from it)
- REST route inference rules (intent → method/path), `urlCase`, and `overrides`
- GraphQL field naming (`users.getUser` → `users_getUser`) and Query/Mutation placement by effective intent
- MCP tool naming, annotations, and `structuredContent` behavior

## Semver policy by stage

| Stage | Version range | Breaking changes |
|---|---|---|
| Alpha | `0.1.0-alpha.*` | May land in any release, noted in the changelog |
| Beta | `0.1.0-beta.*` | Only with a *Breaking* changelog section and a migration note; wire contracts do not change |
| Stable | `>=1.0.0` | Major versions only; deprecations live for at least one minor before removal |

All `@capixjs/*` packages are versioned in lockstep — mixing versions across packages is unsupported.

## Zod

Capix requires `zod@^4` and reads schema internals via Zod's documented library-author surface (`schema._zod.def`, `z.toJSONSchema`). A future Zod major is a breaking change for Capix and will be handled as one.
