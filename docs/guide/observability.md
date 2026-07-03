# Observability

Capix has three observation layers, from broadest to most targeted:

| Layer | Scope | Use for |
|---|---|---|
| `hooks` on `createServer` | every capability call on every transport | tracing, APM, error reporting |
| `withMetrics` / `loggingEnhancer` | individual capabilities | per-capability metrics and logs |
| `ctx` fields | inside resolvers | app-level structured logging |

## Lifecycle hooks

`ServerConfig.hooks` observes every invocation — REST, WebSocket, GraphQL, queue, and MCP calls all pass through the same execution engine:

```ts
createServer({
  context: buildContext,
  capabilities,
  transports,
  hooks: {
    onRequest:  (req) => { /* request entered the engine */ },
    onResponse: (req, { durationMs, data }) => { /* resolved OK */ },
    onError:    (req, { durationMs, error }) => {
      // any failure: unknown capability, guard rejection, validation, resolver throw
      console.error(`${req.capability} failed: ${error.error} (${error.status}) after ${durationMs}ms`);
    },
  },
});
```

Hooks never affect the request: errors thrown inside a hook are caught and logged. The same `req` object is passed to `onRequest` and to the completion hook, so a `WeakMap` keyed on it correlates the two — that is the tracing integration point.

## OpenTelemetry

```ts
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import type { CapabilityRequest } from '@capixjs/core';

const tracer = trace.getTracer('capix');
const spans = new WeakMap<CapabilityRequest, Span>();

createServer({
  // ...
  hooks: {
    onRequest(req) {
      spans.set(req, tracer.startSpan(`capability ${req.capability}`, {
        attributes: { 'capix.capability': req.capability },
      }));
    },
    onResponse(req) {
      spans.get(req)?.end();
    },
    onError(req, { error }) {
      const span = spans.get(req);
      if (span) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        span.setAttributes({ 'capix.error': error.error, 'http.status_code': error.status });
        span.end();
      }
    },
  },
});
```

## Error reporting (Sentry and friends)

`onError` fires for every failed invocation with the serialized error. Report only unexpected failures — 4xx statuses are the framework doing its job:

```ts
hooks: {
  onError(req, { error }) {
    if (error.status >= 500) {
      Sentry.captureMessage(`${req.capability}: ${error.message}`, {
        extra: { capability: req.capability, code: error.error },
      });
    }
  },
},
```

## Per-capability metrics

For capability-scoped instrumentation, `withMetrics` plugs into any StatsD/Prometheus-style collector:

```ts
import { withMetrics } from '@capixjs/core';

const collector = {
  increment: (name, tags) => statsd.increment(name, tags),
  histogram: (name, value, tags) => statsd.histogram(name, value, tags),
};

const getUser = capability(schema, resolver).enhance(withMetrics(collector));
// emits capability.duration, capability.success, capability.error
```

And [`@capixjs/plugin-logging`](../api/index.md) provides a pino-based enhancer with input/output redaction defaults.
