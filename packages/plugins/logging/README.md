# @capixjs/plugin-logging

Structured request logging plugin for Capix using [pino](https://github.com/pinojs/pino).

## Install

```bash
npm install @capixjs/plugin-logging
```

## Usage

`loggingEnhancer()` is an `Enhancer` — it attaches to individual capabilities via `.enhance()`, the same as `withCache`/`withRetry`/etc. from `@capixjs/core`. It is not a `definePlugin()`-style plugin and does not go in `createServer({ plugins: [...] })`: there's no single "every request passes through here" hook to attach it to at that level.

```ts
import { loggingEnhancer } from '@capixjs/plugin-logging';

const getUser = capability(schema, resolver).enhance(loggingEnhancer());
```

Apply it to every capability in a registry at once:

```ts
const logged = Object.fromEntries(
  [...registry].map(([name, cap]) => [name, cap.enhance(loggingEnhancer())]),
);
```

A successful call logs (at `level: 'info'`, message `'ok'`):

```json
{ "level": 30, "time": 1716624000000, "capability": "users.getUser", "ms": 4, "msg": "ok" }
```

A thrown typed error (`defineError`) also logs at `level: 'info'` — not `error` — since it's an expected outcome, with the error's own status/code and message:

```json
{ "level": 30, "capability": "users.getUser", "ms": 2, "status": 404, "error": "NotFound", "msg": "Not found" }
```

An unexpected (non-`defineError`) throw logs at `level: 'error'`, message `'unhandled error'`, with the raw error attached under `err`.

## Options

```ts
loggingEnhancer({
  // pino log level, used only when no `logger` is provided (default: 'info')
  level: 'debug',

  // Include the validated input on successful-call log lines (default: false —
  // avoid logging sensitive data unless you mean to; not included on error lines)
  logInput: true,

  // Include the resolver's return value on successful-call log lines (default: false)
  logOutput: true,

  // Bring your own pino instance instead of `level` — takes precedence
  logger: myPinoInstance,
})
```

There is no `transport` or `base` option on `loggingEnhancer()` itself — build those into the pino instance you pass as `logger` instead, using `createLogger()` (a thin wrapper around `pino()`) or `pino()` directly:

```ts
import { createLogger, loggingEnhancer } from '@capixjs/plugin-logging';

const logger = createLogger({
  transport: { target: 'pino-pretty', options: { colorize: true } },
  base: { service: 'my-api', version: '1.2.0' },
});

const getUser = capability(schema, resolver).enhance(loggingEnhancer({ logger }));
```

## Development pretty-printing

```bash
npm install --save-dev pino-pretty
```

```ts
const logger = createLogger({ transport: { target: 'pino-pretty', options: { colorize: true } } });
```

## License

MIT
