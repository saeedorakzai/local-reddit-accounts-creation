import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FirefoxProfileManager } from '../src/browser/firefoxProfileManager.js';
import { Logger } from '../src/logging/logger.js';
import { detectFirefoxExecutable, getFirefoxCandidates } from '../src/utils/platform.js';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('Firefox detection', () => {
  it('returns candidates for current platform', () => {
    const candidates = getFirefoxCandidates();
    assert.ok(candidates.length > 0);
  });

  it('detectFirefoxExecutable returns string or null', () => {
    const exe = detectFirefoxExecutable();
    assert.ok(exe === null || typeof exe === 'string');
  });
});

describe('Firefox profile manager', () => {
  it('creates, lists, checks existence, and renames profiles', () => {
    const root = tempDir('cf-profiles-');
    const logger = new Logger(path.join(root, 'logs'), 'profile-test');
    const mgr = new FirefoxProfileManager(root, logger);

    const name = mgr.nextSequentialName('profile-');
    assert.equal(name, 'profile-001');
    assert.equal(mgr.profileExists(name), false);

    mgr.createProfile(name);
    assert.equal(mgr.profileExists(name), true);
    assert.equal(mgr.listProfiles().length, 1);

    const renamed = mgr.renameProfile(name, 'acct_alice');
    assert.equal(renamed.name, 'acct_alice');
    assert.equal(mgr.profileExists(name), false);
    assert.equal(mgr.profileExists('acct_alice'), true);

    const name2 = mgr.nextSequentialName('profile-');
    assert.equal(name2, 'profile-002');
    mgr.createProfile(name2);

    // Isolation: separate dirs
    const profiles = mgr.listProfiles();
    const dirs = new Set(profiles.map((p) => p.dir));
    assert.equal(dirs.size, profiles.length);

    logger.close();
  });

  it('refuses invalid names and duplicate create', () => {
    const root = tempDir('cf-profiles-bad-');
    const logger = new Logger(path.join(root, 'logs'), 'profile-test');
    const mgr = new FirefoxProfileManager(root, logger);
    assert.throws(() => mgr.createProfile('bad/name'));
    mgr.createProfile('profile-001');
    assert.throws(() => mgr.createProfile('profile-001'));
    logger.close();
  });

  it('launches and closes an isolated profile with Playwright Firefox', async () => {
    const can = await FirefoxProfileManager.canLaunchFirefox(true);
    if (!can) {
      console.log('SKIP: Firefox not available');
      return;
    }
    const root = tempDir('cf-profiles-launch-');
    const logger = new Logger(path.join(root, 'logs'), 'profile-launch');
    const mgr = new FirefoxProfileManager(root, logger);
    mgr.createProfile('profile-001');
    const launched = await mgr.launchProfile('profile-001', { headless: true });
    assert.ok(launched.page);
    assert.equal(launched.name, 'profile-001');
    await launched.page.goto('about:blank');
    await mgr.closeProfile('profile-001');
    assert.equal(mgr.getActive('profile-001'), undefined);
    logger.close();
  });
});
