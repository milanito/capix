import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { capability, defineError } from '@capixjs/core';
import { loggingEnhancer, createLogger, pino } from './index.js';

type LogLine = {
  level: number;
  msg: string;
  capability?: string;
  ms?: number;
  status?: number;
  error?: string;
  input?: unknown;
  output?: unknown;
};

function collector(): { logger: pino.Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger = pino({ level: 'info' }, { write: (s: string) => void lines.push(JSON.parse(s) as LogLine) });
  return { logger, lines };
}

const NotFound = defineError(404, 'Not found');

describe('loggingEnhancer', () => {
  it('logs success with capability name and duration, and passes the result through', async () => {
    const { logger, lines } = collector();
    const greet = capability(z.object({ name: z.string() }), ({ name }) => `hi ${name}`)
      .enhance(loggingEnhancer({ logger }));

    const result = await greet.resolve({ name: 'Ada' }, { requestId: 't' });

    expect(result).toBe('hi Ada');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'ok', capability: '(unnamed)' });
    expect(typeof lines[0]!.ms).toBe('number');
  });

  it('omits input and output by default, includes them when asked', async () => {
    const { logger, lines } = collector();
    const echo = capability(z.object({ secret: z.string() }), (i) => i)
      .enhance(loggingEnhancer({ logger, logInput: true, logOutput: true }));

    await echo.resolve({ secret: 's3cret' }, { requestId: 't' });
    expect(lines[0]!.input).toEqual({ secret: 's3cret' });
    expect(lines[0]!.output).toEqual({ secret: 's3cret' });

    const { logger: quietLogger, lines: quietLines } = collector();
    const quiet = capability(z.object({ secret: z.string() }), (i) => i)
      .enhance(loggingEnhancer({ logger: quietLogger }));
    await quiet.resolve({ secret: 's3cret' }, { requestId: 't' });
    expect(quietLines[0]).not.toHaveProperty('input');
    expect(quietLines[0]).not.toHaveProperty('output');
  });

  it('logs framework errors at info with status and code, and rethrows', async () => {
    const { logger, lines } = collector();
    const boom = capability(z.object({}), () => {
      throw NotFound();
    }).enhance(loggingEnhancer({ logger }));

    await expect(boom.resolve({}, { requestId: 't' })).rejects.toThrow('Not found');
    expect(lines[0]).toMatchObject({ status: 404, error: 'NotFound', msg: 'Not found' });
    expect(lines[0]!.level).toBe(30); // info
  });

  it('logs unexpected errors at error level, and rethrows', async () => {
    const { logger, lines } = collector();
    const boom = capability(z.object({}), () => {
      throw new Error('db down');
    }).enhance(loggingEnhancer({ logger }));

    await expect(boom.resolve({}, { requestId: 't' })).rejects.toThrow('db down');
    expect(lines[0]!.msg).toBe('unhandled error');
    expect(lines[0]!.level).toBe(50); // error
  });
});

describe('createLogger', () => {
  it('creates a pino logger with info default that accepts overrides', () => {
    expect(createLogger().level).toBe('info');
    expect(createLogger({ level: 'debug' }).level).toBe('debug');
  });
});
