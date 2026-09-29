/**
 * Is this browser signed in to Reddit?
 *
 * Positive signals only. Draft selectors — refine after live discovery.
 */

async function isLoggedIn(page, cfg) {
    const evidence = cfg.selectors.loggedIn.evidence || [];
    for (const selector of evidence) {
        try {
            const el = await page.$(selector);
            if (el && (await el.isVisible())) return true;
        } catch {
            // ignore
        }
    }
    return false;
}

async function checkPage(page, cfg) {
    return isLoggedIn(page, cfg);
}

module.exports = { isLoggedIn, checkPage };
