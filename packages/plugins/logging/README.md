# capix-plugin-logging

Structured request logging plugin for Capix using [pino](https://github.com/pinojs/pino).

## Install

```bash
npm install capix-plugin-logging
```

## Usage

```ts
import { createServer } from 'capix';
import { restTransport } from 'capix-transport-rest';
import { loggingPlugin } from 'capix-plugin-logging';

createServer({
  capabilities: { ... },
  plugins: [loggingPlugin()],
  transports: [restTransport({ port: 3000 })],
}).start();
```

Each request logs a structured line:

```json
{
  "level": 30,
  "time": 1716624000000,
  "capability": "users.getUser",
  "durationMs": 4,
  "status": 200
}
```

Errors are logged at `level: 50` (error) with the error message included.

## Options

```ts
loggingPlugin({
  // pino log level (default: 'info')
  level: 'debug',

  // pino transport (e.g., pino-pretty for development)
  transport: { target: 'pino-pretty' },

  // Add extra fields to every log line
  base: { service: 'my-api', version: '1.2.0' },

  // Bring your own pino instance
  logger: myPinoInstance,
})
```

## Development pretty-printing

```bash
npm install --save-dev pino-pretty
```

```ts
loggingPlugin({
  transport: { target: 'pino-pretty', options: { colorize: true } },
})
```

## License

MIT
