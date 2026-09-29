import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './platform.js';

export function readTextFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

export function writeTextFile(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

export function appendTextFile(filePath: string, line: string): void {
  ensureDir(path.dirname(filePath));
  const normalized = line.endsWith('\n') ? line : `${line}\n`;
  fs.appendFileSync(filePath, normalized, 'utf8');
}

export function readLines(filePath: string): string[] {
  const content = readTextFile(filePath);
  if (!content.trim()) return [];
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

export function writeLines(filePath: string, lines: string[]): void {
  writeTextFile(filePath, lines.join('\n') + (lines.length ? '\n' : ''));
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function removeFile(filePath: string): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

/** Simple exclusive lock using a lock file. Returns unlock function. */
export function acquireFileLock(lockPath: string, staleMs = 30 * 60 * 1000): () => void {
  ensureDir(path.dirname(lockPath));
  if (fs.existsSync(lockPath)) {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs < staleMs) {
      throw new Error(`Lock held: ${lockPath}`);
    }
    fs.unlinkSync(lockPath);
  }
  fs.writeFileSync(lockPath, String(process.pid), 'utf8');
  return () => {
    try {
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  };
}
