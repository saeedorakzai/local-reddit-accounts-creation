import path from 'node:path';
import { createWriteStream, type WriteStream } from 'node:fs';
import { ensureDir } from '../utils/platform.js';

export type LogLevel = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'DEBUG';

export interface LogContext {
  profile?: string;
  recordId?: string;
  step?: string;
  action?: string;
  status?: string;
  durationMs?: number;
  error?: string;
  retry?: string;
  [key: string]: string | number | undefined;
}

const SENSITIVE_KEYS = /password|passwd|secret|token|credential|api[_-]?key/i;

function redact(value: string): string {
  return value
    .replace(/(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=***')
    .replace(/\/\/([^:]+):([^@]+)@/g, '//$1:***@');
}

function formatTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export class Logger {
  private stream: WriteStream | null = null;
  private logFile: string;

  constructor(logDir: string, name = 'workflow') {
    ensureDir(logDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFile = path.join(logDir, `${name}-${stamp}.log`);
    this.stream = createWriteStream(this.logFile, { flags: 'a' });
  }

  get filePath(): string {
    return this.logFile;
  }

  private write(level: LogLevel, message: string, ctx: LogContext = {}): void {
    const parts: string[] = [`[${formatTimestamp()}]`, `[${level}]`];
    if (ctx.profile) parts.push(`[${ctx.profile}]`);
    if (ctx.recordId) parts.push(`[${ctx.recordId}]`);
    if (ctx.step) parts.push(`[${ctx.step}]`);
    if (ctx.action) parts.push(ctx.action);
    else parts.push(redact(message));

    if (ctx.status) parts.push(ctx.status);
    if (ctx.retry) parts.push(`(${ctx.retry})`);
    if (ctx.durationMs !== undefined) parts.push(`(${ctx.durationMs}ms)`);
    if (ctx.error) parts.push(`error=${redact(String(ctx.error))}`);

    // Fallback when only message provided
    if (!ctx.action && message && !parts.includes(redact(message))) {
      // already pushed
    } else if (ctx.action && message) {
      parts.push(redact(message));
    }

    const line = parts.filter(Boolean).join(' ');
    // eslint-disable-next-line no-console
    console.log(line);
    this.stream?.write(line + '\n');
  }

  info(message: string, ctx?: LogContext): void {
    this.write('INFO', message, ctx);
  }

  success(message: string, ctx?: LogContext): void {
    this.write('SUCCESS', message, { ...ctx, status: ctx?.status || 'SUCCESS' });
  }

  warning(message: string, ctx?: LogContext): void {
    this.write('WARNING', message, ctx);
  }

  error(message: string, ctx?: LogContext): void {
    this.write('ERROR', message, ctx);
  }

  debug(message: string, ctx?: LogContext): void {
    if (process.env.DEBUG === '1' || process.env.LOG_LEVEL === 'DEBUG') {
      this.write('DEBUG', message, ctx);
    }
  }

  /** Log a structured workflow action without leaking sensitive fields. */
  action(
    level: LogLevel,
    message: string,
    ctx: LogContext & Record<string, unknown> = {},
  ): void {
    const safe: LogContext = {};
    for (const [k, v] of Object.entries(ctx)) {
      if (v === undefined || v === null) continue;
      if (SENSITIVE_KEYS.test(k)) {
        safe[k] = '***';
      } else {
        safe[k] = typeof v === 'string' || typeof v === 'number' ? v : String(v);
      }
    }
    this.write(level, message, safe);
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}

let defaultLogger: Logger | null = null;

export function getLogger(logDir?: string): Logger {
  if (!defaultLogger) {
    defaultLogger = new Logger(logDir || path.join(process.cwd(), 'logs'));
  }
  return defaultLogger;
}

export function setLogger(logger: Logger): void {
  defaultLogger = logger;
}
