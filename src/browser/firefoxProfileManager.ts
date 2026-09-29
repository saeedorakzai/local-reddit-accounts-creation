import fs from 'node:fs';
import path from 'node:path';
import { chromium, firefox, type Browser, type BrowserContext, type Page } from 'playwright';
import type { AppConfig } from '../config/config.js';
import { Logger } from '../logging/logger.js';
import { readJsonFile, writeJsonFile } from '../utils/files.js';
import { ensureDir, detectFirefoxExecutable } from '../utils/platform.js';

export interface ProfileMeta {
  name: string;
  dir: string;
  createdAt: string;
  renamedFrom?: string;
  accountId?: string;
  proxyHost?: string;
  lastUsedAt?: string;
}

export interface ProfilesState {
  profiles: Record<string, ProfileMeta>;
  nextIndex: number;
}

export interface LaunchedProfile {
  name: string;
  browser: Browser;
  context: BrowserContext;
  page: Page; // mutable — may switch after popups/tabs
  profileDir: string;
}

function emptyState(): ProfilesState {
  return { profiles: {}, nextIndex: 1 };
}

export class FirefoxProfileManager {
  private readonly profilesRoot: string;
  private readonly metaPath: string;
  private readonly logger: Logger;
  private readonly active = new Map<string, LaunchedProfile>();
  private readonly executablePath: string | null;

  constructor(
    profilesRoot: string,
    logger: Logger,
    options?: { executablePath?: string | null },
  ) {
    this.profilesRoot = profilesRoot;
    this.metaPath = path.join(profilesRoot, 'profiles.json');
    this.logger = logger;
    // Prefer Playwright-bundled Firefox. Only override when explicitly configured —
    // system Firefox (esp. Snap) often fails with launchPersistentContext.
    this.executablePath =
      options?.executablePath ??
      process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH ??
      process.env.FIREFOX_PATH ??
      null;
    ensureDir(profilesRoot);
  }

  private loadState(): ProfilesState {
    return readJsonFile<ProfilesState>(this.metaPath, emptyState());
  }

  private saveState(state: ProfilesState): void {
    writeJsonFile(this.metaPath, state);
  }

  profileExists(profileName: string): boolean {
    const state = this.loadState();
    if (!state.profiles[profileName]) return false;
    return fs.existsSync(state.profiles[profileName].dir);
  }

  listProfiles(): ProfileMeta[] {
    return Object.values(this.loadState().profiles);
  }

  nextSequentialName(prefix = 'profile-'): string {
    const state = this.loadState();
    let idx = state.nextIndex;
    let name = `${prefix}${String(idx).padStart(3, '0')}`;
    while (state.profiles[name] || fs.existsSync(path.join(this.profilesRoot, name))) {
      idx += 1;
      name = `${prefix}${String(idx).padStart(3, '0')}`;
    }
    return name;
  }

  createProfile(profileName: string): ProfileMeta {
    if (!profileName || /[<>:"/\\|?*\x00-\x1f]/.test(profileName)) {
      throw new Error(`Invalid profile name: ${profileName}`);
    }
    if (this.profileExists(profileName)) {
      throw new Error(`Profile already exists: ${profileName}`);
    }

    const dir = path.join(this.profilesRoot, profileName);
    ensureDir(dir);

    // Marker so we never confuse directories
    fs.writeFileSync(
      path.join(dir, 'creation-flow.profile'),
      JSON.stringify({ name: profileName, createdAt: new Date().toISOString() }, null, 2),
      'utf8',
    );

    const meta: ProfileMeta = {
      name: profileName,
      dir,
      createdAt: new Date().toISOString(),
    };

    const state = this.loadState();
    state.profiles[profileName] = meta;

    const match = /^profile-(\d+)$/i.exec(profileName);
    if (match) {
      const n = Number(match[1]);
      if (n >= state.nextIndex) state.nextIndex = n + 1;
    }

    this.saveState(state);
    this.logger.info(`Created profile ${profileName}`, {
      profile: profileName,
      action: 'createProfile',
      status: 'SUCCESS',
    });
    return meta;
  }

  async launchProfile(
    profileName: string,
    options?: {
      headless?: boolean;
      slowMo?: number;
      proxy?: {
        server: string;
        username?: string;
        password?: string;
        bypass?: string;
      };
      timeout?: number;
    },
  ): Promise<LaunchedProfile> {
    if (this.active.has(profileName)) {
      throw new Error(`Profile already launched by this process: ${profileName}`);
    }
    if (!this.profileExists(profileName)) {
      throw new Error(`Profile does not exist: ${profileName}`);
    }

    const state = this.loadState();
    const meta = state.profiles[profileName];
    const headless = options?.headless ?? false;

    this.logger.info(`Launching profile ${profileName}${headless ? ' (headless)' : ' (visible window)'}`, {
      profile: profileName,
      action: 'launchProfile',
    });

    // Use persistent context for true profile isolation
    const launchOptions: Parameters<typeof firefox.launchPersistentContext>[1] = {
      headless,
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
      slowMo: options?.slowMo && options.slowMo > 0 ? options.slowMo : undefined,
    };

    if (this.executablePath) {
      launchOptions.executablePath = this.executablePath;
    }

    if (options?.proxy) {
      launchOptions.proxy = {
        server: options.proxy.server,
        username: options.proxy.username,
        password: options.proxy.password,
        bypass: options.proxy.bypass,
      };
      meta.proxyHost = options.proxy.server;
    }

    let context: BrowserContext;
    try {
      context = await firefox.launchPersistentContext(meta.dir, launchOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Target page, context or browser has been closed|already in use|profile is already in use/i.test(message)) {
        throw new Error(
          `Firefox profile appears locked or already open: ${profileName}. Close other Firefox instances using this profile and retry. (${message})`,
        );
      }
      throw new Error(`Failed to launch Firefox profile ${profileName}: ${message}`);
    }

    const pages = context.pages();
    const page = pages[0] || (await context.newPage());
    const browser = context.browser();
    if (!browser) {
      await context.close();
      throw new Error('Failed to obtain browser instance from persistent context');
    }

    meta.lastUsedAt = new Date().toISOString();
    state.profiles[profileName] = meta;
    this.saveState(state);

    const launched: LaunchedProfile = {
      name: profileName,
      browser,
      context,
      page,
      profileDir: meta.dir,
    };
    this.active.set(profileName, launched);

    this.logger.success(`Launched profile ${profileName}`, {
      profile: profileName,
      action: 'launchProfile',
    });
    return launched;
  }

  async closeProfile(profileName: string): Promise<void> {
    const launched = this.active.get(profileName);
    if (!launched) {
      this.logger.warning(`No active browser for profile ${profileName}`, {
        profile: profileName,
        action: 'closeProfile',
      });
      return;
    }

    try {
      await launched.context.close();
    } catch (err) {
      this.logger.warning(
        `Error closing profile ${profileName}: ${err instanceof Error ? err.message : String(err)}`,
        { profile: profileName, action: 'closeProfile' },
      );
    } finally {
      this.active.delete(profileName);
    }

    this.logger.success(`Closed profile ${profileName}`, {
      profile: profileName,
      action: 'closeProfile',
    });
  }

  renameProfile(profileName: string, newName: string): ProfileMeta {
    if (this.active.has(profileName)) {
      throw new Error(`Cannot rename active profile ${profileName}; close it first`);
    }
    if (!this.profileExists(profileName)) {
      throw new Error(`Profile does not exist: ${profileName}`);
    }
    if (this.profileExists(newName)) {
      throw new Error(`Target profile name already exists: ${newName}`);
    }
    if (!newName || /[<>:"/\\|?*\x00-\x1f]/.test(newName)) {
      throw new Error(`Invalid new profile name: ${newName}`);
    }

    const state = this.loadState();
    const meta = state.profiles[profileName];
    const newDir = path.join(this.profilesRoot, newName);

    fs.renameSync(meta.dir, newDir);

    const updated: ProfileMeta = {
      ...meta,
      name: newName,
      dir: newDir,
      renamedFrom: profileName,
      accountId: newName,
    };

    delete state.profiles[profileName];
    state.profiles[newName] = updated;
    this.saveState(state);

    const marker = path.join(newDir, 'creation-flow.profile');
    if (fs.existsSync(marker)) {
      try {
        const m = JSON.parse(fs.readFileSync(marker, 'utf8')) as Record<string, unknown>;
        m.name = newName;
        m.renamedFrom = profileName;
        fs.writeFileSync(marker, JSON.stringify(m, null, 2), 'utf8');
      } catch {
        // ignore marker update failures
      }
    }

    this.logger.success(`Renamed profile ${profileName} -> ${newName}`, {
      profile: newName,
      action: 'renameProfile',
    });
    return updated;
  }

  getActive(profileName: string): LaunchedProfile | undefined {
    return this.active.get(profileName);
  }

  async closeAll(): Promise<void> {
    const names = [...this.active.keys()];
    for (const name of names) {
      await this.closeProfile(name);
    }
  }

  /** Verify Firefox can be found (system or Playwright-bundled). */
  static detectFirefox(): string | null {
    return detectFirefoxExecutable();
  }

  /** Smoke-check that Playwright can launch Firefox (may use bundled binary). */
  static async canLaunchFirefox(headless = true): Promise<boolean> {
    try {
      const browser = await firefox.launch({ headless });
      await browser.close();
      return true;
    } catch {
      try {
        // Fallback probe
        const browser = await chromium.launch({ headless });
        await browser.close();
        return false;
      } catch {
        return false;
      }
    }
  }
}

export function createProfileManager(
  config: AppConfig,
  logger: Logger,
): FirefoxProfileManager {
  return new FirefoxProfileManager(config.profilesDir, logger, {
    executablePath: config.firefoxExecutable,
  });
}
