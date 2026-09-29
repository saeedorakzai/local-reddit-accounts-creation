/**
 * Is this browser signed in to Outlook?
 *
 * Positive signals only, and a visible sign-in form is a hard negative checked
 * first. The URL alone is never enough — Outlook briefly shows the mail URL while
 * still redirecting to login, so a URL-only check reports success on a logged-out
 * profile.
 */

const { ScreenView } = require('./screenView');

async function isLoggedIn(view, cfg) {
    // Still inside the sign-in flow — definitively not logged in.
    if (view.urlIncludes(cfg.loginUrlPatterns)) return false;

    // A credential field on screen outranks any positive signal.
    const signInForm = await view.visible([
        cfg.selectors.emailInput.field,
        cfg.selectors.passwordInput.field
    ]);
    if (signInForm) return false;

    return view.visible(cfg.selectors.inbox.evidence);
}

/** Convenience wrapper for callers holding only a page. */
async function checkPage(page, cfg) {
    const view = await ScreenView.capture(page);
    return isLoggedIn(view, cfg);
}

/**
 * After navigating to the mailbox, wait until inbox evidence appears or we are
 * clearly bounced to login. Prevents classifying a blank loading shell as unknown.
 */
async function waitForMailboxReady(page, cfg, human) {
    const deadline = Date.now() + (cfg.timing?.inboxLoadTimeoutMs || 40000);
    while (Date.now() < deadline) {
        const view = await ScreenView.capture(page);
        if (await isLoggedIn(view, cfg)) return view;
        if (view.urlIncludes(cfg.loginUrlPatterns)) return view;
        if (view.urlIncludes(cfg.signedOutUrlPatterns || [])) return view;
        if (human?.gaussianSleep) {
            await human.gaussianSleep(1200, 2200);
        } else {
            await new Promise((r) => setTimeout(r, 1500));
        }
    }
    return ScreenView.capture(page);
}

module.exports = { isLoggedIn, checkPage, waitForMailboxReady };
