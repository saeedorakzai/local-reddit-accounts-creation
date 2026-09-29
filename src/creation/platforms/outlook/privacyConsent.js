/**
 * Outlook mail privacy / cookie consent modal (Accept / Reject).
 *
 * Appears over the inbox and blocks the Me avatar. Always Accept — never leave
 * it up. Selectors: platforms.outlook.selectors.outlookPrivacyConsent.
 */

async function isPrivacyConsentVisible(page, cfg) {
    const s = cfg.selectors?.outlookPrivacyConsent;
    if (!s) return false;

    try {
        const text = ((await page.evaluate(() => document.body?.innerText || '')) || '').toLowerCase();
        const textHit = (s.text || []).some((t) => text.includes(String(t).toLowerCase()));
        if (!textHit) return false;

        for (const sel of [].concat(s.accept || [])) {
            const el = await page.$(sel);
            if (el && (await el.isVisible().catch(() => false))) return true;
        }
    } catch {
        return false;
    }
    return false;
}

/**
 * Click Accept if the modal is up.
 * @returns {Promise<boolean>} whether Accept was clicked
 */
async function dismissPrivacyConsent(page, cfg, human = null) {
    if (!(await isPrivacyConsentVisible(page, cfg))) return false;

    const accept = cfg.selectors.outlookPrivacyConsent.accept;
    const list = Array.isArray(accept) ? accept : [accept];

    for (const sel of list) {
        try {
            const el = await page.$(sel);
            if (!el || !(await el.isVisible().catch(() => false))) continue;

            if (human?.hesitateBefore) {
                await human.hesitateBefore(async () => {
                    await el.click({ delay: 40 + Math.floor(Math.random() * 80) });
                });
            } else if (human?.humanClick) {
                await human.humanClick(el);
            } else {
                await el.click({ delay: 40 + Math.floor(Math.random() * 80) });
            }

            console.log('   ↪ accepted Outlook privacy / cookie consent');
            if (human?.gaussianSleep) await human.gaussianSleep(800, 1600);
            else await new Promise((r) => setTimeout(r, 1000));
            return true;
        } catch {
            // try next
        }
    }
    return false;
}

module.exports = { isPrivacyConsentVisible, dismissPrivacyConsent };
