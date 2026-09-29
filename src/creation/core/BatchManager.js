/**
 * Runs accounts in batches: staggered AdsPower starts, then login (+ optional
 * Reddit register) in parallel.
 *
 * Holds the ledger. Every account lands in exactly one outcome bucket — an account
 * missing from the ledger is a bug, not a cosmetic gap.
 *
 * Knows nothing about Outlook/Reddit DOM; it delegates through src/platforms/index.js.
 */

const LocalFirefoxManager = require('./LocalFirefoxManager');
const { createPlatform } = require('../platforms');
const { createInstanceConfig, randomInt } = require('../config/instanceConfig');
const { runWithProfileLog } = require('../shared/profileContext');
const { scrub } = require('../shared/redact');
const { OUTCOMES, isSuccess } = require('../shared/outcomes');

const DEFAULT_THROTTLE = {
    delayBetweenMs: { min: 1000, max: 3000 },
    burstSize: 5,
    burstPauseMs: { min: 28000, max: 35000 }
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickMs(range, fallback) {
    if (range == null) return fallback;
    if (typeof range === 'number') return range;
    if (range.min != null && range.max != null) return randomInt(range.min, range.max);
    return fallback;
}

class BatchManager {
    constructor(config, registry) {
        this.config = config;
        this.registry = registry;
        this.batchSize = config.adspower.batchSize;
        this.throttle = { ...DEFAULT_THROTTLE, ...(config.adspower.startThrottle || {}) };

        this.accounts = registry.accounts;
        this.batchIndex = 0;
        this.active = new Map();          // profileId → { adsPower, platform, account }
        this.ledger = new Map();          // emailKey → { account, outcome, detail }
    }

    label(account) {
        const index = this.accounts.indexOf(account);
        const n = index >= 0 ? index + 1 : '?';
        return `${account.profileId} - ${n}/${this.accounts.length}`;
    }

    record(account, outcome, detail = null) {
        // First write wins — an account's outcome is decided once.
        if (this.ledger.has(account.emailKey)) return;
        this.ledger.set(account.emailKey, { account, outcome, detail: scrub(detail) });
    }

    getLedger() {
        return [...this.ledger.values()];
    }

    /** Accounts that never reached the ledger — should always be empty. */
    getUnaccountedFor() {
        return this.accounts.filter((a) => !this.ledger.has(a.emailKey));
    }

    resetBatchIndex() {
        this.batchIndex = 0;
    }

    getNextBatch() {
        const start = this.batchIndex * this.batchSize;
        if (start >= this.accounts.length) return [];
        this.batchIndex++;
        return this.accounts.slice(start, start + this.batchSize);
    }

    /** Space launches so concurrent Firefox/proxy starts stay stable. */
    async waitBeforeStart(indexInBatch) {
        if (indexInBatch === 0) return;

        const { burstSize, burstPauseMs, delayBetweenMs } = this.throttle;

        if (burstSize > 0 && indexInBatch % burstSize === 0) {
            const pause = pickMs(burstPauseMs, 30000);
            console.log(
                `⏱️ Launch throttle — ${indexInBatch} started, pausing ${Math.round(pause / 1000)}s`
            );
            await sleep(pause);
            return;
        }

        await sleep(pickMs(delayBetweenMs, 2000));
    }

    async startOne(account) {
        const instanceConfig = createInstanceConfig(this.config, account);
        // Discovery pause is for inspect:reddit only — never hang a batch on Enter.
        if (instanceConfig.features?.register?.reddit) {
            instanceConfig.features.register.reddit.pauseAfterComplete = false;
        }
        const browserManager = new LocalFirefoxManager(this.config.adspower.baseUrl, {
            humanize: this.config.adspower.humanize,
            proxyWaitMs: this.config.adspower.proxyWaitMs,
            firefox: this.config.firefox
        });

        const page = await browserManager.startProfile(account.profileId);
        const platform = createPlatform(page, 'outlook', instanceConfig);

        this.active.set(account.profileId, {
            adsPower: browserManager,
            browserManager,
            platform,
            account,
            page,
            isFirefox: true
        });

        return account;
    }

    async startBatch(batch) {
        console.log(`\n🚀 Starting ${batch.length} profile(s)`);
        const started = [];

        for (let i = 0; i < batch.length; i++) {
            const account = batch[i];
            await this.waitBeforeStart(i);

            const label = this.label(account);
            try {
                await this.startOne(account);
                console.log(`✅ ${label} started`);
                started.push(account);
            } catch (error) {
                const message = scrub(error.message);
                const rateLimited = /too many request/i.test(message);
                console.error(`❌ ${label} failed to start: ${message}`);

                if (rateLimited) {
                    const pause = pickMs(this.throttle.burstPauseMs, 30000);
                    console.log(`⏱️ Rate limited — waiting ${Math.round(pause / 1000)}s and retrying`);
                    await sleep(pause);
                    try {
                        await this.startOne(account);
                        console.log(`✅ ${label} started on retry`);
                        started.push(account);
                        continue;
                    } catch (retryError) {
                        console.error(`❌ ${label} retry failed: ${scrub(retryError.message)}`);
                    }
                }

                this.record(account, OUTCOMES.PROFILE_START_FAILED, message);
            }
        }

        return started;
    }

    async processBatch(started) {
        if (!started.length) return [];

        const chainRegister = this.config.run?.registerAfterLogin !== false;
        console.log(
            `\n🔐 Signing in ${started.length} account(s)` +
            (chainRegister ? ' → then Reddit register' : '')
        );

        return Promise.all(started.map((account) => {
            const label = this.label(account);
            return runWithProfileLog(`[${label}]`, async () => {
                const instance = this.active.get(account.profileId);
                try {
                    const result = await this.runAccountPipeline(instance, chainRegister);
                    this.record(account, result.outcome, result.detail);
                    console.log(
                        `${isSuccess(result.outcome) ? '✅' : '⚠️'} ` +
                        `${result.outcome}${result.detail ? ` — ${result.detail}` : ''}`
                    );
                    return result;
                } catch (error) {
                    const message = scrub(error.message);
                    console.error(`❌ ${message}`);
                    this.record(account, OUTCOMES.UNKNOWN, message);
                    return { outcome: OUTCOMES.UNKNOWN, detail: message };
                } finally {
                    await this.stopProfile(account.profileId);
                }
            });
        }));
    }

    /**
     * Outlook login, then optionally Reddit register on the same browser.
     * Core never touches selectors — both steps go through platform.*.
     */
    async runAccountPipeline(instance, chainRegister) {
        const loginResult = await instance.platform.login();

        if (!isSuccess(loginResult.outcome)) {
            return loginResult;
        }

        if (!chainRegister || typeof instance.platform.register !== 'function') {
            return loginResult;
        }

        console.log(`📱 Outlook ${loginResult.outcome} — starting Reddit register…`);

        const registerResult = await instance.platform.register();
        const detailParts = [
            `outlook:${loginResult.outcome}`,
            registerResult.detail || null,
            registerResult.username ? `user=${registerResult.username}` : null
        ].filter(Boolean);

        return {
            outcome: registerResult.outcome || OUTCOMES.UNKNOWN,
            detail: detailParts.join(' · '),
            email: registerResult.email,
            username: registerResult.username
        };
    }

    async stopProfile(profileId) {
        const instance = this.active.get(profileId);
        if (!instance) return;

        try {
            await instance.adsPower.stopProfile();
        } catch (error) {
            console.warn(`⚠️ Stop failed: ${scrub(error.message)}`);
        } finally {
            this.active.delete(profileId);
        }
    }

    /** Nothing may be left open — leaked browsers break the next run's throttle. */
    async stopAll() {
        const ids = [...this.active.keys()];
        if (!ids.length) return;
        console.log(`🛑 Closing ${ids.length} remaining profile(s)`);
        await Promise.all(ids.map((id) => this.stopProfile(id)));
    }
}

module.exports = BatchManager;
