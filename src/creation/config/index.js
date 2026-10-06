/**
 * Merge config layers for the local-Firefox creation pipeline.
 */

const outlookPlatform = require('./platforms/outlook');
const redditPlatform = require('./platforms/reddit');
const loginConfig = require('../features/login/config');
const registerConfig = require('../features/register/config');
const { loadRootConfig } = require('./loadRootConfig');

const VALID_STRATEGIES = [
    'byLocalProfile',
    'byQueue',
    'byMapFile',
    'byIndex',
    'byAdsPowerLookup'
];

function validate(root) {
    const strategy = root.binding?.strategy || 'byLocalProfile';
    if (!VALID_STRATEGIES.includes(strategy)) {
        throw new Error(
            `Invalid binding.strategy "${strategy}" in config/creation-app.cjs. ` +
            `Use one of: ${VALID_STRATEGIES.join(', ')}`
        );
    }

    const batchSize = root.adspower?.batchSize ?? 1;
    if (!Number.isInteger(batchSize) || batchSize < 1) {
        throw new Error(`adspower.batchSize must be a positive integer (got ${batchSize})`);
    }
}

function loadConfig() {
    const root = loadRootConfig();
    validate(root);

    return {
        feature: 'login',
        platform: 'outlook',

        adspower: {
            baseUrl: root.adspower?.baseUrl || 'local-firefox',
            profileIds: (root.adspower?.profileIds || []).map((id) => String(id).trim()),
            batchSize: root.adspower?.batchSize ?? 1,
            startThrottle: root.adspower?.startThrottle || {},
            proxyWaitMs: root.adspower?.proxyWaitMs ?? { min: 3000, max: 6000 },
            humanize: root.adspower?.humanize || null
        },

        firefox: {
            profilesDir: root.firefox?.profilesDir || '.firefox-profiles',
            headless: Boolean(root.firefox?.headless),
            slowMoMs: root.firefox?.slowMoMs || 0,
            useSystemFirefox: Boolean(root.firefox?.useSystemFirefox),
            executablePath: root.firefox?.executablePath || null,
            proxyEnabled: root.firefox?.proxyEnabled !== false,
            proxyType: root.firefox?.proxyType || '',
            proxyFile: root.firefox?.proxyFile || 'proxy details',
            proxyHost: root.firefox?.proxyHost || '',
            proxyPort: root.firefox?.proxyPort ?? null,
            proxyUsername: root.firefox?.proxyUsername || '',
            proxyPassword: root.firefox?.proxyPassword || ''
        },

        binding: {
            strategy: root.binding?.strategy || 'byLocalProfile',
            profilesFile: root.binding?.profilesFile || 'data/adspower.json',
            consumeOnFinish: root.binding?.consumeOnFinish === true,
            mapFile: root.binding?.mapFile || 'data/profiles/bindings.json'
        },

        accounts: {
            csvFile: root.accounts?.csvFile || 'email data.txt',
            source: root.accounts?.source || 'emailData'
        },

        run: {
            only: root.run?.only || [],
            skip: root.run?.skip || [],
            screenshotOnUnknown: root.run?.screenshotOnUnknown !== false,
            registerAfterLogin: root.run?.registerAfterLogin !== false
        },

        scheduler: {
            enabled: Boolean(root.scheduler?.enabled),
            intervalHours: {
                min: root.scheduler?.intervalHours?.min ?? 20,
                max: root.scheduler?.intervalHours?.max ?? 24
            }
        },

        platforms: {
            outlook: outlookPlatform,
            reddit: redditPlatform
        },

        features: {
            login: loginConfig,
            register: registerConfig
        }
    };
}

module.exports = { loadConfig };
