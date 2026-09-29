/**
 * Reddit register driver.
 *
 * Phase 1 discovery pieces remain (diagnostics dumps). Flow now continues:
 * email → switch to Outlook for OTP → submit OTP → username/password → persist.
 *
 * A full declarative screen table lands in Phase 2; keep screen-specific growth
 * out of the eventual driver loop — see docs/plan-reddit-register.md.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const HumanBehavior = require('../../../../shared/HumanBehavior');
const { checkPage: outlookLoggedIn } = require('../../../../platforms/outlook/auth');
const { dismissPrivacyConsent } = require('../../../../platforms/outlook/privacyConsent');
const { readSignedInEmail } = require('../../../../platforms/outlook/identity');
const { waitForRedditOtp, waitForRedditVerifyLink } = require('../../../../platforms/outlook/redditOtp');
const { checkPage: redditLoggedIn } = require('../../../../platforms/reddit/auth');
const { scrub, registerSecret } = require('../../../../shared/redact');
const { createCredentials, appendRedditAccount } = require('../../credentials');

const REPO_ROOT = require('../../../../projectRoot');

const OUTCOMES = {
    OUTLOOK_NOT_LOGGED_IN: 'outlook-not-logged-in',
    REDDIT_CREATED: 'reddit-created',
    ALREADY_REGISTERED: 'already-registered',
    DISCOVERY_PAUSED: 'discovery-paused',
    OTP_TIMEOUT: 'otp-timeout',
    CAPTCHA: 'captcha',
    EMAIL_TAKEN: 'email-taken',
    UNKNOWN: 'unknown',
    PROFILE_START_FAILED: 'profile-start-failed'
};

/** Structure-only DOM dump — never reads input values (passwords).
 *  Walks open shadow roots so faceplate OTP fields show up. */
const COLLECT = () => {
    const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            style.opacity !== '0'
        );
    };

    const isField = (el) => /^(input|textarea|select)$/i.test(el.tagName);

    const hostPath = (el) => {
        const parts = [];
        let node = el;
        for (let i = 0; i < 8 && node; i++) {
            if (node instanceof ShadowRoot) {
                const host = node.host;
                parts.unshift(
                    host.tagName.toLowerCase() +
                    (host.id ? `#${host.id}` : '') +
                    (host.getAttribute('name') ? `[name="${host.getAttribute('name')}"]` : '')
                );
                node = host.parentNode;
            } else {
                node = node.parentNode;
            }
        }
        return parts.join(' >> ');
    };

    const describe = (el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || null,
        name: el.getAttribute('name') || null,
        id: el.id || null,
        placeholder: el.getAttribute('placeholder') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        autocomplete: el.getAttribute('autocomplete') || null,
        inputMode: el.getAttribute('inputmode') || null,
        role: el.getAttribute('role') || null,
        testId: el.getAttribute('data-test-id') || el.getAttribute('data-testid') || null,
        shadowHost: hostPath(el) || null,
        text: isField(el) ? null : (el.innerText || '').trim().slice(0, 80) || null,
        visible: visible(el)
    });

    const deepQuery = (root, selector, out = []) => {
        try {
            out.push(...root.querySelectorAll(selector));
        } catch {
            // ignore
        }
        const walk = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (const el of walk) {
            if (el.shadowRoot) deepQuery(el.shadowRoot, selector, out);
        }
        return out;
    };

    const inputs = deepQuery(document, 'input, textarea, select').map(describe);
    const buttons = deepQuery(document, 'button, input[type="submit"], input[type="button"], [role="button"]')
        .map(describe)
        .filter((b) => b.visible);

    const faceplates = Array.from(document.querySelectorAll('faceplate-text-input, faceplate-tracker, auth-flow, [name="code"], [name="otp"]'))
        .map((el) => ({
            tag: el.tagName.toLowerCase(),
            name: el.getAttribute('name') || null,
            id: el.id || null,
            visible: visible(el),
            hasShadow: Boolean(el.shadowRoot)
        }));

    return {
        title: document.title,
        inputs,
        buttons,
        faceplates,
        headings: deepQuery(document, 'h1, h2, h3, [role="heading"]')
            .filter(visible)
            .map((el) => (el.innerText || '').trim())
            .filter(Boolean)
            .slice(0, 10),
        errors: deepQuery(document, '[role="alert"], .alert-error, [id$="Error"]')
            .filter(visible)
            .map((el) => ({ id: el.id || null, text: (el.innerText || '').trim().slice(0, 200) }))
            .filter((e) => e.text),
        iframes: Array.from(document.querySelectorAll('iframe')).map((el) => ({
            id: el.id || null,
            src: (el.getAttribute('src') || '').slice(0, 120),
            visible: visible(el)
        })),
        bodySample: (document.body ? document.body.innerText : '').slice(0, 1500)
    };
};

class RedditRegisterSession {
    constructor(outlookPage, config) {
        this.outlookPage = outlookPage;
        this.redditPage = null;
        this.config = config;
        this.outlookCfg = config.platforms.outlook;
        this.redditCfg = config.platforms.reddit;
        this.register = config.features.register.reddit;
        this.account = config.account;
        this.human = new HumanBehavior(outlookPage, this.outlookCfg.timing);
        this.scrapedEmail = null;
        this.creds = null;
    }

    redditHuman() {
        return new HumanBehavior(this.redditPage, this.redditCfg.timing);
    }

    gateRetries() {
        return this.register.gateRetries || 4;
    }

    networkBackoffMs(attemptIndex) {
        const list = this.register.networkBackoffMs || [5000, 10000, 20000, 20000];
        return list[Math.min(Math.max(attemptIndex, 0), list.length - 1)];
    }

    isNetworkError(error) {
        const msg = error?.message || String(error || '');
        return /net::|ERR_|Timeout|timeout|INTERNET_DISCONNECTED|PROXY|SOCKS|CONNECTION_FAILED|No internet|offline/i.test(msg);
    }

    async sleepMs(ms) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
    }

    async isOfflinePage(page) {
        try {
            const text = ((await page.evaluate(() => document.body?.innerText || '')) || '').toLowerCase();
            const title = ((await page.title()) || '').toLowerCase();
            return (
                /no internet|there is no internet|err_internet_disconnected|err_proxy|err_connection|dns_probe|offline|unable to connect/i.test(text) ||
                /no internet|offline/.test(title)
            );
        } catch {
            return false;
        }
    }

    async goto(page, url) {
        const timeout = this.redditCfg.timing?.navigationTimeoutMs
            || this.outlookCfg.timing?.navigationTimeoutMs
            || 60000;
        const tries = this.gateRetries();
        let lastError;

        for (let attempt = 1; attempt <= tries; attempt++) {
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
                if (await this.isOfflinePage(page)) {
                    throw new Error('net::ERR_INTERNET_DISCONNECTED (offline interstitial)');
                }
                return;
            } catch (error) {
                lastError = error;
                if (!this.isNetworkError(error)) throw error;
                const wait = this.networkBackoffMs(attempt - 1);
                console.log(
                    `   ⚠️ network blip (${attempt}/${tries}): ${error.message.split('\n')[0]} — ` +
                    `waiting ${Math.round(wait / 1000)}s then retry…`
                );
                await this.sleepMs(wait);
            }
        }
        throw lastError;
    }

    async reloadRedditRegister() {
        const url = this.redditCfg.registerUrl;
        try {
            await this.redditPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (error) {
            if (!this.isNetworkError(error)) throw error;
            await this.goto(this.redditPage, url);
            return;
        }
        if (await this.isOfflinePage(this.redditPage)) {
            await this.goto(this.redditPage, url);
            return;
        }
        await this.settle(this.redditPage);
    }

    async settle(page) {
        const human = page === this.outlookPage
            ? new HumanBehavior(page, this.outlookCfg.timing)
            : this.redditHuman();
        const settle = this.register.settleMs;
        await human.gaussianSleep(settle * 0.7, settle * 1.3);
    }

    async ensureOutlookLoggedIn() {
        console.log('📬 Opening Outlook inbox…');
        await this.goto(this.outlookPage, this.outlookCfg.inboxUrl);
        await this.settle(this.outlookPage);
        await dismissPrivacyConsent(this.outlookPage, this.outlookCfg, this.human);

        const deadline = Date.now() + (this.outlookCfg.timing?.inboxLoadTimeoutMs || 25000);
        while (Date.now() < deadline) {
            await dismissPrivacyConsent(this.outlookPage, this.outlookCfg, this.human);
            if (await outlookLoggedIn(this.outlookPage, this.outlookCfg)) return true;
            await this.human.gaussianSleep(800, 1500);
        }
        return outlookLoggedIn(this.outlookPage, this.outlookCfg);
    }

    async scrapeEmail() {
        console.log('🔎 Reading signed-in email from Outlook UI…');
        const email = await readSignedInEmail(this.outlookPage, this.outlookCfg, {
            preferredEmail: this.account.email
        });
        if (!email) {
            throw new Error('Could not scrape a signed-in email from the Outlook UI');
        }
        this.scrapedEmail = email;
        console.log(`   ↪ scraped email: ${email}`);
        if (this.account.emailKey && email !== this.account.emailKey) {
            console.warn(
                `   ⚠️ scraped email differs from CSV binding (${this.account.email}) — using scraped`
            );
        }
        return email;
    }

    async openRedditRegister() {
        console.log('🆕 Opening Reddit register in a new tab…');
        this.redditPage = await this.outlookPage.context().newPage();
        await this.goto(this.redditPage, this.redditCfg.registerUrl);
        await this.settle(this.redditPage);
        await this.dismissCookieBanner();
    }

    /**
     * Land on a usable register form. Captcha → immediate refresh.
     * Offline / no-internet → wait 5s / 10s / 20s then refresh. Up to gateRetries.
     */
    async waitForRegisterReady() {
        const tries = this.gateRetries();

        for (let attempt = 1; attempt <= tries; attempt++) {
            await this.dismissCookieBanner();

            if (await redditLoggedIn(this.redditPage, this.redditCfg)) {
                return { status: 'already-registered' };
            }

            if (await this.isOfflinePage(this.redditPage)) {
                const wait = this.networkBackoffMs(attempt - 1);
                console.log(
                    `   ⚠️ no internet on Reddit (${attempt}/${tries}) — ` +
                    `waiting ${Math.round(wait / 1000)}s then refresh…`
                );
                await this.sleepMs(wait);
                await this.reloadRedditRegister();
                continue;
            }

            if (await this.isCaptchaGate()) {
                console.log(`   ⚠️ captcha / prove-humanity (${attempt}/${tries}) — refreshing…`);
                await this.reloadRedditRegister();
                continue;
            }

            const taken = await this.detectEmailTakenOnly();
            if (taken) return { status: OUTCOMES.EMAIL_TAKEN };

            if (await this.firstVisible(this.redditCfg.selectors.emailInput.field)) {
                return { status: 'ready' };
            }

            // Odd interstitial / blank — backoff then refresh like a network blip.
            const wait = this.networkBackoffMs(attempt - 1);
            console.log(
                `   ⚠️ register form not ready (${attempt}/${tries}) — ` +
                `waiting ${Math.round(wait / 1000)}s then refresh…`
            );
            await this.sleepMs(wait);
            await this.reloadRedditRegister();
        }

        if (await this.isCaptchaGate()) return { status: OUTCOMES.CAPTCHA };
        if (await this.isOfflinePage(this.redditPage)) {
            return { status: OUTCOMES.UNKNOWN, detail: 'offline after retries' };
        }
        if (!(await this.firstVisible(this.redditCfg.selectors.emailInput.field))) {
            return { status: OUTCOMES.UNKNOWN, detail: 'email field missing after retries' };
        }
        return { status: 'ready' };
    }

    async isCaptchaGate() {
        if (await this.otpFieldVisible()) return false;
        const text = await this.pageText();
        const captchaText = (this.redditCfg.selectors.captcha?.text || []).some((t) =>
            text.includes(String(t).toLowerCase())
        );
        if (captchaText) return true;
        // "Prove your humanity" pages often have no usable email field.
        if (/prove your humanity|prove you are human/.test(text)) return true;
        return false;
    }

    async detectEmailTakenOnly() {
        const text = await this.pageText();
        return (this.redditCfg.selectors.emailTaken?.text || []).some((t) =>
            text.includes(String(t).toLowerCase())
        );
    }

    async dismissCookieBanner() {
        const human = this.redditHuman();
        await human.clickFirstVisible([
            'button:has-text("Reject Optional Cookies")',
            'button:has-text("Accept All")',
            'button:has-text("Accept")'
        ]).catch(() => false);
    }

    async firstVisible(selectorList) {
        const parts = Array.isArray(selectorList)
            ? selectorList
            : String(selectorList).split(',').map((s) => s.trim()).filter(Boolean);
        for (const selector of parts) {
            try {
                const el = await this.redditPage.$(selector);
                if (el && (await el.isVisible())) return { el, selector };
            } catch {
                // try next
            }
        }
        return null;
    }

    async pageText() {
        try {
            return (await this.redditPage.evaluate(() => document.body?.innerText || '')).toLowerCase();
        } catch {
            return '';
        }
    }

    async otpFieldVisible() {
        return Boolean(await this.firstVisible(this.redditCfg.selectors.otpInput.field));
    }

    async detectEarlyTerminal() {
        // OTP screen wins over a dormant reCAPTCHA iframe on the same page.
        if (await this.otpFieldVisible()) return null;

        const text = await this.pageText();
        const taken = (this.redditCfg.selectors.emailTaken?.text || []).some((t) =>
            text.includes(String(t).toLowerCase())
        );
        if (taken) return OUTCOMES.EMAIL_TAKEN;

        const captchaText = (this.redditCfg.selectors.captcha?.text || []).some((t) =>
            text.includes(String(t).toLowerCase())
        );
        if (captchaText) return OUTCOMES.CAPTCHA;

        const captchaSel = this.redditCfg.selectors.captcha?.frame;
        if (captchaSel && (await this.firstVisible(captchaSel))) return OUTCOMES.CAPTCHA;

        return null;
    }

    async submitEmail(email) {
        const fieldSel = this.redditCfg.selectors.emailInput.field;
        const submitSel = this.redditCfg.selectors.emailInput.submit;
        const human = this.redditHuman();

        console.log('⌨️ Typing email into Reddit register…');
        const typed = await human.hesitateBefore(() => human.typeInto(fieldSel, email, { verify: true }));
        if (!typed) {
            throw new Error('Reddit email field not found — update selectors after live inspect');
        }

        await human.gaussianSleep(
            this.redditCfg.timing?.beforeSubmit ?? 500,
            (this.redditCfg.timing?.beforeSubmit ?? 500) + 900
        );

        const chance = this.register.doubleClickRegisterChance ?? 0.45;
        const doubleClick = Math.random() < chance;
        this.usedDoubleClick = doubleClick;

        const hit = await human.firstVisible(submitSel);
        if (doubleClick && hit) {
            console.log('➡️ Double-clicking continue (alt path — may skip OTP)…');
            await human.hesitateBefore(async () => {
                await hit.element.scrollIntoViewIfNeeded().catch(() => {});
                await hit.element.click({ clickCount: 2, delay: 60 + Math.floor(Math.random() * 80) });
            });
        } else if (hit) {
            console.log('➡️ Clicking continue…');
            await human.hesitateBefore(() => human.humanClick(hit.element));
        } else {
            console.log('   (no continue button — pressing Enter)');
            await this.redditPage.keyboard.press('Enter');
        }

        await this.settle(this.redditPage);
        await human.gaussianSleep(1500, 3000);
        await this.dismissCookieBanner();
    }

    /**
     * After email submit: OTP path, username path (no OTP), or terminal.
     */
    async detectPostEmailBranch() {
        const deadline = Date.now() + 45000;
        while (Date.now() < deadline) {
            if (await this.otpFieldVisible()) return 'otp';
            if (await this.firstVisible(this.redditCfg.selectors.usernameInput.field)) {
                return 'username';
            }

            const early = await this.detectEarlyTerminal();
            if (early === OUTCOMES.CAPTCHA || early === OUTCOMES.EMAIL_TAKEN) return early;

            // Soft prompt that still leads to username soon.
            const text = await this.pageText();
            if (/create your username|choose a username|pick a username/.test(text)) {
                return 'username';
            }

            await this.redditHuman().gaussianSleep(800, 1400);
        }
        if (await this.otpFieldVisible()) return 'otp';
        if (await this.firstVisible(this.redditCfg.selectors.usernameInput.field)) return 'username';
        return 'unknown';
    }

    async waitForOtpScreen() {
        const branch = await this.detectPostEmailBranch();
        if (branch === 'otp') return true;
        if (branch === OUTCOMES.CAPTCHA || branch === OUTCOMES.EMAIL_TAKEN) return branch;
        return false;
    }

    async submitOtp(otp) {
        registerSecret(otp);
        await this.redditPage.bringToFront().catch(() => {});
        const human = this.redditHuman();
        const fieldSel = this.redditCfg.selectors.otpInput.field;
        const submitSel = this.redditCfg.selectors.otpInput.submit;

        console.log('⌨️ Typing Reddit OTP…');
        const typed = await human.hesitateBefore(() => human.typeInto(fieldSel, otp, { verify: true }));
        if (!typed) throw new Error('Reddit OTP field not found');

        await human.gaussianSleep(
            this.redditCfg.timing?.beforeSubmit ?? 500,
            (this.redditCfg.timing?.beforeSubmit ?? 500) + 900
        );

        console.log('➡️ Submitting OTP…');
        const clicked = await human.hesitateBefore(() => human.clickFirstVisible(submitSel));
        if (!clicked) await this.redditPage.keyboard.press('Enter');

        await this.settle(this.redditPage);
        await human.gaussianSleep(1500, 3000);
    }

    async completeUsernamePassword() {
        if (!this.creds) this.creds = createCredentials(this.scrapedEmail);
        const human = this.redditHuman();
        const deadline = Date.now() + 240000;
        const userSel = this.redditCfg.selectors.usernameInput.field;
        const passSel = this.redditCfg.selectors.passwordInput.field;
        const submitSel = this.redditCfg.selectors.submitRegister.button;
        const about = this.redditCfg.selectors.aboutYou || {};

        console.log(`👤 Completing onboarding as ${this.creds.username}…`);

        while (Date.now() < deadline) {
            if (await redditLoggedIn(this.redditPage, this.redditCfg)) {
                return OUTCOMES.REDDIT_CREATED;
            }

            const userVisible = await this.firstVisible(userSel);
            const passVisible = await this.firstVisible(passSel);
            const dayVisible = about.day ? await this.firstVisible(about.day) : null;

            if (dayVisible) {
                // Current Reddit About-you: Month → Day → Year, then Confirm birthday.
                try {
                    const age = this.randomUnder18Dob();
                    console.log(`   ↪ About you — DOB month=${age.month} day=${age.day} year=${age.year}`);
                    await this.fillRedditField(human, about.month, age.month);
                    await human.gaussianSleep(350, 700);
                    await this.fillRedditField(human, about.day, age.day);
                    await human.gaussianSleep(350, 700);
                    await this.fillRedditField(human, about.year, age.year);
                    await human.gaussianSleep(800, 1400);
                    await this.redditPage.keyboard.press('Tab').catch(() => {});
                    await human.gaussianSleep(400, 800);

                    await this.waitForEnabled(about.submit || '#age-collect-submit-btn', 8000);
                    const clicked = await this.safeClick(
                        human,
                        about.submit || '#age-collect-submit-btn'
                    );
                    if (!clicked) await this.redditPage.keyboard.press('Enter').catch(() => {});
                    await this.settle(this.redditPage);
                    await human.gaussianSleep(1200, 2200);

                    if (await this.isAgeConfirmScreen()) {
                        console.log('   ↪ confirming birthday…');
                        await this.safeClick(
                            human,
                            about.confirm || ['button:has-text("Yes, Confirm")']
                        );
                        await this.settle(this.redditPage);
                        await human.gaussianSleep(1500, 2800);
                    }
                } catch (err) {
                    console.log(`   ⚠️ About-you step: ${err.message.split('\n')[0]}`);
                    await human.gaussianSleep(1200, 2000);
                }
                continue;
            }

            if (userVisible || passVisible) {
                try {
                    if (userVisible) {
                        console.log(`   ↪ typing username: ${this.creds.username}`);
                        await this.fillRedditField(human, userSel, this.creds.username);
                    }

                    await human.gaussianSleep(
                        this.redditCfg.timing?.betweenFields ?? 700,
                        (this.redditCfg.timing?.betweenFields ?? 700) + 800
                    );

                    if (passVisible) {
                        await this.fillRedditField(human, passSel, this.creds.password);
                    }

                    await human.gaussianSleep(
                        this.redditCfg.timing?.beforeSubmit ?? 500,
                        (this.redditCfg.timing?.beforeSubmit ?? 500) + 900
                    );

                    // Avoid clicking a hidden OTP "Continue" still in the DOM.
                    const credSubmit = [
                        '#register-username-submit',
                        'button[type="submit"]:visible',
                        ...(Array.isArray(submitSel) ? submitSel : [submitSel])
                    ];
                    const clicked = await this.safeClick(human, credSubmit);
                    if (!clicked) await this.redditPage.keyboard.press('Enter').catch(() => {});
                    await this.settle(this.redditPage);
                    await human.gaussianSleep(1500, 3000);
                } catch (err) {
                    console.log(`   ⚠️ username/password step: ${err.message.split('\n')[0]}`);
                    await human.gaussianSleep(1200, 2000);
                }
                continue;
            }

            // Gender → interests → customize feed (onboarding-flow HTML dumps).
            if (await this.tryPickGender(human)) {
                await this.settle(this.redditPage);
                await human.gaussianSleep(1200, 2200);
                continue;
            }

            if (await this.isInterestsScreen()) {
                await this.pickRandomInterests(human);
                await this.settle(this.redditPage);
                await human.gaussianSleep(1500, 2800);
                continue;
            }

            if (await this.isCustomizeFeedScreen()) {
                await this.handleCustomizeFeed(human);
                await this.settle(this.redditPage);
                await human.gaussianSleep(1500, 2800);
                continue;
            }

            // Spinner: Personalizing your experience
            if (await this.isPersonalizingScreen()) {
                console.log('   ↪ personalizing spinner — waiting…');
                await human.gaussianSleep(2500, 4500);
                continue;
            }

            const advanced = await this.advanceInterstitial(human);
            if (!advanced) {
                await human.gaussianSleep(1500, 2500);
            } else {
                await this.settle(this.redditPage);
                await human.gaussianSleep(1200, 2200);
            }
        }

        if (await redditLoggedIn(this.redditPage, this.redditCfg)) {
            return OUTCOMES.REDDIT_CREATED;
        }
        return OUTCOMES.UNKNOWN;
    }

    async waitForEnabled(selectorList, timeoutMs = 8000) {
        const parts = Array.isArray(selectorList) ? selectorList : [selectorList];
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            for (const sel of parts) {
                try {
                    const el = await this.redditPage.$(sel);
                    if (el && (await el.isVisible()) && !(await el.isDisabled())) return true;
                } catch {
                    // try next
                }
            }
            await this.redditHuman().gaussianSleep(200, 400);
        }
        return false;
    }

    /** Type via HumanBehavior; on visibility/humanize errors, fall back to locator.fill. */
    async fillRedditField(human, selectors, text) {
        try {
            const ok = await human.typeInto(selectors, text, { verify: false });
            if (ok) return true;
        } catch {
            // fall through
        }

        const list = Array.isArray(selectors) ? selectors : [selectors];
        for (const sel of list) {
            if (!sel) continue;
            try {
                const loc = this.redditPage.locator(sel).first();
                if ((await loc.count()) === 0) continue;
                if (!(await loc.isVisible().catch(() => false))) continue;
                await loc.click({ force: true }).catch(() => {});
                await loc.fill('');
                await loc.fill(String(text));
                return true;
            } catch {
                // try next selector
            }
        }
        return false;
    }

    async safeClick(human, selectors) {
        try {
            return await human.hesitateBefore(() => human.clickFirstVisible(selectors));
        } catch {
            const list = Array.isArray(selectors) ? selectors : [selectors];
            for (const sel of list) {
                if (!sel) continue;
                try {
                    const loc = this.redditPage.locator(sel).first();
                    if ((await loc.count()) === 0) continue;
                    if (!(await loc.isVisible().catch(() => false))) continue;
                    await loc.click({ force: true });
                    return true;
                } catch {
                    // try next
                }
            }
            return false;
        }
    }

    async isAgeConfirmScreen() {
        const text = await this.pageText();
        if (/confirm your birthday/.test(text)) return true;
        return Boolean(await this.firstVisible(
            this.redditCfg.selectors.aboutYou?.confirm || ['button:has-text("Yes, Confirm")']
        ));
    }

    async isInterestsScreen() {
        if (await this.firstVisible(
            this.redditCfg.selectors.interests?.modal ||
            'auth-flow-modal[pagename="parent_interest_picker"]'
        )) return true;
        if (await this.firstVisible(
            this.redditCfg.selectors.interests?.topicsRoot || '#parent-topics'
        )) return true;
        if (await this.firstVisible(
            this.redditCfg.selectors.interests?.submit || '#parent-interest-picker-submit-button'
        )) return true;
        const text = await this.pageText();
        if (/choose your interests/.test(text)) return true;
        return Boolean(await this.firstVisible(
            this.redditCfg.selectors.interests?.checkbox || 'input[name="parent-topic-id"]'
        ));
    }

    async isCustomizeFeedScreen() {
        const cfg = this.redditCfg.selectors.customizeFeed || {};
        if (await this.firstVisible(cfg.dialog || ['[aria-label="Customize your feed"]'])) {
            return true;
        }
        const text = await this.pageText();
        return (cfg.heading || ['customize your feed']).some((t) =>
            text.includes(String(t).toLowerCase())
        );
    }

    async isPersonalizingScreen() {
        const text = await this.pageText();
        return (this.redditCfg.selectors.personalizing?.text || []).some((t) =>
            text.includes(String(t).toLowerCase())
        );
    }

    async pickRandomInterests(human) {
        const cfg = this.redditCfg.selectors.interests || {};
        const ids = [...(cfg.topicIds || [])];

        // Variant with_skip_button (see all.html) — rarely Skip instead of picking.
        if (
            Math.random() < (this.register.interestSkipChance ?? 0.1) &&
            cfg.skip &&
            (await human.clickFirstVisible(cfg.skip))
        ) {
            console.log('   ↪ skipped interests');
            return;
        }

        const min = this.register.interestPickMin ?? 2;
        const max = this.register.interestPickMax ?? 5;
        const count = Math.min(
            ids.length,
            min + Math.floor(Math.random() * (Math.max(max, min) - min + 1))
        );

        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        const picked = ids.slice(0, count);
        console.log(`   ↪ interests (${picked.length}): ${picked.join(', ')}`);

        for (const id of picked) {
            // Prefer the visible topic tile (checkbox is sr-only).
            const clicked =
                (await human.clickFirstVisible(`label[for="${id}"]`)) ||
                (await human.clickFirstVisible(`.topic-container:has(#${id})`));
            if (!clicked) {
                try {
                    await this.redditPage.check(`#${id}`, { force: true });
                } catch {
                    // ignore one miss
                }
            }
            await human.gaussianSleep(250, 600);
        }

        await this.waitForEnabled(cfg.submit || '#parent-interest-picker-submit-button', 8000);
        await human.hesitateBefore(() =>
            human.clickFirstVisible(cfg.submit || '#parent-interest-picker-submit-button')
        );
    }

    async handleCustomizeFeed(human) {
        const cfg = this.redditCfg.selectors.customizeFeed || {};

        if (
            Math.random() < (this.register.customizeFeedSkipChance ?? 0.3) &&
            cfg.skip &&
            (await human.clickFirstVisible(cfg.skip))
        ) {
            console.log('   ↪ skipped customize feed');
            return;
        }

        // Dump was shell-only — pick whatever community controls are live.
        const min = this.register.customizeFeedPickMin ?? 2;
        const max = this.register.customizeFeedPickMax ?? 5;
        const want = min + Math.floor(Math.random() * (Math.max(max, min) - min + 1));
        let picked = 0;

        try {
            const boxes = await this.redditPage.$$(
                '[aria-label="Customize your feed"] input[type="checkbox"], ' +
                '[role="dialog"][aria-label="Customize your feed"] input[type="checkbox"]'
            );
            const order = boxes.map((_, i) => i).sort(() => Math.random() - 0.5);
            for (const i of order) {
                if (picked >= want) break;
                const el = boxes[i];
                if (!el || !(await el.isVisible().catch(() => false))) continue;
                const checked = await el.isChecked().catch(() => false);
                if (checked) continue;
                await human.humanClick(el).catch(async () => {
                    await el.click({ force: true }).catch(() => {});
                });
                picked += 1;
                await human.gaussianSleep(200, 500);
            }
        } catch {
            // fall through to Follow / label clicks
        }

        if (picked < want && cfg.pick) {
            for (let n = picked; n < want; n++) {
                if (!(await human.clickFirstVisible(cfg.pick))) break;
                picked += 1;
                await human.gaussianSleep(200, 500);
            }
        }

        console.log(`   ↪ customize feed — selected ~${picked}, continuing…`);
        await human.gaussianSleep(400, 900);

        const submitted = await human.hesitateBefore(() =>
            human.clickFirstVisible(cfg.submit || ['button:has-text("Continue")'])
        );
        if (!submitted && cfg.skip) {
            await human.clickFirstVisible(cfg.skip);
        }
    }

    async tryPickGender(human) {
        const g = this.redditCfg.selectors.gender || {};
        const opts = g.options || [];
        if (!opts.length) return false;

        const text = await this.pageText();
        const onGender =
            /how do you identify|gender/.test(text) ||
            Boolean(await this.firstVisible(g.question || '#gender-selection-question')) ||
            Boolean(await human.firstVisible(opts));
        if (!onGender) return false;

        const skipChance = this.register.genderSkipChance ?? 0.25;
        if (Math.random() < skipChance && g.skip) {
            if (await human.clickFirstVisible(g.skip)) {
                console.log('   ↪ skipped gender');
                return true;
            }
        }

        const labels = {
            FEMALE: 'Woman',
            MALE: 'Man',
            NON_BINARY: 'Non-binary',
            OPT_OUT: 'prefer not to say'
        };
        const shuffled = [...opts].sort(() => Math.random() - 0.5);
        for (const sel of shuffled) {
            if (await human.clickFirstVisible(sel)) {
                const key = Object.keys(labels).find((k) => sel.includes(`value="${k}"`));
                console.log(`   ↪ picked gender: ${labels[key] || 'option'}`);
                // Options are type=submit — they advance themselves.
                return true;
            }
        }

        if (g.skip && (await human.clickFirstVisible(g.skip))) {
            console.log('   ↪ skipped gender (fallback)');
            return true;
        }
        return false;
    }

    async advanceInterstitial(human) {
        const skip = this.redditCfg.selectors.interstitial?.skip || [
            'button:has-text("Skip")',
            'button:has-text("Skip for now")'
        ];
        const cont = this.redditCfg.selectors.interstitial?.continue || [
            'button:has-text("Continue")',
            'button:has-text("Next")'
        ];

        // Randomize: sometimes Skip, sometimes Continue when both exist.
        const preferSkip = Math.random() < (this.register.interstitialSkipChance ?? 0.55);
        if (preferSkip) {
            if (await human.clickFirstVisible(skip)) {
                console.log('   ↪ skipped interstitial');
                return true;
            }
            if (await human.clickFirstVisible(cont)) {
                console.log('   ↪ continued interstitial');
                return true;
            }
        } else {
            if (await human.clickFirstVisible(cont)) {
                console.log('   ↪ continued interstitial');
                return true;
            }
            if (await human.clickFirstVisible(skip)) {
                console.log('   ↪ skipped interstitial');
                return true;
            }
        }
        return false;
    }

    async looksLikeVerifyEmailPrompt() {
        const text = await this.pageText();
        return (this.redditCfg.selectors.verifyEmailPrompt?.text || []).some((t) =>
            text.includes(String(t).toLowerCase())
        );
    }

    /**
     * Link-verify path: open Reddit's confirmation link from Outlook.
     */
    async verifyViaEmailLink(issuedAfter) {
        const href = await waitForRedditVerifyLink(this.outlookPage, this.outlookCfg, {
            issuedAfter,
            timeoutMs: this.register.verifyLinkTimeoutMs || this.register.otpTimeoutMs || 180000
        });

        if (!href) {
            return {
                ok: false,
                detail: 'Reddit verify link not found in Outlook'
            };
        }

        console.log('🔗 Opening Reddit verify link…');
        await this.redditPage.bringToFront().catch(() => {});
        try {
            await this.goto(this.redditPage, href);
        } catch (error) {
            // Some links open a new tab via Outlook; fall back to context page.
            const page = await this.outlookPage.context().newPage();
            await this.goto(page, href);
            this.redditPage = page;
        }
        await this.settle(this.redditPage);
        await this.redditHuman().gaussianSleep(2000, 4000);

        // Drain any leftover onboarding after the link.
        const finish = await this.completeUsernamePassword();
        if (finish === OUTCOMES.REDDIT_CREATED || (await redditLoggedIn(this.redditPage, this.redditCfg))) {
            return { ok: true, detail: 'verified via email link' };
        }
        return { ok: false, detail: 'opened verify link but not logged in yet' };
    }

    /** Random DOB that is always under 18 (as of the current year). */
    randomUnder18Dob() {
        const now = new Date();
        const maxYear = now.getFullYear() - 13; // Reddit often wants 13+
        const minYear = now.getFullYear() - 17; // still under 18
        const year = String(minYear + Math.floor(Math.random() * (maxYear - minYear + 1)));
        const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
        const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
        return { day, month, year };
    }

    async readFieldValue(selectorList) {
        const hit = await this.firstVisible(selectorList);
        if (!hit) return null;
        try {
            return await hit.el.inputValue();
        } catch {
            return null;
        }
    }

    async dumpDiagnostics(label) {
        const dir = path.join(REPO_ROOT, 'diagnostics');
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safe = (this.scrapedEmail || this.account.email || 'unknown')
            .replace(/[^a-z0-9]/gi, '_')
            .slice(0, 40);
        const base = path.join(dir, `${stamp}-reddit-${safe}-${label}`);

        let dom = {};
        try {
            dom = await this.redditPage.evaluate(COLLECT);
        } catch (error) {
            dom = { error: scrub(error.message) };
        }

        const snapshot = {
            label,
            url: this.redditPage.url(),
            scrapedEmail: this.scrapedEmail,
            csvEmail: this.account.email,
            profileId: this.account.profileId,
            redditUsername: this.creds?.username || null,
            ...dom
        };

        const jsonPath = `${base}.json`;
        fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2));

        const shotDir = path.join(REPO_ROOT, 'screenshots');
        fs.mkdirSync(shotDir, { recursive: true });
        const shotPath = path.join(shotDir, path.basename(base) + '.png');
        try {
            await this.redditPage.screenshot({ path: shotPath, fullPage: true });
        } catch (error) {
            console.warn(`⚠️ Screenshot failed: ${scrub(error.message)}`);
        }

        console.log(`\n📄 Diagnostics: ${jsonPath}`);
        if (fs.existsSync(shotPath)) console.log(`🖼  Screenshot: ${shotPath}`);

        console.log('\n—— Reddit DOM summary ——');
        console.log(`URL: ${snapshot.url}`);
        console.log(`Title: ${dom.title || '(none)'}`);
        if (dom.headings?.length) console.log(`Headings: ${dom.headings.join(' | ')}`);
        if (dom.inputs?.length) {
            console.log('Inputs (incl. shadow DOM):');
            for (const i of dom.inputs.filter((x) => x.visible || /code|otp|email|user|pass/i.test(`${x.name}${x.id}${x.autocomplete}${x.shadowHost}`))) {
                console.log(
                    `  - <${i.tag}> type=${i.type} name=${i.name} id=${i.id} ` +
                    `auto=${i.autocomplete} mode=${i.inputMode} visible=${i.visible} ` +
                    `host=${i.shadowHost || '-'}`
                );
            }
        }
        if (dom.buttons?.length) {
            console.log('Visible buttons:');
            for (const b of dom.buttons.slice(0, 15)) {
                console.log(`  - ${b.text || b.ariaLabel || b.testId || b.id || b.tag}  id=${b.id || '-'}`);
            }
        }
        console.log('—— end summary ——\n');

        return { jsonPath, shotPath };
    }

    async pauseForDiscovery(reason = 'inspect live browser') {
        if (!this.register.pauseAfterComplete) return;
        const ms = this.register.discoveryPauseMs || 30 * 60 * 1000;
        console.log(
            `\n⏸  Pause (${reason}) — Press Enter to close the profile ` +
            `(or wait ${Math.round(ms / 60000)} min).\n`
        );

        await new Promise((resolve) => {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const timer = setTimeout(() => {
                rl.close();
                resolve();
            }, ms);

            rl.question('', () => {
                clearTimeout(timer);
                rl.close();
                resolve();
            });
        });
    }

    async run() {
        try {
            const loggedIn = await this.ensureOutlookLoggedIn();
            if (!loggedIn) {
                return {
                    outcome: OUTCOMES.OUTLOOK_NOT_LOGGED_IN,
                    detail: 'Outlook session is not alive — login first (npm start)'
                };
            }

            await this.scrapeEmail();
            await this.openRedditRegister();

            if (await redditLoggedIn(this.redditPage, this.redditCfg)) {
                await this.dumpDiagnostics('already-registered');
                await this.pauseForDiscovery('already registered');
                return {
                    outcome: OUTCOMES.ALREADY_REGISTERED,
                    detail: 'Reddit session already logged in',
                    email: this.scrapedEmail
                };
            }

            const gate = await this.waitForRegisterReady();
            if (gate.status === 'already-registered') {
                await this.dumpDiagnostics('already-registered');
                await this.pauseForDiscovery('already registered');
                return {
                    outcome: OUTCOMES.ALREADY_REGISTERED,
                    detail: 'Reddit session already logged in',
                    email: this.scrapedEmail
                };
            }
            if (gate.status !== 'ready') {
                await this.dumpDiagnostics(gate.status);
                await this.pauseForDiscovery(gate.status);
                return {
                    outcome: gate.status,
                    detail: gate.detail || 'blocked before email step after retries',
                    email: this.scrapedEmail
                };
            }

            const issuedAfter = Date.now() - 5000;
            await this.submitEmail(this.scrapedEmail);

            const branch = await this.detectPostEmailBranch();
            console.log(`   ↪ post-email branch: ${branch}` +
                (this.usedDoubleClick ? ' (double-click used)' : ''));

            if (branch === OUTCOMES.CAPTCHA || branch === OUTCOMES.EMAIL_TAKEN) {
                await this.dumpDiagnostics(branch);
                await this.pauseForDiscovery(branch);
                return { outcome: branch, detail: 'detected after email submit', email: this.scrapedEmail };
            }

            await this.dumpDiagnostics(branch === 'otp' ? 'post-email-otp' : `post-email-${branch}`);

            let finish = OUTCOMES.UNKNOWN;
            let detail = '';

            if (branch === 'otp') {
                const otp = await waitForRedditOtp(this.outlookPage, this.outlookCfg, {
                    issuedAfter,
                    timeoutMs: this.register.otpTimeoutMs || 180000
                });

                if (!otp) {
                    await this.redditPage.bringToFront().catch(() => {});
                    await this.dumpDiagnostics('otp-timeout');
                    await this.pauseForDiscovery('otp timeout');
                    return {
                        outcome: OUTCOMES.OTP_TIMEOUT,
                        detail: 'Reddit verification mail / code not found in Outlook',
                        email: this.scrapedEmail
                    };
                }

                await this.submitOtp(otp);
                await this.dumpDiagnostics('post-otp');
                finish = await this.completeUsernamePassword();
                detail = finish === OUTCOMES.REDDIT_CREATED
                    ? `otp-path username=${this.creds?.username}`
                    : 'otp-path onboarding incomplete';
            } else if (branch === 'username') {
                // Double-click / alt path: create account without OTP, then verify via link.
                console.log('🧭 Alt register path — username/password without OTP…');
                finish = await this.completeUsernamePassword();

                if (finish !== OUTCOMES.REDDIT_CREATED || (await this.looksLikeVerifyEmailPrompt())) {
                    const linkResult = await this.verifyViaEmailLink(issuedAfter);
                    if (linkResult.ok) {
                        finish = OUTCOMES.REDDIT_CREATED;
                        detail = `link-path username=${this.creds?.username}`;
                    } else if (finish === OUTCOMES.REDDIT_CREATED) {
                        detail = `link-path username=${this.creds?.username} (logged in; link optional)`;
                    } else {
                        detail = linkResult.detail || 'link-path incomplete';
                    }
                } else {
                    detail = `link-path username=${this.creds?.username}`;
                }
                await this.dumpDiagnostics(finish === OUTCOMES.REDDIT_CREATED ? 'created' : 'post-link');
            } else {
                await this.pauseForDiscovery('unknown post-email');
                return {
                    outcome: OUTCOMES.UNKNOWN,
                    detail: 'Neither OTP nor username screen after email submit',
                    email: this.scrapedEmail
                };
            }

            await this.dumpDiagnostics(finish === OUTCOMES.REDDIT_CREATED ? 'created' : 'post-creds');

            if (this.creds) {
                appendRedditAccount({
                    profileId: this.account.profileId,
                    outlookEmail: this.scrapedEmail,
                    redditUsername: this.creds.username,
                    redditPassword: this.creds.password,
                    outcome: finish,
                    detail: detail || (finish === OUTCOMES.REDDIT_CREATED
                        ? 'register complete'
                        : 'stopped after credentials')
                });
                console.log(`💾 Appended data/reddit-accounts.csv (${this.creds.username})`);
            }

            await this.pauseForDiscovery(finish);

            return {
                outcome: finish,
                detail: detail || (finish === OUTCOMES.REDDIT_CREATED
                    ? `username=${this.creds?.username}`
                    : 'onboarding did not reach logged-in'),
                email: this.scrapedEmail,
                username: this.creds?.username || null
            };
        } catch (error) {
            console.error(`❌ Register failed: ${scrub(error.message)}`);
            if (this.redditPage) {
                try {
                    await this.dumpDiagnostics('error');
                } catch {
                    // ignore
                }
            }
            return {
                outcome: OUTCOMES.UNKNOWN,
                detail: scrub(error.message),
                email: this.scrapedEmail
            };
        }
    }
}

module.exports = RedditRegisterSession;
module.exports.OUTCOMES = OUTCOMES;
