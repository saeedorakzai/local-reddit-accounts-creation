import { readLines, writeLines, appendTextFile } from '../utils/files.js';
import { resolveProjectPath } from '../utils/platform.js';

export interface TestUserRecord {
  id: string;
  email: string;
  password: string;
  username?: string;
  preference?: string;
  raw: string;
}

/**
 * Parse test-users.txt lines.
 * Formats:
 *   email,,password
 *   id|email|password|username|preference
 *   email:password
 *   email,password
 */
export function parseUserLine(line: string, index: number): TestUserRecord | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  if (trimmed.includes('|')) {
    const parts = trimmed.split('|').map((p) => p.trim());
    const [id, email, password, username, preference] = parts;
    if (!email || !password) return null;
    return {
      id: id || `user-${index + 1}`,
      email,
      password,
      username: username || undefined,
      preference: preference || 'email',
      raw: trimmed,
    };
  }

  // uuid<TAB>'Email@outlook.com<TAB><TAB>password
  if (trimmed.includes('\t')) {
    const cols = trimmed.split('\t').map((c) => c.trim());
    const emailIdx = cols.findIndex((c) => {
      const cleaned = c.replace(/^['"`]+/, '').replace(/['"`]+$/, '');
      return cleaned.includes('@') && cleaned.includes('.');
    });
    if (emailIdx >= 0) {
      const email = cols[emailIdx]
        .replace(/^['"`]+/, '')
        .replace(/['"`]+$/, '');
      const after = cols
        .slice(emailIdx + 1)
        .filter((c) => c && c !== "''" && c !== '""');
      const password = after[0] || '';
      if (email && password) {
        return {
          id: email.toLowerCase(),
          email,
          password,
          preference: 'email',
          raw: trimmed,
        };
      }
    }
  }

  // uuid,''Email@outlook.com,,password,,,,...
  const uuidPrefixed =
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*,\s*['"]{0,2}([^,'"]+@[^,'"]+)\s*,\s*,\s*([^,]+)/i.exec(
      trimmed,
    );
  if (uuidPrefixed) {
    const email = uuidPrefixed[2].trim();
    const password = uuidPrefixed[3].trim();
    return {
      id: email.toLowerCase(),
      email,
      password,
      preference: 'email',
      raw: trimmed,
    };
  }

  // email,,password (legacy) — or junk,''email,,password
  if (trimmed.includes(',,')) {
    const parts = trimmed.split(',');
    const emailIdx = parts.findIndex((p) => {
      const cleaned = p.trim().replace(/^['"`]+/, '').replace(/['"`]+$/, '');
      return cleaned.includes('@') && cleaned.includes('.');
    });
    if (emailIdx >= 0) {
      const email = parts[emailIdx]
        .trim()
        .replace(/^['"`]+/, '')
        .replace(/['"`]+$/, '');
      const after = parts.slice(emailIdx + 1);
      const passCell = after.find(
        (p) => p.trim() !== '' && p.trim() !== "''" && p.trim() !== '""',
      );
      const password = (passCell || '').trim();
      if (!email || !password) return null;
      return {
        id: email.toLowerCase(),
        email,
        password,
        preference: 'email',
        raw: trimmed,
      };
    }
  }

  // email:password
  if (trimmed.includes(':') && !trimmed.includes(',')) {
    const idx = trimmed.indexOf(':');
    const email = trimmed.slice(0, idx).trim();
    const password = trimmed.slice(idx + 1).trim();
    if (!email || !password) return null;
    return {
      id: email.toLowerCase(),
      email,
      password,
      preference: 'email',
      raw: trimmed,
    };
  }

  // email,password
  const comma = trimmed.split(',').map((p) => p.trim());
  if (comma.length >= 2) {
    const [email, password, username, preference] = comma;
    return {
      id: email.toLowerCase(),
      email,
      password,
      username: username || undefined,
      preference: preference || 'email',
      raw: trimmed,
    };
  }

  return null;
}

export function loadTestUsers(filePath: string): TestUserRecord[] {
  const lines = readLines(resolveProjectPath(filePath));
  const users: TestUserRecord[] = [];
  lines.forEach((line, i) => {
    const u = parseUserLine(line, i);
    if (u) users.push(u);
  });
  return users;
}

export function loadProcessedIds(filePath: string): Set<string> {
  return new Set(readLines(resolveProjectPath(filePath)));
}

export function markUserProcessed(filePath: string, record: TestUserRecord): void {
  const resolved = resolveProjectPath(filePath);
  const existing = loadProcessedIds(resolved);
  const key = record.id;
  if (existing.has(key)) return;
  appendTextFile(resolved, key);
}

export function validateRecord(record: TestUserRecord): void {
  if (!record.email || !record.email.includes('@')) {
    throw new Error(`Invalid email on record ${record.id}`);
  }
  if (!record.password) {
    throw new Error(`Missing password on record ${record.id}`);
  }
}

export function removeUserFromSource(filePath: string, recordId: string): void {
  const resolved = resolveProjectPath(filePath);
  const lines = readLines(resolved);
  const remaining = lines.filter((line, i) => {
    const parsed = parseUserLine(line, i);
    return !parsed || parsed.id !== recordId;
  });
  writeLines(resolved, remaining);
}
