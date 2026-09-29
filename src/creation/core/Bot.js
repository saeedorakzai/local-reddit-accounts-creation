/**
 * Run orchestrator — load config and accounts, run batches, report.
 *
 * Knows nothing about Outlook's DOM; it delegates through BatchManager and
 * src/platforms/index.js.
 */

const { loadConfig } = require('../config');
const AccountRegistry = require('../accounts/AccountRegistry');
const BatchManager = require('./BatchManager');
const { writeRunReport, summaryLines } = require('./RunReport');
const { scrub } = require('../shared/redact');
const { isSuccess } = require('../shared/outcomes');

class Bot {
    constructor() {
        this.config = null;
        this.registry = null;
        this.batchManager = null;
    }

    /**
     * @param {{ only?: string[] }} [overrides]  e.g. { only: ['a@b.com'] } for --one
     */
    initialize(overrides = null) {
        this.config = loadConfig();
        if (overrides?.only?.length) {
            this.config.run.only = overrides.only.map((e) => String(e).toLowerCase());
        }
        this.registry = AccountRegistry.load(this.config);
        return this.registry;
    }

    /** `npm run accounts` — inspect credentials and bindings without a browser. */
    printAccounts() {
        this.initialize();
        console.log(this.registry.describe().join('\n'));

        if (!this.registry.accounts.length) {
            console.log('❌ No account is ready to run.\n');
            return 1;
        }
        if (this.registry.hasProblems()) {
            console.log('⚠️  Fix the items above before running — flagged accounts will not run.\n');
            return 1;
        }

        console.log('✅ Registry is clean.\n');
        return 0;
    }

    /**
     * `npm run inspect` — drive one account with full DOM diagnostics so the
     * selectors can be checked against what Microsoft actually renders.
     */
    async inspect({ email = null, safe = false } = {}) {
        this.initialize();

        const account = email
            ? this.registry.accounts.find((a) => a.emailKey === email.toLowerCase())
            : this.registry.accounts[0];

        if (!account) {
            console.log(`❌ No bound account${email ? ` matching "${email}"` : ''}.\n`);
            return 1;
        }

        const LocalFirefoxManager = require('./LocalFirefoxManager');
        const OutlookLoginSession = require('../features/login/platforms/outlook/session');
        const { createInstanceConfig } = require('../config/instanceConfig');
        const { createInspector } = require('../platforms/outlook/inspect');

        console.log(`\n🔬 Inspecting ${account.email}  (profile ${account.profileId})`);
        console.log(safe ? '   safe mode — stops before typing the password\n' : '   full run\n');

        const instanceConfig = createInstanceConfig(this.config, account);
        const browserManager = new LocalFirefoxManager(this.config.adspower.baseUrl, {
            humanize: this.config.adspower.humanize,
            proxyWaitMs: this.config.adspower.proxyWaitMs,
            firefox: this.config.firefox
        });

        const inspector = createInspector({ account, stopBeforePassword: safe });

        try {
            const page = await browserManager.startProfile(account.profileId);
            const session = new OutlookLoginSession(page, instanceConfig, inspector);
            const result = await session.run();

            console.log(`\n${'='.repeat(74)}`);
            console.log(`RESULT: ${result.outcome}${result.detail ? ` — ${result.detail}` : ''}`);
            console.log(`${'='.repeat(74)}`);
            console.log(`\n📄 ${inspector.file}\n`);
            return 0;
        } catch (error) {
            console.error(`\n❌ ${scrub(error.message)}\n`);
            return 1;
        } finally {
            await browserManager.stopProfile();
        }
    }

    /**
     * `npm run inspect:reddit` — Phase 1 discovery harness.
     *
     * Requires Outlook already logged in on the profile. Scrapes the signed-in
     * email from the Outlook UI, opens Reddit register, submits the email, dumps
     * DOM diagnostics, and pauses so selectors can be harvested live.
     */
    async inspectReddit({ email = null } = {}) {
        this.initialize();

        const account = email
            ? this.registry.accounts.find((a) => a.emailKey === email.toLowerCase())
            : this.registry.accounts[0];

        if (!account) {
            console.log(`❌ No bound account${email ? ` matching "${email}"` : ''}.\n`);
            return 1;
        }

        const LocalFirefoxManager = require('./LocalFirefoxManager');
        const RedditRegisterSession = require('../features/register/platforms/reddit/session');
        const { createInstanceConfig } = require('../config/instanceConfig');

        const instanceConfig = createInstanceConfig(this.config, account);
        if (instanceConfig.features?.register?.reddit) {
            instanceConfig.features.register.reddit.pauseAfterComplete = true;
        }

        console.log(`\n🔬 Reddit register discovery — ${account.email}  (profile ${account.profileId})`);
        console.log('   requires Outlook already logged in on this profile\n');
        const browserManager = new LocalFirefoxManager(this.config.adspower.baseUrl, {
            humanize: this.config.adspower.humanize,
            proxyWaitMs: this.config.adspower.proxyWaitMs,
            firefox: this.config.firefox
        });

        try {
            const page = await browserManager.startProfile(account.profileId);
            const session = new RedditRegisterSession(page, instanceConfig);
            const result = await session.run();

            console.log(`\n${'='.repeat(74)}`);
            console.log(`RESULT: ${result.outcome}${result.detail ? ` — ${result.detail}` : ''}`);
            if (result.email) console.log(`EMAIL:  ${result.email}`);
            if (result.username) console.log(`USER:   ${result.username}`);
            console.log(`${'='.repeat(74)}\n`);
            return result.outcome === 'outlook-not-logged-in' || result.outcome === 'otp-timeout' ? 1 : 0;
        } catch (error) {
            console.error(`\n❌ ${scrub(error.message)}\n`);
            return 1;
        } finally {
            await browserManager.stopProfile();
        }
    }

    async run(overrides = null) {
        this.initialize(overrides);
        console.log(this.registry.describe().join('\n'));

        if (!this.registry.accounts.length) {
            console.log('❌ Nothing to run.\n');
            return 1;
        }

        if (this.registry.unboundAccounts.length) {
            console.log(
                `⚠️  ${this.registry.unboundAccounts.length} account(s) have no profile ` +
                'and will not run.\n'
            );
        }

        this.batchManager = new BatchManager(this.config, this.registry);
        const startedAt = Date.now();

        try {
            await this.runBatches();
        } catch (error) {
            console.error(`\n❌ Run failed: ${scrub(error.message)}`);
        } finally {
            await this.batchManager.stopAll();
        }

        const code = this.report(Date.now() - startedAt);
        this.consumeQueue();
        return code;
    }

    /**
     * In queue mode, remove finished pairs from logins.csv / profiles.csv so the
     * next run only processes what is left. See src/accounts/queue.js.
     */
    consumeQueue() {
        if (this.config.binding.strategy !== 'byQueue' || !this.config.binding.consumeOnFinish) {
            return;
        }

        try {
            const { consumeFinished } = require('../accounts/queue');
            const { consumed, keptAccounts } = consumeFinished(this.config, this.batchManager.getLedger());

            if (consumed.length) {
                console.log(
                    `🧾 Queue: removed ${consumed.length} finished pair(s); ` +
                    `${keptAccounts} account(s) remain. Archived to data/processed.csv.`
                );
            } else {
                console.log('🧾 Queue: nothing finished to remove (transient failures kept for retry).');
            }
        } catch (error) {
            console.error(`⚠️ Queue consume failed: ${scrub(error.message)}`);
        }
    }

    async runBatches() {
        this.batchManager.resetBatchIndex();

        for (;;) {
            const batch = this.batchManager.getNextBatch();
            if (!batch.length) break;

            try {
                const started = await this.batchManager.startBatch(batch);
                await this.batchManager.processBatch(started);
            } catch (error) {
                console.error(`❌ Batch error: ${scrub(error.message)}`);
            } finally {
                await this.batchManager.stopAll();
            }
        }
    }

    report(durationMs) {
        const ledger = this.batchManager.getLedger();
        const unaccountedFor = this.batchManager.getUnaccountedFor();

        console.log(summaryLines(ledger, unaccountedFor).join('\n'));

        try {
            const { txtPath, jsonPath } = writeRunReport({
                ledger,
                unaccountedFor,
                durationMs,
                endedAt: new Date()
            });
            console.log(`\n📄 ${txtPath}`);
            console.log(`📄 ${jsonPath}\n`);
        } catch (error) {
            console.error(`⚠️ Could not write the report: ${scrub(error.message)}`);
        }

        if (unaccountedFor.length) return 1;
        return ledger.every((e) => isSuccess(e.outcome)) ? 0 : 1;
    }
}

function reportFatal(error) {
    console.error(`\n❌ ${scrub(error.message)}\n`);
}

module.exports = { Bot, reportFatal };
