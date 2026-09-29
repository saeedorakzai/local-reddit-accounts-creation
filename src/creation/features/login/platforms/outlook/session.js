/**
 * The state-machine driver.
 *
 * Deliberately small, and not allowed to grow: it classifies the current screen
 * and runs that screen's handler. It never learns about a specific screen — an
 * `if (screen.id === ...)` here means the screen table has failed and the fix
 * belongs there. See .cursor/rules/login-flow.mdc.
 */

const fs = require('fs');
const path = require('path');

const HumanBehavior = require('../../../../shared/HumanBehavior');
const { ScreenView } = require('../../../../platforms/outlook/screenView');
const { classify } = require('../../../../platforms/outlook/screens');
const { isLoggedIn } = require('../../../../platforms/outlook/auth');
const { OUTCOMES, isRetryable } = require('../../../../shared/outcomes');
const { scrub } = require('../../../../shared/redact');

const REPO_ROOT = require('../../../../projectRoot');

/**
 * A screen that keeps re-matching without changing the page is stuck, not slow.
 * Set with headroom: the passkey bridge legitimately re-matches itself while the
 * "signing in with your passkey" prompt fails over to "something went wrong"
 * before the escape link appears.
 */
const MAX_SAME_SCREEN = 7;

class OutlookLoginSession {
    /**
     * @param {object} [hooks] diagnostics only — onStep({step, view, screen, page})
     *   may return { stop: true, reason } to halt the machine. The driver's own
     *   behaviour must never depend on a hook being present.
     */
    constructor(page, config, hooks = {}) {
        this.page = page;
        this.config = config;
        this.cfg = config.platforms.outlook;
        this.login = config.features.login.outlook;
        this.account = config.account;
        this.human = new HumanBehavior(page, this.cfg.timing);
        this.hooks = hooks || {};
    }

    async notify(payload) {
        if (typeof this.hooks.onStep !== 'function') return null;
        try {
            return await this.hooks.onStep({ ...payload, page: this.page, cfg: this.cfg });
        } catch (error) {
            console.warn(`⚠️ Diagnostics hook failed: ${scrub(error.message)}`);
            return null;
        }
    }

    get ctx() {
        return {
            page: this.page,
            account: this.account,
            cfg: this.cfg,
            login: this.login,
            human: this.human
        };
    }

    async goto(url, { retries = 2 } = {}) {
        let lastError;
        for (let attempt = 1; attempt <= retries + 1; attempt++) {
            try {
                await this.page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: this.cfg.timing.navigationTimeoutMs
                });
                return;
            } catch (error) {
                lastError = error;
                // Residential proxies drop connections intermittently; a retry
                // usually lands. Non-network errors are re-thrown immediately.
                if (!/net::|ERR_|Timeout|timeout/i.test(error.message)) throw error;
                console.log(`   ⚠️ navigation blip (${attempt}/${retries + 1}): ${error.message.split('\n')[0]}`);
                await this.human.gaussianSleep(2500, 5000);
            }
        }
        throw lastError;
    }

    async settle() {
        await this.human.gaussianSleep(
            this.login.settleMs * 0.7,
            this.login.settleMs * 1.3
        );
    }

    /**
     * Outlook shows a blank shell for a few seconds before it either renders the
     * mailbox or bounces to login. Poll until one of those is true rather than
     * guessing a fixed wait — a short guess reports a live session as logged out.
     */
    async waitForInboxOrLogin() {
        const deadline = Date.now() + (this.cfg.timing.inboxLoadTimeoutMs || 25000);
        let view = await ScreenView.capture(this.page);

        while (Date.now() < deadline) {
            if (view.urlIncludes(this.cfg.loginUrlPatterns)) return view;
            // Marketing page = definitively signed out. Stop waiting.
            if (view.urlIncludes(this.cfg.signedOutUrlPatterns)) return view;
            if (await isLoggedIn(view, this.cfg)) return view;
            // A sign-in field can appear before the URL changes.
            if (await view.visible(this.cfg.selectors.emailInput.field)) return view;

            await this.human.gaussianSleep(800, 1600);
            view = await ScreenView.capture(this.page);
        }

        return view;
    }

    /**
     * Confirm the signed-in mailbox actually belongs to this account.
     *
     * @returns {Promise<'match'|'foreign'|'unconfirmed'>}
     *   match       — this email is visible (or trusted after long wait, no foreign)
     *   foreign     — a different Microsoft address is clearly on screen
     *   unconfirmed — timed out with no usable signal (caller must NOT wipe)
     */
    async confirmExpectedAccount() {
        const email = this.account.emailKey;
        const timeout = this.cfg.timing.identityConfirmTimeoutMs || 35000;
        const deadline = Date.now() + timeout;
        let sawForeign = null;
        let loggedWait = false;

        while (Date.now() < deadline) {
            let haystack = '';
            try {
                haystack = await this.page.evaluate(() => {
                    const body = document.body ? document.body.innerText : '';
                    const titles = Array.from(document.querySelectorAll('[title*="@"]'))
                        .map((el) => el.getAttribute('title'))
                        .join(' ');
                    const aria = Array.from(document.querySelectorAll('[aria-label*="@"]'))
                        .map((el) => el.getAttribute('aria-label'))
                        .join(' ');
                    return `${body} ${titles} ${aria}`.toLowerCase();
                });
            } catch {
                haystack = '';
            }

            if (haystack.includes(email)) return 'match';

            const foreign = this.findForeignMicrosoftEmail(haystack, email);
            if (foreign) sawForeign = foreign;

            if (!loggedWait) {
                console.log(`   ↪ waiting for mailbox identity (up to ${Math.round(timeout / 1000)}s)…`);
                loggedWait = true;
            }
            await this.human.gaussianSleep(1000, 2000);
        }

        if (sawForeign) {
            console.log(`   ↪ mailbox shows a different account (${sawForeign})`);
            return 'foreign';
        }

        // Inbox signals already said we're logged in; persona chrome never painted
        // the address in time. Do NOT wipe — treat as this account.
        console.log('   ↪ identity chrome still loading — trusting inbox for this account');
        return 'match';
    }

    /** Any other *@outlook/hotmail/live/msn address in the page text. */
    findForeignMicrosoftEmail(haystack, expectedEmail) {
        const matches = String(haystack || '').match(
            /[a-z0-9._%+-]+@(?:outlook|hotmail|live|msn)\.com/gi
        );
        if (!matches) return null;
        const expected = String(expectedEmail || '').toLowerCase();
        return matches.map((m) => m.toLowerCase()).find((m) => m !== expected) || null;
    }

    /**
     * Identity wipe is disabled permanently. A live Outlook session is always kept.
     */
    async clearMicrosoftIdentity() {
        console.warn('⚠️ Identity wipe refused — live sessions are never cleared');
        return false;
    }

    /**
     * Capture only once the page has actually rendered something.
     *
     * Microsoft's sign-in is a SPA: between steps it blanks the document for a
     * second or two. Classifying that emptiness yields `unknown` and aborts a run
     * that was progressing perfectly well, so an empty / tiny page means "wait",
     * not "unrecognised".
     */
    async captureStable() {
        const deadline = Date.now() + (this.cfg.timing.screenSettleTimeoutMs || 25000);
        let view = await ScreenView.capture(this.page);

        while (Date.now() < deadline && this.looksUnsettled(view)) {
            await this.human.gaussianSleep(700, 1400);
            view = await ScreenView.capture(this.page);
        }

        return view;
    }

    looksUnsettled(view) {
        const text = (view.text || '').trim();
        if (!text) return true;
        // Blank Outlook shells often only show a spinner / "Loading" crumb.
        if (text.length < 40) return true;
        if (/^(loading|please wait|just a moment)[\s.]*$/i.test(text)) return true;
        return false;
    }

    /** Retries transient failures only. Terminal outcomes are returned as-is. */
    async run() {
        const attempts = Math.max(1, (this.login.loginRetries ?? 0) + 1);
        let last = null;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                last = await this.attempt();
            } catch (error) {
                const message = scrub(error.message);
                last = { outcome: OUTCOMES.UNKNOWN, detail: message };
                console.log(`⚠️ Attempt ${attempt}/${attempts} errored: ${message}`);
            }

            if (!isRetryable(last.outcome)) return last;

            if (attempt < attempts) {
                console.log(`🔁 Retrying (${last.outcome})`);
                await this.human.gaussianSleep(2000, 5000);
            }
        }

        return last;
    }

    async attempt() {
        const deadline = Date.now() + this.login.sessionTimeoutMs;

        if (this.login.checkInboxFirst) {
            // A real browser opens the mailbox and gets redirected to sign in.
            // It also means a live session costs one navigation and nothing else.
            await this.goto(this.cfg.inboxUrl);
            const view = await this.waitForInboxOrLogin();
            await this.notify({ step: 0, view, screen: null, phase: 'inbox-check' });

            if (await isLoggedIn(view, this.cfg)) {
                // Live session = success. Never wipe / switch / log out.
                // Reddit register scrapes whatever email is actually signed in.
                const identity = await this.confirmExpectedAccount();
                if (identity === 'foreign') {
                    console.log(
                        '   ↪ inbox is a different Microsoft account than CSV — ' +
                        'keeping the live session (no wipe); Reddit will use the signed-in address'
                    );
                }
                return { outcome: OUTCOMES.ALREADY_LOGGED_IN, detail: identity === 'foreign' ? 'foreign-session-kept' : null };
            }

            // Not logged in / still loading / redirected — go to login. Never wipe.
            await this.human.gaussianSleep(1500, 2800);
            await this.goto(this.cfg.loginUrl);
            await this.settle();
        } else {
            await this.goto(this.cfg.loginUrl);
            await this.settle();
        }

        let lastScreenId = null;
        let sameScreenCount = 0;

        for (let step = 1; step <= this.login.maxSteps; step++) {
            if (Date.now() > deadline) {
                return {
                    outcome: OUTCOMES.UNKNOWN,
                    detail: `timed out after ${Math.round(this.login.sessionTimeoutMs / 1000)}s`
                };
            }

            const view = await this.captureStable();
            const screen = await classify(view, this.cfg);

            const signal = await this.notify({ step, view, screen, phase: 'classify' });
            if (signal?.stop) {
                return {
                    outcome: OUTCOMES.UNKNOWN,
                    detail: `stopped by inspector: ${signal.reason || 'requested'}`
                };
            }

            if (!screen) {
                const shot = await this.screenshot('unknown-screen');
                return {
                    outcome: OUTCOMES.UNKNOWN,
                    detail: shot ? `unrecognised screen — ${shot}` : 'unrecognised screen'
                };
            }

            if (screen.terminal) {
                // Live mailbox = success. Never wipe to "fix" a mismatched persona.
                if (screen.outcome === OUTCOMES.LOGGED_IN) {
                    const identity = await this.confirmExpectedAccount();
                    if (identity === 'foreign') {
                        console.log(
                            '   ↪ mailbox persona differs from CSV — keeping session (no wipe)'
                        );
                    }
                }
                return { outcome: screen.outcome, detail: screen.id };
            }

            if (screen.id === lastScreenId) {
                sameScreenCount++;
                if (sameScreenCount >= MAX_SAME_SCREEN) {
                    const shot = await this.screenshot(`stuck-${screen.id}`);
                    return {
                        outcome: OUTCOMES.UNKNOWN,
                        detail: `stuck on "${screen.id}"${shot ? ` — ${shot}` : ''}`
                    };
                }
            } else {
                sameScreenCount = 0;
                lastScreenId = screen.id;
                console.log(`   → ${screen.id}`);
            }

            await screen.handle(this.ctx);
            await this.settle();
        }

        const shot = await this.screenshot('max-steps');
        return {
            outcome: OUTCOMES.UNKNOWN,
            detail: `hit maxSteps (${this.login.maxSteps})${shot ? ` — ${shot}` : ''}`
        };
    }

    /** Evidence for an unclassified screen. Never fatal if it fails. */
    async screenshot(tag) {
        if (!this.config.run?.screenshotOnUnknown) return null;

        try {
            const dir = path.join(REPO_ROOT, 'screenshots');
            fs.mkdirSync(dir, { recursive: true });

            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const safeEmail = this.account.email.replace(/[^a-z0-9]/gi, '_');
            const file = path.join(dir, `${safeEmail}-${tag}-${stamp}.png`);

            await this.page.screenshot({ path: file, fullPage: false });
            return path.relative(REPO_ROOT, file);
        } catch {
            return null;
        }
    }
}

module.exports = OutlookLoginSession;
