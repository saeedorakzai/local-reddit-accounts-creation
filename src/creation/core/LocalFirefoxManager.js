/**
 * Local Playwright Firefox — drop-in replacement for AdsPowerManager.
 *
 * Creates/reuses a persistent profile under .firefox-profiles/<profileId>,
 * attaches an optional HTTP proxy, and returns a Playwright Page.
 */

const fs = require('fs');
const path = require('path');
const { firefox } = require('playwright');

const PROJECT_ROOT = require('../projectRoot');
const { humanizeBrowser } = require('../shared/humanize');
const { randomInt } = require('../config/instanceConfig');

function pickMs(range, fallback) {
    if (range == null) return fallback;
    if (typeof range === 'number') return range;
    if (range.min != null && range.max != null) return randomInt(range.min, range.max);
    return fallback;
}

function parseProxyFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) throw new Error(`Proxy file empty: ${filePath}`);

    const first = raw.split(/\r?\n/)[0].trim();
    if (/^https?:\/\//i.test(first) && first.includes('@')) {
        const url = new URL(first);
        return {
            server: `${url.protocol}//${url.hostname}:${url.port || (url.protocol === 'https:' ? 443 : 80)}`,
            username: decodeURIComponent(url.username || '') || undefined,
            password: decodeURIComponent(url.password || '') || undefined
        };
    }

    const lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));

    if (lines.some((l) => /^(host|port|username|password|user|pass)\s*:/i.test(l))) {
        const map = {};
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
            server: `http://${host}:${port}`,
            username: map.username || map.user || undefined,
            password: map.password || map.pass || undefined
        };
    }

    throw new Error(`Unrecognized proxy file format: ${filePath}`);
}

function loadProxy(firefoxConfig) {
    if (!firefoxConfig?.proxyEnabled) return null;

    let proxy = null;
    if (firefoxConfig.proxyFile) {
        const filePath = path.isAbsolute(firefoxConfig.proxyFile)
            ? firefoxConfig.proxyFile
            : path.join(PROJECT_ROOT, firefoxConfig.proxyFile);
        if (fs.existsSync(filePath)) {
            proxy = parseProxyFile(filePath);
        }
    }

    if (!proxy && firefoxConfig.proxyHost && firefoxConfig.proxyPort) {
        proxy = {
            server: `http://${firefoxConfig.proxyHost}:${firefoxConfig.proxyPort}`,
            username: firefoxConfig.proxyUsername || undefined,
            password: firefoxConfig.proxyPassword || undefined
        };
    }

    if (proxy && !proxy.password && firefoxConfig.proxyPassword) {
        proxy.password = firefoxConfig.proxyPassword;
    }
    if (proxy && !proxy.username && firefoxConfig.proxyUsername) {
        proxy.username = firefoxConfig.proxyUsername;
    }

    return proxy;
}

class LocalFirefoxManager {
    constructor(_baseUrlIgnored, options = {}) {
        this.humanizeOptions = options.humanize || null;
        this.proxyWaitMs = options.proxyWaitMs || null;
        this.firefoxConfig = options.firefox || {};

        this.currentProfileId = null;
        this.browser = null;
        this.context = null;
        this.page = null;
        this.browserKind = 'firefox';
        this.profileDir = null;
    }

    profilesRoot() {
        const dir = this.firefoxConfig.profilesDir || '.firefox-profiles';
        return path.isAbsolute(dir) ? dir : path.join(PROJECT_ROOT, dir);
    }

    ensureProfileDir(profileId) {
        const safe = String(profileId).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
        const root = this.profilesRoot();
        fs.mkdirSync(root, { recursive: true });
        const dir = path.join(root, safe);
        fs.mkdirSync(dir, { recursive: true });
        const marker = path.join(dir, 'creation-flow.profile');
        if (!fs.existsSync(marker)) {
            fs.writeFileSync(marker, `created=${new Date().toISOString()}\n`, 'utf8');
        }
        return dir;
    }

    async startProfile(profileId) {
        this.currentProfileId = profileId;
        this.profileDir = this.ensureProfileDir(profileId);

        const proxy = loadProxy(this.firefoxConfig);
        const launchOptions = {
            headless: this.firefoxConfig.headless === true,
            slowMo: this.firefoxConfig.slowMoMs || 0,
            viewport: { width: 1280, height: 800 },
            ignoreHTTPSErrors: true
        };

        if (this.firefoxConfig.executablePath) {
            launchOptions.executablePath = this.firefoxConfig.executablePath;
        }

        if (proxy) {
            launchOptions.proxy = proxy;
            console.log(`🌐 Proxy ${proxy.server}${proxy.username ? ` (user ${proxy.username})` : ''}`);
        } else {
            console.log('🌐 No proxy configured for this profile');
        }

        console.log(`🦊 Launching local Firefox profile: ${profileId}`);
        console.log(`   dir: ${this.profileDir}`);

        this.context = await firefox.launchPersistentContext(this.profileDir, launchOptions);
        // Persistent contexts often return null from browser() — humanize needs a Browser.
        this.browser = this.context.browser();

        const pages = this.context.pages();
        this.page = pages.length ? pages[0] : await this.context.newPage();

        if (this.humanizeOptions?.humanize && this.browser) {
            try {
                await humanizeBrowser(this.browser, this.humanizeOptions);
            } catch (error) {
                console.warn(`⚠️ humanize skipped: ${error.message}`);
            }
        }

        await this.neutralizePasskeys();

        const waitMs = pickMs(this.proxyWaitMs, proxy ? 5000 : 1000);
        console.log(`⏱️ Waiting ${Math.round(waitMs / 1000)}s for the browser/proxy to settle...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));

        return this.page;
    }

    async neutralizePasskeys() {
        const INIT = () => {
            try {
                const reject = () =>
                    Promise.reject(new DOMException('Passkeys disabled for automation', 'NotAllowedError'));

                if (navigator.credentials) {
                    navigator.credentials.get = reject;
                    navigator.credentials.create = reject;
                }

                if (window.PublicKeyCredential) {
                    window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable =
                        () => Promise.resolve(false);
                    window.PublicKeyCredential.isConditionalMediationAvailable =
                        () => Promise.resolve(false);
                }
            } catch {
                // never break the page
            }
        };

        try {
            await this.context.addInitScript(INIT);
            await this.page.addInitScript(INIT).catch(() => {});
            console.log('🔑 Passkey prompts disabled (Microsoft will use the password path)');
        } catch (error) {
            console.warn(`⚠️ Could not disable passkeys: ${error.message}`);
        }
    }

    async stopProfile() {
        if (!this.currentProfileId) return;

        try {
            if (this.context) {
                await this.context.close();
            } else if (this.browser) {
                await this.browser.close();
            }
        } catch (error) {
            console.warn(`⚠️ Error closing Firefox: ${error.message}`);
        }

        this.browser = null;
        this.context = null;
        this.page = null;
        this.currentProfileId = null;
        this.profileDir = null;
    }

    isFirefox() {
        return true;
    }
}

module.exports = LocalFirefoxManager;
