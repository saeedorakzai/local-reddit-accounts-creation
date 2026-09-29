/**
 * Read the signed-in email from the Outlook web UI.
 *
 * Flow:
 *   1) Dismiss privacy consent if present
 *   2) Read Me-menu fields if already open
 *   3) Click Me avatar → `#mectrl_currentAccount_secondary`
 *   4) Last resort: widen viewport/window, read left sidebar / folder pane,
 *      retry Me menu, then full-page sweep
 *
 * Selectors: src/config/platforms/outlook.js → selectors.identity
 */

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const { dismissPrivacyConsent } = require('./privacyConsent');

function normalizeEmail(value) {
    if (!value || typeof value !== 'string') return null;
    const match = value.match(EMAIL_RE);
    return match ? match[0].toLowerCase() : null;
}

function emailFromHref(href) {
    if (!href) return null;
    try {
        const u = new URL(href, 'https://account.microsoft.com');
        const fromQuery = u.searchParams.get('username');
        if (fromQuery) return normalizeEmail(decodeURIComponent(fromQuery));
    } catch {
        // fall through
    }
    const m = String(href).match(/username=([^&]+)/i);
    return m ? normalizeEmail(decodeURIComponent(m[1])) : null;
}

function pickBestEmail(candidates, preferredKey = null) {
    const unique = [];
    const seen = new Set();
    for (const raw of candidates) {
        const email = normalizeEmail(raw);
        if (!email || seen.has(email)) continue;
        seen.add(email);
        unique.push(email);
    }
    if (!unique.length) return null;
    if (preferredKey) {
        const hit = unique.find((e) => e === preferredKey);
        if (hit) return hit;
    }
    const ms = unique.find((e) => /@(outlook|hotmail|live|msn)\./i.test(e));
    return ms || unique[0];
}

function splitSelectors(value) {
    if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
    return String(value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

async function readTextEmail(el) {
    if (!el) return null;
    const text =
        (await el.innerText().catch(() => '')) ||
        (await el.textContent().catch(() => '')) ||
        (await el.getAttribute('title')) ||
        (await el.getAttribute('aria-label')) ||
        '';
    const fromText = normalizeEmail(text);
    if (fromText) return fromText;
    const href = (await el.getAttribute('href').catch(() => null)) || '';
    return emailFromHref(href);
}

async function readFromEmailFields(page, selectors) {
    for (const selector of selectors) {
        try {
            const el = await page.$(selector);
            if (!el) continue;
            // Prefer visible, but allow DOM-only Me-menu nodes.
            const email = await readTextEmail(el);
            if (email) return email;
        } catch {
            // try next
        }
    }
    return null;
}

async function openMeMenu(page, identity, humanPause) {
    const menuTriggers = splitSelectors(identity.menuButton);
    for (const selector of menuTriggers) {
        try {
            const btn = await page.$(selector);
            if (!btn || !(await btn.isVisible().catch(() => false))) continue;
            await btn.scrollIntoViewIfNeeded().catch(() => {});
            await btn.click({ delay: 40 + Math.floor(Math.random() * 80) });
            console.log('   ↪ opened Outlook Me / account control');
            await humanPause(800, 1600);
            return true;
        } catch {
            // try next
        }
    }
    return false;
}

async function waitForMeMenu(page, identity) {
    const ready = splitSelectors(identity.menuReady);
    const timeout = identity.menuOpenWaitMs || 12000;
    if (!ready.length) {
        await new Promise((r) => setTimeout(r, 2000));
        return;
    }
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const selector of ready) {
            try {
                const el = await page.$(selector);
                if (el && (await el.isVisible().catch(() => false))) return;
            } catch {
                // try next
            }
        }
        await new Promise((r) => setTimeout(r, 400));
    }
}

async function widenWindow(page, identity) {
    const size = identity.wideViewport || { width: 1440, height: 900 };
    const width = size.width || 1440;
    const height = size.height || 900;

    console.log(`   ↪ widening Outlook window to ${width}x${height} for sidebar identity…`);

    try {
        await page.setViewportSize({ width, height });
    } catch {
        // some AdsPower builds ignore viewport — still try CDP window bounds
    }

    try {
        const client = await page.context().newCDPSession(page);
        const { windowId } = await client.send('Browser.getWindowForTarget');
        await client.send('Browser.setWindowBounds', {
            windowId,
            bounds: { width, height, windowState: 'normal' }
        });
    } catch {
        // Firefox / restricted CDP — viewport alone may still reflow Outlook
    }

    await new Promise((r) => setTimeout(r, 1500));
}

async function sweepSidebarEmails(page, identity) {
    const roots = splitSelectors(identity.sidebarRoot);
    try {
        return await page.evaluate((rootSelectors) => {
            const re = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
            const out = [];
            const roots = rootSelectors
                .map((s) => {
                    try {
                        return document.querySelector(s);
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean);

            const targets = roots.length ? roots : [document.body];
            for (const root of targets) {
                for (const el of root.querySelectorAll(
                    '[title*="@"], [aria-label*="@"], [data-email], a[href*="username="]'
                )) {
                    out.push(
                        el.getAttribute('title') ||
                        el.getAttribute('aria-label') ||
                        el.getAttribute('data-email') ||
                        el.getAttribute('href') ||
                        ''
                    );
                }
                const text = root.innerText || '';
                out.push(...(text.match(re) || []));
            }
            return out;
        }, roots);
    } catch {
        return [];
    }
}

async function sweepPageEmails(page) {
    try {
        return await page.evaluate(() => {
            const out = [];
            for (const el of document.querySelectorAll(
                '[title*="@"], [aria-label*="@"], [data-email], a[href*="username="]'
            )) {
                out.push(
                    el.getAttribute('title') ||
                    el.getAttribute('aria-label') ||
                    el.getAttribute('data-email') ||
                    el.getAttribute('href') ||
                    ''
                );
            }
            const secondary = document.querySelector('#mectrl_currentAccount_secondary');
            if (secondary) out.push(secondary.innerText || secondary.textContent || '');
            const body = document.body ? document.body.innerText : '';
            const re = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
            return out.concat(body.match(re) || []);
        });
    } catch {
        return [];
    }
}

async function tryMeMenuPath(page, cfg, identity, emailFields, humanPause) {
    await dismissPrivacyConsent(page, cfg);

    let email = await readFromEmailFields(page, emailFields);
    if (email) return email;

    let opened = await openMeMenu(page, identity, humanPause);
    if (!opened && (await dismissPrivacyConsent(page, cfg))) {
        opened = await openMeMenu(page, identity, humanPause);
    }
    if (opened) await waitForMeMenu(page, identity);
    else await humanPause(500, 900);

    await dismissPrivacyConsent(page, cfg);

    email = await readFromEmailFields(page, emailFields);
    if (email) return email;

    try {
        const secondary = await page.$('#mectrl_currentAccount_secondary');
        if (secondary) {
            const text =
                (await secondary.innerText().catch(() => '')) ||
                (await secondary.textContent().catch(() => ''));
            email = normalizeEmail(text);
            if (email) return email;
        }
    } catch {
        // fall through
    }
    return null;
}

/**
 * @param {import('playwright').Page} page
 * @param {object} cfg  platforms.outlook
 * @param {{ preferredEmail?: string }} [opts]
 * @returns {Promise<string|null>} lowercase email or null
 */
async function readSignedInEmail(page, cfg, opts = {}) {
    const preferredKey = opts.preferredEmail
        ? String(opts.preferredEmail).replace(/^'/, '').toLowerCase()
        : null;
    const identity = cfg.selectors.identity || {};
    const humanPause = async (lo, hi) => {
        const ms = Math.floor(Math.random() * (hi - lo + 1)) + lo;
        await new Promise((r) => setTimeout(r, ms));
    };
    const emailFields = splitSelectors(identity.emailField);

    // 1–3) Me control path
    let email = await tryMeMenuPath(page, cfg, identity, emailFields, humanPause);
    if (email) return email;

    // 4) Widen window / viewport so left sidebar chrome can show the address
    await widenWindow(page, identity);
    await dismissPrivacyConsent(page, cfg);
    await humanPause(1000, 1800);

    email = await readFromEmailFields(page, splitSelectors(identity.sidebarEmail));
    if (email) {
        console.log('   ↪ email from widened left sidebar');
        return email;
    }

    const sidebarHits = await sweepSidebarEmails(page, identity);
    email = pickBestEmail(sidebarHits, preferredKey);
    if (email) {
        console.log('   ↪ email from sidebar sweep after widen');
        return email;
    }

    // Me control may work only after layout reflow
    email = await tryMeMenuPath(page, cfg, identity, emailFields, humanPause);
    if (email) return email;

    const candidates = await sweepPageEmails(page);
    email = pickBestEmail(candidates, preferredKey);
    if (email) return email;

    // Last resort when inbox is confirmed live: CSV binding (logged clearly).
    if (preferredKey && /@(outlook|hotmail|live|msn)\./i.test(preferredKey)) {
        console.warn(`   ⚠️ UI scrape empty after widen — using CSV email ${preferredKey}`);
        return preferredKey;
    }

    return null;
}

module.exports = {
    readSignedInEmail,
    normalizeEmail,
    pickBestEmail
};
