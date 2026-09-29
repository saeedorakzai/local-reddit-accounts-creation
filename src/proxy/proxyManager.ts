import fs from 'node:fs';
import net from 'node:net';
import { readTextFile } from '../utils/files.js';
import type { Logger } from '../logging/logger.js';
import { resolveProjectPath } from '../utils/platform.js';

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ProxyValidationResult {
  ok: boolean;
  host: string;
  port: number;
  latencyMs?: number;
  error?: string;
}

/**
 * Parse proxy details from a local file.
 * Supported formats:
 *   HOST\nPORT\nUSERNAME\nPASSWORD
 *   host: x\nport: y\nusername: z\npassword: w
 *   http://user:pass@host:port
 */
export function parseProxyFile(filePath: string): ProxyConfig {
  const raw = readTextFile(filePath).trim();
  if (!raw) throw new Error(`Proxy file empty: ${filePath}`);

  // URL form
  if (/^https?:\/\//i.test(raw.split(/\r?\n/)[0])) {
    const url = new URL(raw.split(/\r?\n/)[0]);
    return {
      host: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      username: decodeURIComponent(url.username || '') || undefined,
      password: decodeURIComponent(url.password || '') || undefined,
    };
  }

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  // Key:value form
  if (lines.some((l) => /^(host|port|username|password|user|pass)\s*:/i.test(l))) {
    const map: Record<string, string> = {};
    for (const line of lines) {
      const m = /^(host|port|username|password|user|pass)\s*:\s*(.+)$/i.exec(line);
      if (m) map[m[1].toLowerCase()] = m[2].trim();
    }
    const host = map.host;
    const port = Number(map.port);
    if (!host || !Number.isFinite(port)) {
      throw new Error(`Invalid proxy key/value file: ${filePath}`);
    }
    return {
      host,
      port,
      username: map.username || map.user || undefined,
      password: map.password || map.pass || undefined,
    };
  }

  // Plain 4-line form: HOST PORT USERNAME PASSWORD
  if (lines.length >= 2) {
    const host = lines[0];
    const port = Number(lines[1]);
    if (!host || !Number.isFinite(port)) {
      throw new Error(`Invalid proxy HOST/PORT in ${filePath}`);
    }
    return {
      host,
      port,
      username: lines[2] || undefined,
      password: lines[3] || undefined,
    };
  }

  throw new Error(`Unrecognized proxy file format: ${filePath}`);
}

export function proxyFromEnv(env: NodeJS.ProcessEnv = process.env): ProxyConfig | null {
  const host = env.PROXY_HOST || '';
  const port = env.PROXY_PORT ? Number(env.PROXY_PORT) : NaN;
  if (!host || !Number.isFinite(port)) return null;
  return {
    host,
    port,
    username: env.PROXY_USERNAME || undefined,
    password: env.PROXY_PASSWORD || undefined,
  };
}

export function loadProxyConfig(options: {
  enabled: boolean;
  host?: string;
  port?: number | null;
  username?: string;
  password?: string;
  file?: string;
}): ProxyConfig | null {
  if (!options.enabled) return null;

  let proxy: ProxyConfig | null = null;

  if (options.file) {
    const resolved = resolveProjectPath(options.file);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Proxy file not found: ${resolved}`);
    }
    proxy = parseProxyFile(resolved);
  } else if (options.host && options.port) {
    proxy = {
      host: options.host,
      port: options.port,
      username: options.username || undefined,
      password: options.password || undefined,
    };
  } else {
    proxy = proxyFromEnv();
  }

  if (!proxy) {
    throw new Error('Proxy enabled but no PROXY_HOST/PORT or PROXY_FILE configured');
  }

  // Env credentials overlay file values (password often kept only in .env)
  if (options.username) proxy.username = options.username;
  if (options.password) proxy.password = options.password;

  return proxy;
}

export function toPlaywrightProxy(
  proxy: ProxyConfig,
  options?: { bypass?: string },
): {
  server: string;
  username?: string;
  password?: string;
  bypass?: string;
} {
  // Always bypass loopback so local staging (127.0.0.1 / localhost) is not
  // sent through the remote proxy (which returns ACL 403).
  const bypass =
    options?.bypass ||
    'localhost,127.0.0.1,::1,*.local';

  return {
    server: `http://${proxy.host}:${proxy.port}`,
    username: proxy.username,
    password: proxy.password,
    bypass,
  };
}

/** TCP connect check — does not log credentials. */
export async function validateProxy(
  proxy: ProxyConfig,
  options?: { timeoutMs?: number; logger?: Logger },
): Promise<ProxyValidationResult> {
  const timeoutMs = options?.timeoutMs ?? 10000;
  options?.logger?.info(`Validating proxy ${proxy.host}:${proxy.port}`, {
    action: 'validateProxy',
  });

  const start = Date.now();
  return new Promise((resolve) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    let settled = false;

    const finish = (result: ProxyValidationResult) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      if (result.ok) {
        options?.logger?.success(`Proxy reachable ${proxy.host}:${proxy.port}`, {
          action: 'validateProxy',
          durationMs: result.latencyMs,
        });
      } else {
        options?.logger?.error(`Proxy validation failed ${proxy.host}:${proxy.port}`, {
          action: 'validateProxy',
          error: result.error,
        });
      }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      finish({
        ok: true,
        host: proxy.host,
        port: proxy.port,
        latencyMs: Date.now() - start,
      });
    });
    socket.on('timeout', () => {
      finish({
        ok: false,
        host: proxy.host,
        port: proxy.port,
        error: `Timeout after ${timeoutMs}ms`,
      });
    });
    socket.on('error', (err) => {
      finish({
        ok: false,
        host: proxy.host,
        port: proxy.port,
        error: err.message,
      });
    });
  });
}

export class ProxyManager {
  constructor(private readonly logger?: Logger) {}

  load(options: {
    enabled: boolean;
    host?: string;
    port?: number | null;
    username?: string;
    password?: string;
    file?: string;
  }): ProxyConfig | null {
    return loadProxyConfig(options);
  }

  validate(proxy: ProxyConfig, timeoutMs?: number) {
    return validateProxy(proxy, { timeoutMs, logger: this.logger });
  }

  toPlaywright(proxy: ProxyConfig, options?: { bypass?: string }) {
    return toPlaywrightProxy(proxy, options);
  }

  /** Safe log fields — never includes password. */
  safeSummary(proxy: ProxyConfig): { host: string; port: number; hasAuth: boolean } {
    return {
      host: proxy.host,
      port: proxy.port,
      hasAuth: Boolean(proxy.username),
    };
  }
}
