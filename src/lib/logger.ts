/**
 * Tiny structured logger. One line per message — `LEVEL name message`, plus the
 * JSON detail object when one is passed. `warn` and `error` go to stderr, `info`
 * and `debug` to stdout, so piping stdout to a file never mixes channels.
 * Colour is used only when the receiving stream is a TTY, so CI logs and piped
 * output stay plain.
 */
export interface Logger {
  info(message: string, detail?: Record<string, unknown>): void;
  warn(message: string, detail?: Record<string, unknown>): void;
  error(message: string, detail?: Record<string, unknown>): void;
  debug(message: string, detail?: Record<string, unknown>): void;
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const LEVEL_COLOURS: Record<LogLevel, string> = {
  INFO: '\u001b[36m',
  WARN: '\u001b[33m',
  ERROR: '\u001b[31m',
  DEBUG: '\u001b[90m',
};

const RESET = '\u001b[0m';

export function createLogger(name: string): Logger {
  const emit = (
    level: LogLevel,
    stream: NodeJS.WriteStream,
    message: string,
    detail?: Record<string, unknown>,
  ): void => {
    const label = stream.isTTY ? `${LEVEL_COLOURS[level]}${level}${RESET}` : level;
    const payload = detail === undefined ? '' : ` ${JSON.stringify(detail)}`;
    stream.write(`${label} ${name} ${message}${payload}\n`);
  };

  return {
    info: (message, detail): void => {
      emit('INFO', process.stdout, message, detail);
    },
    warn: (message, detail): void => {
      emit('WARN', process.stderr, message, detail);
    },
    error: (message, detail): void => {
      emit('ERROR', process.stderr, message, detail);
    },
    debug: (message, detail): void => {
      emit('DEBUG', process.stdout, message, detail);
    },
  };
}
