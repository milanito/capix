import pino from 'pino';
import { defineEnhancer, isFrameworkError } from 'capix';
import type { Enhancer, AnyCapability } from 'capix';

export type LoggingOptions = {
  /** Pino logger instance. If not provided, one is created with the given level. */
  readonly logger?: pino.Logger;
  /** Log level (default: 'info') */
  readonly level?: pino.LevelWithSilent;
  /** Log the input object (default: false — avoid logging sensitive data) */
  readonly logInput?: boolean;
  /** Log the output object (default: false) */
  readonly logOutput?: boolean;
};

/**
 * Creates a logging enhancer using pino.
 *
 * @example
 * const getUser = capability(schema, resolver).enhance(loggingEnhancer());
 *
 * // Or apply to all capabilities:
 * const server = createServer({
 *   capabilities: Object.fromEntries(
 *     [...registry].map(([k, cap]) => [k, cap.enhance(loggingEnhancer())])
 *   ),
 * });
 */
export function loggingEnhancer(options: LoggingOptions = {}): Enhancer {
  const logger = options.logger ?? pino({ level: options.level ?? 'info' });
  const logInput = options.logInput ?? false;
  const logOutput = options.logOutput ?? false;

  return defineEnhancer((cap) => {
    return {
      ...cap,
      resolve: async (input: unknown, ctx: unknown) => {
        const start = Date.now();
        const child = logger.child({ capability: cap.name });

        try {
          const result = await (cap as AnyCapability).resolve(input, ctx);
          const ms = Date.now() - start;

          child.info(
            {
              ms,
              ...(logInput ? { input } : {}),
              ...(logOutput ? { output: result } : {}),
            },
            'ok',
          );

          return result;
        } catch (err) {
          const ms = Date.now() - start;

          if (isFrameworkError(err)) {
            const fe = err;
            child.info({ ms, status: fe.status, error: fe.error }, fe.message);
          } else {
            child.error({ ms, err }, 'unhandled error');
          }

          throw err;
        }
      },
    };
  }) as Enhancer;
}

/**
 * Creates a pino logger with Capix-friendly defaults.
 */
export function createLogger(options: pino.LoggerOptions = {}): pino.Logger {
  return pino({
    level: 'info',
    ...options,
  });
}

export { pino };
