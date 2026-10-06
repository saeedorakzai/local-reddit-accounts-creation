/**
 * Creation-flow Reddit settings — local Firefox (no AdsPower).
 *
 * Queue: email data.txt at project root (or accounts.csvFile).
 * Browser: Playwright Firefox persistent profiles under .firefox-profiles.
 */

const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

module.exports = {
    // Kept as `adspower` key for BatchManager batchSize/throttle shape compatibility.
    adspower: {
        baseUrl: 'local-firefox',
        profileIds: [],
        batchSize: 1,
        startThrottle: {
            delayBetweenMs: { min: 2000, max: 4000 },
            burstSize: 3,
            burstPauseMs: { min: 15000, max: 25000 }
        },
        proxyWaitMs: { min: 3000, max: 6000 },
        humanize: {
            humanize: true,
            humanPreset: 'careful'
        }
    },

    firefox: {
        profilesDir: process.env.PROFILES_DIR || '.firefox-profiles',
        headless: ['1', 'true', 'yes', 'on'].includes(
            String(process.env.HEADLESS || 'false').toLowerCase()
        ),
        slowMoMs: Number(process.env.SLOW_MO || 0) || 0,
        // true = launch system Mozilla Firefox (about:-compatible profile dirs via -profile)
        useSystemFirefox: ['1', 'true', 'yes', 'on'].includes(
            String(process.env.USE_SYSTEM_FIREFOX || 'false').toLowerCase()
        ),
        executablePath:
            process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH ||
            process.env.FIREFOX_PATH ||
            null,
        proxyEnabled: !['0', 'false', 'no', 'off'].includes(
            String(process.env.PROXY_ENABLED || 'true').toLowerCase()
        ),
        proxyType: process.env.PROXY_TYPE || '',
        proxyFile: process.env.PROXY_FILE || 'proxy details',
        proxyHost: process.env.PROXY_HOST || '',
        proxyPort: process.env.PROXY_PORT ? Number(process.env.PROXY_PORT) : null,
        proxyUsername: process.env.PROXY_USERNAME || '',
        proxyPassword: process.env.PROXY_PASSWORD || ''
    },

    binding: {
        // One local Firefox profile per Outlook email row.
        strategy: 'byLocalProfile',
        profilesFile: 'data/adspower.json',
        consumeOnFinish: false,
        mapFile: 'data/profiles/bindings.json'
    },

    accounts: {
        // Prefer root email data.txt; fall back to data/logins.csv if absent.
        csvFile: process.env.TEST_USERS_FILE || 'email data.txt',
        source: 'emailData'
    },

    run: {
        only: [],
        skip: [],
        screenshotOnUnknown: true,
        registerAfterLogin: true
    },

    scheduler: {
        enabled: false,
        intervalHours: { min: 20, max: 24 }
    },

    projectRoot: PROJECT_ROOT
};
