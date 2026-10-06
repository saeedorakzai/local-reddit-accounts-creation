/**
 * Local Firefox launcher — persistent profiles under .firefox-profiles/<id>.
 *
 * Default: Playwright’s bundled Firefox.
 * Optional: system Mozilla Firefox (FIREFOX_PATH / USE_SYSTEM_FIREFOX=true)
 *   so each profile is a real Mozilla user-data dir you can reopen with:
 *   firefox.exe -no-remote -profile "<dir>"
 *
 * Proxy: HTTP or SOCKS5 from `proxy details` (or PROXY_* env).
 * Applied via Playwright launch options AND written into profile user.js
 * so the same proxy sticks when you open the profile manually.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { firefox } = require('playwright');

const PROJECT_ROOT = require('../projectRoot');
const { humanizeBrowser } = require('../shared/humanize');
const { randomInt } = require('../config/instanceConfig');

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function pickMs(range, fallback) {
    if (range == null) return fallback;
    if (typeof range === 'number') return range;
    if (range.min != null && range.max != null) return randomInt(range.min, range.max);
    return fallback;
}

function envFlag(name, fallback = false) {
    const v = process.env[name];
    if (v === undefined || v === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

/** Candidate paths for installed Mozilla Firefox (not Playwright Nightly). */
function mozillaFirefoxCandidates() {
    const home = os.homedir();
    if (process.platform === 'win32') {
        const pf = process.env.ProgramFiles || 'C:\\Program Files';
        const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        return [
            path.join(pf, 'Mozilla Firefox', 'firefox.exe'),
            path.join(pf86, 'Mozilla Firefox', 'firefox.exe'),
            path.join(local, 'Mozilla Firefox', 'firefox.exe')
        ];
    }
    if (process.platform === 'darwin') {
        return [
            '/Applications/Firefox.app/Contents/MacOS/firefox',
            path.join(home, 'Applications', 'Firefox.app', 'Contents', 'MacOS', 'firefox')
        ];
    }
    return [
        '/usr/bin/firefox',
        '/usr/local/bin/firefox',
        '/snap/bin/firefox',
        path.join(home, '.local', 'bin', 'firefox')
    ];
}

function findMozillaFirefox() {
    for (const candidate of mozillaFirefoxCandidates()) {
        try {
            if (fs.existsSync(candidate)) return candidate;
        } catch {
            // ignore
        }
    }
    return null;
}

/**
 * Parse `proxy details`.
 * First line may be: http | https | socks5 | socks5h
 * Or a full URL: socks5://user:pass@host:port
 */
function parseProxyFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!raw) throw new Error(`Proxy file empty: ${filePath}`);

    const lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));

    const first = lines[0] || '';

    if (/^(https?|socks5h?):\/\//i.test(first)) {
        const url = new URL(first);
        const protocol = url.protocol.replace(':', '');
        return {
            type: protocol.startsWith('socks') ? protocol : protocol === 'https' ? 'https' : 'http',
            host: url.hostname,
            port: Number(url.port) || (url.protocol === 'https:' ? 443 : url.protocol.startsWith('socks') ? 1080 : 80),
            username: decodeURIComponent(url.username || '') || undefined,
            password: decodeURIComponent(url.password || '') || undefined
        };
    }

    let scheme = 'http';
    let start = 0;
    if (/^(https?|socks5h?)$/i.test(first) && !first.includes(':')) {
        scheme = first.toLowerCase();
        start = 1;
    }

    const map = {};
    for (const line of lines.slice(start)) {
        const m = /^(host|port|username|password|user|pass|type|protocol)\s*:\s*(.+)$/i.exec(line);
        if (m) map[m[1].toLowerCase()] = m[2].trim();
    }

    if (map.type || map.protocol) {
        scheme = String(map.type || map.protocol).toLowerCase();
    }

    const host = map.host;
    const port = Number(map.port);
    if (!host || !Number.isFinite(port)) {
        throw new Error(`Invalid proxy key/value file: ${filePath}`);
    }

    if (!/^(https?|socks5h?)$/i.test(scheme)) {
        throw new Error(`Unsupported proxy type "${scheme}" (use http, https, socks5, socks5h)`);
    }

    return {
        type: scheme,
        host,
        port,
        username: map.username || map.user || undefined,
        password: map.password || map.pass || undefined
    };
}

function resolveProxyFilePath(firefoxConfig) {
    const configured = firefoxConfig.proxyFile || 'proxy details';
    const candidates = [
        configured,
        `${configured}.txt`,
        'proxy details',
        'proxy details.txt',
        'proxy-details.txt'
    ];
    const seen = new Set();
    for (const name of candidates) {
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const filePath = path.isAbsolute(name) ? name : path.join(PROJECT_ROOT, name);
        if (fs.existsSync(filePath)) return filePath;
    }
    return null;
}

function loadProxy(firefoxConfig) {
    if (!firefoxConfig?.proxyEnabled) return null;

    let proxy = null;
    const filePath = resolveProxyFilePath(firefoxConfig);
    if (filePath) {
        proxy = parseProxyFile(filePath);
        console.log(`📄 Proxy file: ${filePath}`);
    }

    if (!proxy && firefoxConfig.proxyHost && firefoxConfig.proxyPort) {
        proxy = {
            type: (firefoxConfig.proxyType || 'http').toLowerCase(),
            host: firefoxConfig.proxyHost,
            port: Number(firefoxConfig.proxyPort),
            username: firefoxConfig.proxyUsername || undefined,
            password: firefoxConfig.proxyPassword || undefined
        };
    }

    if (!proxy) return null;

    if (!proxy.password && firefoxConfig.proxyPassword) {
        proxy.password = firefoxConfig.proxyPassword;
    }
    if (!proxy.username && firefoxConfig.proxyUsername) {
        proxy.username = firefoxConfig.proxyUsername;
    }

    return proxy;
}

/** Playwright launch.proxy shape. */
function toPlaywrightProxy(proxy) {
    if (!proxy) return null;
    const type = (proxy.type || 'http').toLowerCase();
    return {
        server: `${type}://${proxy.host}:${proxy.port}`,
        username: proxy.username,
        password: proxy.password
    };
}

/**
 * Write Mozilla prefs so opening the profile outside the bot still uses the proxy.
 * Auth for SOCKS is limited in Firefox; username/password still go through Playwright when the bot launches.
 */
function writeProxyUserJs(profileDir, proxy) {
    if (!proxy) return;

    const type = (proxy.type || 'http').toLowerCase();
    const lines = [
        '// Generated by creation-flow — proxy for this Mozilla profile',
        'user_pref("network.proxy.type", 1);',
        'user_pref("network.proxy.no_proxies_on", "localhost, 127.0.0.1");'
    ];

    if (type.startsWith('socks')) {
        lines.push(`user_pref("network.proxy.socks", "${proxy.host}");`);
        lines.push(`user_pref("network.proxy.socks_port", ${proxy.port});`);
        lines.push('user_pref("network.proxy.socks_version", 5);');
        lines.push('user_pref("network.proxy.socks_remote_dns", true);');
        lines.push('user_pref("network.proxy.http", "");');
        lines.push('user_pref("network.proxy.ssl", "");');
    } else {
        lines.push(`user_pref("network.proxy.http", "${proxy.host}");`);
        lines.push(`user_pref("network.proxy.http_port", ${proxy.port});`);
        lines.push(`user_pref("network.proxy.ssl", "${proxy.host}");`);
        lines.push(`user_pref("network.proxy.ssl_port", ${proxy.port});`);
        lines.push('user_pref("network.proxy.share_proxy_settings", true);');
        lines.push('user_pref("network.proxy.socks", "");');
    }

    fs.writeFileSync(path.join(profileDir, 'user.js'), `${lines.join('\n')}\n`, 'utf8');
}

function resolveExecutable(firefoxConfig) {
    if (firefoxConfig.executablePath) {
        return firefoxConfig.executablePath;
    }
    if (firefoxConfig.useSystemFirefox || envFlag('USE_SYSTEM_FIREFOX', false)) {
        const found = findMozillaFirefox();
        if (!found) {
            throw new Error(
                'USE_SYSTEM_FIREFOX is set but Mozilla Firefox was not found.\n' +
                'Install Firefox from https://www.mozilla.org/firefox/ or set FIREFOX_PATH to firefox.exe'
            );
        }
        return found;
    }
    return null; // Playwright bundled Firefox
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
        this.executablePath = null;
    }

    profilesRoot() {
        const dir = this.firefoxConfig.profilesDir || '.firefox-profiles';
        return path.isAbsolute(dir) ? dir : path.join(PROJECT_ROOT, dir);
    }

    ensureProfileDir(profileId) {
        let safe = String(profileId).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
        safe = safe.replace(/[.\s]+$/g, '');
        if (WIN_RESERVED.test(safe)) safe = `ff-${safe}`;
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

    clearStaleLocks(profileDir) {
        for (const name of ['parent.lock', 'lock', '.parentlock']) {
            const lockPath = path.join(profileDir, name);
            try {
                if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
            } catch {
                // live lock — launch error below
            }
        }
    }

    async startProfile(profileId) {
        this.currentProfileId = profileId;
        this.profileDir = this.ensureProfileDir(profileId);

        const proxy = loadProxy(this.firefoxConfig);
        writeProxyUserJs(this.profileDir, proxy);

        const launchOptions = {
            headless: this.firefoxConfig.headless === true,
            slowMo: this.firefoxConfig.slowMoMs || 0,
            viewport: { width: 1280, height: 800 },
            ignoreHTTPSErrors: true
        };

        this.executablePath = resolveExecutable(this.firefoxConfig);
        if (this.executablePath) {
            launchOptions.executablePath = this.executablePath;
            console.log(`🦊 Using Mozilla Firefox: ${this.executablePath}`);
        } else {
            console.log('🦊 Using Playwright bundled Firefox (set USE_SYSTEM_FIREFOX=true for Mozilla)');
        }

        const pwProxy = toPlaywrightProxy(proxy);
        if (pwProxy) {
            launchOptions.proxy = pwProxy;
            console.log(
                `🌐 Proxy ${pwProxy.server}${pwProxy.username ? ` (user ${pwProxy.username})` : ''}`
            );
        } else {
            console.log('🌐 No proxy configured for this profile');
        }

        console.log(`📁 Profile dir: ${this.profileDir}`);
        console.log(
            `   reopen later: firefox -no-remote -profile "${this.profileDir}"`
        );

        this.clearStaleLocks(this.profileDir);

        try {
            this.context = await firefox.launchPersistentContext(this.profileDir, launchOptions);
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            if (/already in use|profile is already|Failed to create a ProcessSingleton|Target page, context or browser has been closed/i.test(message)) {
                throw new Error(
                    `Firefox profile is locked or already open (${profileId}). ` +
                    `Close other Firefox windows using this profile, then retry.\n` +
                    `Folder: ${this.profileDir}`
                );
            }
            if (/Executable doesn't exist|browserType\.launchPersistentContext/i.test(message)) {
                throw new Error(
                    `Firefox executable missing.\n` +
                    `  Playwright Firefox: npx playwright install firefox\n` +
                    `  Or install Mozilla Firefox and set USE_SYSTEM_FIREFOX=true / FIREFOX_PATH=\n` +
                    `Original: ${message}`
                );
            }
            throw error;
        }

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
        this.executablePath = null;
    }

    isFirefox() {
        return true;
    }
}

module.exports = LocalFirefoxManager;
module.exports.parseProxyFile = parseProxyFile;
module.exports.toPlaywrightProxy = toPlaywrightProxy;
module.exports.findMozillaFirefox = findMozillaFirefox;
