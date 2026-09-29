/**
 * Read a Reddit verification OTP from the Outlook web inbox (same browser).
 *
 * No Graph/IMAP — the AdsPower profile is already signed into Outlook.
 * Selectors live in platforms.outlook.selectors.redditOtp.
 */

const HumanBehavior = require('../../shared/HumanBehavior');

const OTP_RE = /\b(\d{6})\b/g;

function extractOtpFromText(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    const preferred = [];
    const fallback = [];

    let match;
    const re = /\b(\d{6})\b/g;
    while ((match = re.exec(text)) !== null) {
        const code = match[1];
        const idx = match.index;
        // Skip CSS hex colours like #ff00aa — not bare 6-digit codes.
        if (idx > 0 && text[idx - 1] === '#') continue;
        const window = lower.slice(Math.max(0, idx - 40), idx + 46);
        if (/code|verif|confirm|reddit|otp|one.?time/.test(window)) {
            preferred.push(code);
        } else {
            fallback.push(code);
        }
    }
    return preferred[0] || fallback[0] || null;
}

function looksLikeRedditMail(text) {
    const t = (text || '').toLowerCase();
    return /reddit/.test(t) && (/verif|confirm|code|sign.?up|register/.test(t) || /\b\d{6}\b/.test(t));
}

/**
 * @param {import('playwright').Page} page  Outlook tab
 * @param {object} cfg  platforms.outlook
 * @param {{ issuedAfter?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<string|null>}
 */
async function waitForRedditOtp(page, cfg, opts = {}) {
    const otpCfg = cfg.selectors.redditOtp || {};
    const timeoutMs = opts.timeoutMs || 180000;
    const issuedAfter = opts.issuedAfter || Date.now() - 5000;
    const human = new HumanBehavior(page, cfg.timing);
    const deadline = Date.now() + timeoutMs;

    console.log('📬 Switching to Outlook to wait for Reddit OTP…');
    await page.bringToFront().catch(() => {});

    // Land on inbox (fresh list). Avoid wiping search state forever — just open mail.
    try {
        await page.goto(cfg.inboxUrl, { waitUntil: 'domcontentloaded', timeout: cfg.timing?.navigationTimeoutMs || 45000 });
    } catch {
        // keep going — page may already be on inbox
    }
    await human.gaussianSleep(1500, 2800);

    // Optional search narrows the list when the mailbox is noisy.
    if (otpCfg.searchBox && otpCfg.searchQuery) {
        try {
            const box = await page.$(otpCfg.searchBox);
            if (box && (await box.isVisible())) {
                await human.humanClick(box);
                await human.clearField(box);
                await box.type(otpCfg.searchQuery, { delay: human.timing?.typeDelay || 80 });
                await page.keyboard.press('Enter');
                await human.gaussianSleep(1500, 2800);
            }
        } catch {
            // search is best-effort
        }
    }

    let attempt = 0;
    while (Date.now() < deadline) {
        attempt += 1;
        console.log(`   🔎 OTP poll ${attempt}…`);

        // Refresh list lightly every few tries.
        if (attempt > 1 && attempt % 3 === 0) {
            try {
                await page.keyboard.press('F5');
                await human.gaussianSleep(2000, 3500);
            } catch {
                // ignore
            }
        }

        const rowSelectors = Array.isArray(otpCfg.messageRow)
            ? otpCfg.messageRow
            : String(otpCfg.messageRow || '').split(',').map((s) => s.trim()).filter(Boolean);

        let rows = [];
        for (const sel of rowSelectors) {
            try {
                rows = await page.$$(sel);
                if (rows.length) break;
            } catch {
                // try next
            }
        }

        // Prefer rows whose preview mentions Reddit.
        const candidates = [];
        for (const row of rows.slice(0, 25)) {
            let text = '';
            try {
                text = ((await row.innerText()) || '').trim();
            } catch {
                continue;
            }
            if (!text) continue;
            candidates.push({ row, text, reddit: looksLikeRedditMail(text) });
        }
        candidates.sort((a, b) => Number(b.reddit) - Number(a.reddit));

        for (const cand of candidates) {
            if (!cand.reddit && candidates.some((c) => c.reddit)) continue;
            try {
                await human.humanClick(cand.row);
                await human.gaussianSleep(900, 1800);
            } catch {
                continue;
            }

            const body = await readReadingPane(page, otpCfg);
            const otp = extractOtpFromText(body);
            if (otp) {
                console.log(`   ✅ OTP found in Outlook (${otp.length} digits)`);
                return otp;
            }
        }

        // Also scan the currently visible reading pane without a click.
        const paneOtp = extractOtpFromText(await readReadingPane(page, otpCfg));
        if (paneOtp) {
            console.log(`   ✅ OTP found in reading pane (${paneOtp.length} digits)`);
            return paneOtp;
        }

        // Whole-page fallback (preview text sometimes lives outside neat rows).
        try {
            const hay = await page.evaluate(() => document.body?.innerText || '');
            if (Date.now() >= issuedAfter) {
                const otp = extractOtpFromText(hay);
                // Only accept whole-page hits that look Reddit-related.
                if (otp && /reddit/i.test(hay)) {
                    console.log(`   ✅ OTP found in page text (${otp.length} digits)`);
                    return otp;
                }
            }
        } catch {
            // ignore
        }

        await human.gaussianSleep(3500, 5500);
    }

    return null;
}

async function readReadingPane(page, otpCfg) {
    const paneSelectors = Array.isArray(otpCfg.readingPane)
        ? otpCfg.readingPane
        : String(otpCfg.readingPane || 'body').split(',').map((s) => s.trim()).filter(Boolean);

    for (const sel of paneSelectors) {
        try {
            const el = await page.$(sel);
            if (!el) continue;
            const text = await el.innerText();
            if (text && text.trim().length > 20) return text;
        } catch {
            // try next
        }
    }
    try {
        return await page.evaluate(() => document.body?.innerText || '');
    } catch {
        return '';
    }
}

async function collectRedditLinks(page, otpCfg) {
    const paneSelectors = Array.isArray(otpCfg.readingPane)
        ? otpCfg.readingPane
        : String(otpCfg.readingPane || 'body').split(',').map((s) => s.trim()).filter(Boolean);

    for (const sel of paneSelectors) {
        try {
            const links = await page.$eval(sel, (root) =>
                Array.from(root.querySelectorAll('a[href*="reddit.com"]'))
                    .map((a) => a.href)
                    .filter(Boolean)
            ).catch(() => null);
            if (links && links.length) return links;
        } catch {
            // try next
        }
    }
    try {
        return await page.evaluate(() =>
            Array.from(document.querySelectorAll('a[href*="reddit.com"]'))
                .map((a) => a.href)
                .filter(Boolean)
        );
    } catch {
        return [];
    }
}

function pickVerifyLink(links) {
    if (!links?.length) return null;
    const scored = links.map((href) => {
        const h = href.toLowerCase();
        let score = 0;
        if (/verif|confirm|activate|click|email|register|signup|sign-up/.test(h)) score += 5;
        if (/reddit\.com/.test(h)) score += 1;
        if (/unsubscribe|prefetch|static/.test(h)) score -= 10;
        return { href, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.score > 0 ? scored[0].href : scored[0]?.href || null;
}

/**
 * Wait for a Reddit verification / “click this link” email and return its URL.
 */
async function waitForRedditVerifyLink(page, cfg, opts = {}) {
    const otpCfg = cfg.selectors.redditOtp || {};
    const timeoutMs = opts.timeoutMs || 180000;
    const human = new HumanBehavior(page, cfg.timing);
    const deadline = Date.now() + timeoutMs;

    console.log('📬 Switching to Outlook for Reddit verify link…');
    await page.bringToFront().catch(() => {});

    try {
        await page.goto(cfg.inboxUrl, {
            waitUntil: 'domcontentloaded',
            timeout: cfg.timing?.navigationTimeoutMs || 45000
        });
    } catch {
        // keep going
    }
    await human.gaussianSleep(1500, 2800);

    if (otpCfg.searchBox && otpCfg.searchQuery) {
        try {
            const box = await page.$(otpCfg.searchBox);
            if (box && (await box.isVisible())) {
                await human.humanClick(box);
                await human.clearField(box);
                await box.type(otpCfg.searchQuery, { delay: human.timing?.typeDelay || 80 });
                await page.keyboard.press('Enter');
                await human.gaussianSleep(1500, 2800);
            }
        } catch {
            // best-effort
        }
    }

    let attempt = 0;
    while (Date.now() < deadline) {
        attempt += 1;
        console.log(`   🔗 Verify-link poll ${attempt}…`);

        if (attempt > 1 && attempt % 3 === 0) {
            try {
                await page.keyboard.press('F5');
                await human.gaussianSleep(2000, 3500);
            } catch {
                // ignore
            }
        }

        const rowSelectors = Array.isArray(otpCfg.messageRow)
            ? otpCfg.messageRow
            : String(otpCfg.messageRow || '').split(',').map((s) => s.trim()).filter(Boolean);

        let rows = [];
        for (const sel of rowSelectors) {
            try {
                rows = await page.$$(sel);
                if (rows.length) break;
            } catch {
                // try next
            }
        }

        const candidates = [];
        for (const row of rows.slice(0, 25)) {
            let text = '';
            try {
                text = ((await row.innerText()) || '').trim();
            } catch {
                continue;
            }
            if (!text) continue;
            candidates.push({
                row,
                text,
                reddit: looksLikeRedditMail(text) || /verif|confirm|click|activate/i.test(text)
            });
        }
        candidates.sort((a, b) => Number(b.reddit) - Number(a.reddit));

        for (const cand of candidates) {
            if (!cand.reddit && candidates.some((c) => c.reddit)) continue;
            try {
                await human.humanClick(cand.row);
                await human.gaussianSleep(900, 1800);
            } catch {
                continue;
            }

            const links = await collectRedditLinks(page, otpCfg);
            const href = pickVerifyLink(links);
            if (href) {
                console.log('   ✅ Verify link found in Outlook');
                return href;
            }
        }

        const paneLinks = await collectRedditLinks(page, otpCfg);
        const paneHref = pickVerifyLink(paneLinks);
        if (paneHref) {
            console.log('   ✅ Verify link found in reading pane');
            return paneHref;
        }

        await human.gaussianSleep(3500, 5500);
    }

    return null;
}

module.exports = {
    waitForRedditOtp,
    waitForRedditVerifyLink,
    extractOtpFromText,
    looksLikeRedditMail,
    pickVerifyLink
};
