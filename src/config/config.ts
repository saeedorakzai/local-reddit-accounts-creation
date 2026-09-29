import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, getProjectRoot, resolveProjectPath } from '../utils/platform.js';

dotenv.config({ path: path.join(getProjectRoot(), '.env') });

export interface AppConfig {
  browser: 'firefox';
  headless: boolean;
  defaultTimeout: number;
  navigationTimeout: number;
  maxRetries: number;
  actionRetryDelay: number;
  testBaseUrl: string;
  emailPollInterval: number;
  emailPollTimeout: number;
  profilePrefix: string;
  proxyEnabled: boolean;
  proxyHost: string;
  proxyPort: number | null;
  proxyUsername: string;
  proxyPassword: string;
  proxyFile: string;
  testUsersFile: string;
  dataDir: string;
  logDir: string;
  screenshotDir: string;
  profilesDir: string;
  batchContinueOnFailure: boolean;
  workflowDelayMs: number;
  slowMoMs: number;
  firefoxExecutable: string | null;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid integer for ${key}: ${v}`);
  return n;
}

function envStr(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(options?: { requireTestUrl?: boolean }): AppConfig {
  const requireTestUrl = options?.requireTestUrl !== false;

  const dataDir = resolveProjectPath(envStr('DATA_DIR', 'data'));
  const logDir = resolveProjectPath(envStr('LOG_DIR', 'logs'));
  const screenshotDir = resolveProjectPath(envStr('SCREENSHOT_DIR', 'screenshots'));
  const profilesDir = resolveProjectPath(envStr('PROFILES_DIR', '.firefox-profiles'));

  const config: AppConfig = {
    browser: 'firefox',
    headless: envBool('HEADLESS', false),
    defaultTimeout: envInt('DEFAULT_TIMEOUT', 30000),
    navigationTimeout: envInt('NAVIGATION_TIMEOUT', 60000),
    maxRetries: envInt('MAX_RETRIES', 3),
    actionRetryDelay: envInt('ACTION_RETRY_DELAY', 1000),
    testBaseUrl: envStr('TEST_BASE_URL', ''),
    emailPollInterval: envInt('EMAIL_POLL_INTERVAL', 5000),
    emailPollTimeout: envInt('EMAIL_POLL_TIMEOUT', 120000),
    profilePrefix: envStr('PROFILE_PREFIX', 'profile-'),
    proxyEnabled: envBool('PROXY_ENABLED', false),
    proxyHost: envStr('PROXY_HOST', ''),
    proxyPort: process.env.PROXY_PORT ? envInt('PROXY_PORT', 0) : null,
    proxyUsername: envStr('PROXY_USERNAME', ''),
    proxyPassword: envStr('PROXY_PASSWORD', ''),
    proxyFile: envStr('PROXY_FILE', ''),
    // Prefer explicit file; falls back to legacy root "email data.txt" if present.
    testUsersFile: envStr('TEST_USERS_FILE', ''),
    dataDir,
    logDir,
    screenshotDir,
    profilesDir,
    batchContinueOnFailure: envBool('BATCH_CONTINUE_ON_FAILURE', true),
    workflowDelayMs: envInt('WORKFLOW_DELAY_MS', 500),
    slowMoMs: envInt('SLOW_MO', 0),
    // Explicit override only — Playwright bundled Firefox is the default launcher.
    firefoxExecutable:
      process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH ||
      process.env.FIREFOX_PATH ||
      null,
  };

  ensureDir(config.dataDir);
  ensureDir(config.logDir);
  ensureDir(config.screenshotDir);
  ensureDir(config.profilesDir);

  validateConfig(config, { requireTestUrl });
  return config;
}

export function validateConfig(
  config: AppConfig,
  options?: { requireTestUrl?: boolean },
): void {
  const errors: string[] = [];

  if (config.browser !== 'firefox') {
    errors.push('BROWSER must be firefox');
  }
  if (config.defaultTimeout <= 0) errors.push('DEFAULT_TIMEOUT must be > 0');
  if (config.navigationTimeout <= 0) errors.push('NAVIGATION_TIMEOUT must be > 0');
  if (config.maxRetries < 0) errors.push('MAX_RETRIES must be >= 0');
  if (config.emailPollInterval <= 0) errors.push('EMAIL_POLL_INTERVAL must be > 0');
  if (config.emailPollTimeout <= 0) errors.push('EMAIL_POLL_TIMEOUT must be > 0');

  if (options?.requireTestUrl !== false && !config.testBaseUrl) {
    errors.push('TEST_BASE_URL is required');
  }

  if (config.proxyEnabled) {
    if (!config.proxyHost && !config.proxyFile) {
      errors.push('PROXY_ENABLED requires PROXY_HOST or PROXY_FILE');
    }
    if (config.proxyHost && (config.proxyPort === null || config.proxyPort <= 0)) {
      errors.push('PROXY_PORT must be a positive number when PROXY_HOST is set');
    }
  }

  if (errors.length) {
    throw new Error(`Configuration invalid:\n- ${errors.join('\n- ')}`);
  }
}

export function pathsFromConfig(config: AppConfig) {
  const defaultUsers = path.join(config.dataDir, 'test-users.txt');
  const legacyEmailData = resolveProjectPath('email data.txt');

  let testUsers = config.testUsersFile
    ? resolveProjectPath(config.testUsersFile)
    : defaultUsers;

  // Auto-use root "email data.txt" when present and no explicit override.
  if (!config.testUsersFile && fs.existsSync(legacyEmailData)) {
    testUsers = legacyEmailData;
  }

  const legacyProxy = resolveProjectPath('proxy details');
  let proxyFile = '';
  if (config.proxyFile) {
    proxyFile = resolveProjectPath(config.proxyFile);
  } else if (fs.existsSync(legacyProxy)) {
    proxyFile = legacyProxy;
  }

  return {
    testUsers,
    processedUsers: path.join(config.dataDir, 'processed-users.txt'),
    processedEmails: path.join(config.dataDir, 'processed-emails.txt'),
    mailbox: path.join(config.dataDir, 'mailbox'),
    state: path.join(config.dataDir, 'state.json'),
    profilesMeta: path.join(config.profilesDir, 'profiles.json'),
    proxyFile,
  };
}
