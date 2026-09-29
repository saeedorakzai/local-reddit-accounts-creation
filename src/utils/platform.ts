import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Project root (two levels up from src/utils). */
export function getProjectRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

export type Platform = 'win32' | 'linux' | 'darwin' | 'other';

export function getPlatform(): Platform {
  const p = process.platform;
  if (p === 'win32' || p === 'linux' || p === 'darwin') return p;
  return 'other';
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isLinux(): boolean {
  return process.platform === 'linux';
}

/**
 * Resolve a path: absolute paths stay absolute;
 * relative paths are resolved against the project root.
 */
export function resolveProjectPath(...segments: string[]): string {
  const joined = path.join(...segments);
  if (path.isAbsolute(joined)) return joined;
  return path.join(getProjectRoot(), joined);
}

export function ensureDir(dirPath: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/** Common Firefox executable candidates per platform. */
export function getFirefoxCandidates(): string[] {
  const platform = getPlatform();
  const home = os.homedir();

  if (platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      path.join(programFiles, 'Mozilla Firefox', 'firefox.exe'),
      path.join(programFilesX86, 'Mozilla Firefox', 'firefox.exe'),
      path.join(localAppData, 'Mozilla Firefox', 'firefox.exe'),
    ];
  }

  if (platform === 'darwin') {
    return [
      '/Applications/Firefox.app/Contents/MacOS/firefox',
      path.join(home, 'Applications', 'Firefox.app', 'Contents', 'MacOS', 'firefox'),
    ];
  }

  // linux / other
  return [
    '/usr/bin/firefox',
    '/usr/local/bin/firefox',
    '/snap/bin/firefox',
    path.join(home, '.local', 'bin', 'firefox'),
    '/usr/lib/firefox/firefox',
    '/opt/firefox/firefox',
  ];
}

/**
 * Detect Firefox binary. Honors FIREFOX_PATH / PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH.
 */
export function detectFirefoxExecutable(): string | null {
  const envPath =
    process.env.FIREFOX_PATH ||
    process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH ||
    process.env.FIREFOX_BINARY;

  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  for (const candidate of getFirefoxCandidates()) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore permission errors
    }
  }

  // On PATH
  const whichName = isWindows() ? 'firefox.exe' : 'firefox';
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, whichName);
    try {
      if (fs.existsSync(full)) return full;
    } catch {
      // ignore
    }
  }

  return null;
}

export function getDefaultDirs(overrides?: {
  dataDir?: string;
  logDir?: string;
  screenshotDir?: string;
  profilesDir?: string;
}): {
  dataDir: string;
  logDir: string;
  screenshotDir: string;
  profilesDir: string;
} {
  return {
    dataDir: resolveProjectPath(overrides?.dataDir || 'data'),
    logDir: resolveProjectPath(overrides?.logDir || 'logs'),
    screenshotDir: resolveProjectPath(overrides?.screenshotDir || 'screenshots'),
    profilesDir: resolveProjectPath(overrides?.profilesDir || '.firefox-profiles'),
  };
}
