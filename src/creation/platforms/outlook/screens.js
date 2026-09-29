/**
 * The screen table — one entry per screen Microsoft can show.
 *
 * Walked top to bottom, FIRST MATCH WINS. The order is correctness, not style:
 *
 *   1. `inbox` is first — it is the success condition, so a mid-flow redirect
 *      straight to the mailbox is caught immediately.
 *   2. Terminal error screens sit ABOVE input screens. A rejected password renders
 *      #passwordError while the password field is still on the page. Match
 *      passwordInput first and the bot retypes the same wrong password every
 *      iteration until Microsoft locks the account. This is the single most
 *      important ordering constraint in the project.
 *
 * Adding a screen is one entry here plus its selectors in
 * src/config/platforms/outlook.js. It is never an edit to the driver loop.
 */

const { OUTCOMES } = require('../../shared/outcomes');
const { isLoggedIn } = require('./auth');
const { dismissPrivacyConsent } = require('./privacyConsent');

const SCREENS = [
    // Above inbox: this modal sits on top of a logged-in mailbox and would
    // otherwise make `inbox` win while the Me avatar stays blocked.
    {
        id: 'outlookPrivacyConsent',
        match: async (view, cfg) => {
            const s = cfg.selectors.outlookPrivacyConsent;
            if (!s) return false;
            if (!view.hasText(s.text)) return false;
            return view.visible(s.accept);
        },
        handle: async (ctx) => {
            await dismissPrivacyConsent(ctx.page, ctx.cfg, ctx.human);
        }
    },

    {
        id: 'inbox',
        match: (view, cfg) => isLoggedIn(view, cfg),
        terminal: true,
        outcome: OUTCOMES.LOGGED_IN
    },

    {
        id: 'accountLocked',
        match: async (view, cfg) => {
            const s = cfg.selectors.accountLocked;
            return view.urlIncludes(s.urlPatterns) || view.hasText(s.text);
        },
        terminal: true,
        outcome: OUTCOMES.LOCKED
    },

    {
        id: 'wrongPassword',
        match: async (view, cfg) => {
            const s = cfg.selectors.wrongPassword;
            return (await view.visible(s.error)) || view.hasText(s.text);
        },
        terminal: true,
        outcome: OUTCOMES.BAD_CREDENTIALS
    },

    {
        id: 'noAccount',
        match: async (view, cfg) => {
            const s = cfg.selectors.noAccount;
            return (await view.visible(s.error)) || view.hasText(s.text);
        },
        terminal: true,
        outcome: OUTCOMES.NO_ACCOUNT
    },

    {
        id: 'captcha',
        match: async (view, cfg) => {
            const s = cfg.selectors.captcha;
            return (await view.visible([s.frame, s.marker])) || view.hasText(s.text);
        },
        terminal: true,
        outcome: OUTCOMES.CAPTCHA
    },

    {
        id: 'twoFactor',
        match: async (view, cfg) => {
            const s = cfg.selectors.twoFactor;
            return (await view.visible([s.field, s.marker])) || view.hasText(s.text);
        },
        terminal: true,
        outcome: OUTCOMES.VERIFICATION_REQUIRED
    },

    {
        id: 'verifyIdentity',
        match: async (view, cfg) => {
            const s = cfg.selectors.verifyIdentity;
            // The skip-able "protect your account" nag shares copy with the hard
            // proof prompt, so require the proof chooser itself to be present.
            return view.visible(s.marker);
        },
        terminal: true,
        outcome: OUTCOMES.VERIFICATION_REQUIRED
    },

    {
        id: 'accountPortal',
        match: async (view, cfg) => view.urlIncludes(cfg.selectors.accountPortal.urlPatterns),
        handle: async (ctx) => {
            // Signed in, just not on the mailbox — go there so `inbox` can confirm.
            await ctx.page.goto(ctx.cfg.inboxUrl, {
                waitUntil: 'domcontentloaded',
                timeout: ctx.cfg.timing.navigationTimeoutMs
            }).catch(() => {});
            const { waitForMailboxReady } = require('./auth');
            await waitForMailboxReady(ctx.page, ctx.cfg, ctx.human);
        }
    },

    {
        id: 'passkeyEnroll',
        match: async (view, cfg) => {
            const s = cfg.selectors.passkeyEnroll;
            return view.urlIncludes(s.urlPatterns) || view.hasText(s.text);
        },
        handle: async (ctx) => {
            // Decline enrollment. create() is already neutralized, so no native
            // dialog blocks this click.
            await ctx.human.hesitateBefore(
                () => ctx.human.clickFirstVisible(ctx.cfg.selectors.passkeyEnroll.skip)
            );
        }
    },

    {
        id: 'passkeyBridge',
        match: async (view, cfg) => {
            const s = cfg.selectors.passkeyBridge;
            return view.urlIncludes(s.urlPatterns) || view.hasText(s.text);
        },
        handle: async (ctx) => {
            const s = ctx.cfg.selectors.passkeyBridge;
            // The passkey prompt does NOT time out on its own — it waits for an
            // authenticator that isn't here. Back cancels it, which surfaces
            // "Other ways to sign in". Take that link when present; otherwise cancel.
            await ctx.human.hesitateBefore(async () => {
                const took = await ctx.human.clickFirstVisible(s.otherWays);
                if (!took) await ctx.human.clickFirstVisible(s.back);
            });
        }
    },

    {
        id: 'signInOptions',
        match: async (view, cfg) => {
            const s = cfg.selectors.signInOptions;
            // The password-entry page also links to "Other ways to sign in"; a field
            // on screen means we are past the fork, so let passwordInput take it.
            if (await view.visible(cfg.selectors.passwordInput.field)) return false;
            // The fork is identified by the "Use your password" option itself.
            return (await view.visible(s.usePassword)) ||
                (view.hasText(s.text) && (await view.visible(s.marker)));
        },
        handle: async (ctx) => {
            await ctx.human.hesitateBefore(
                () => ctx.human.clickFirstVisible(ctx.cfg.selectors.signInOptions.usePassword)
            );
        }
    },

    {
        id: 'passkeyNag',
        match: async (view, cfg) => {
            const s = cfg.selectors.passkeyNag;
            return view.hasText(s.text) && (await view.visible(s.skip));
        },
        handle: async (ctx) => {
            await ctx.human.hesitateBefore(
                () => ctx.human.clickFirstVisible(ctx.cfg.selectors.passkeyNag.skip)
            );
        }
    },

    {
        id: 'protectAccount',
        match: async (view, cfg) => {
            const s = cfg.selectors.protectAccount;
            return view.hasText(s.text) && (await view.visible(s.skip));
        },
        handle: async (ctx) => {
            await ctx.human.hesitateBefore(
                () => ctx.human.clickFirstVisible(ctx.cfg.selectors.protectAccount.skip)
            );
        }
    },

    {
        id: 'privacyNotice',
        match: async (view, cfg) => view.urlIncludes(cfg.selectors.privacyNotice.urlPatterns),
        handle: async (ctx) => {
            await ctx.human.gaussianSleep(1500, 2500);

            // If the consent button rendered, click it (it lives in a child frame).
            const clicked = await ctx.human.clickFirstVisibleInAnyFrame(
                ctx.cfg.selectors.privacyNotice.continue
            );
            if (clicked) return;

            // Behind these proxies the notice body often never renders. Auth is
            // already complete here, so go straight to the mailbox — a stable domain,
            // unlike the login.live.com return URL, which these proxies drop.
            await ctx.page.goto(ctx.cfg.inboxUrl, {
                waitUntil: 'domcontentloaded',
                timeout: ctx.cfg.timing.navigationTimeoutMs
            }).catch(() => {});
            const { waitForMailboxReady } = require('./auth');
            await waitForMailboxReady(ctx.page, ctx.cfg, ctx.human);
        }
    },

    {
        id: 'termsUpdate',
        match: async (view, cfg) => {
            const s = cfg.selectors.termsUpdate;
            return view.hasText(s.text) && (await view.visible(s.accept));
        },
        handle: async (ctx) => {
            await ctx.human.hesitateBefore(
                () => ctx.human.clickFirstVisible(ctx.cfg.selectors.termsUpdate.accept)
            );
        }
    },

    {
        id: 'staySignedIn',
        match: async (view, cfg) => {
            const s = cfg.selectors.staySignedIn;
            return (await view.visible([s.heading, s.marker])) || view.hasText('stay signed in');
        },
        handle: async (ctx) => {
            const s = ctx.cfg.selectors.staySignedIn;
            const button = ctx.login.staySignedIn ? s.yes : s.no;
            // A person reads this prompt before answering it.
            await ctx.human.hesitateBefore(() => ctx.human.clickFirstVisible(button));
        }
    },

    {
        id: 'pickAccount',
        match: async (view, cfg) => view.visible(cfg.selectors.pickAccount.marker),
        handle: async (ctx) => {
            const s = ctx.cfg.selectors.pickAccount;
            const email = ctx.account.email;

            // Prefer the tile for this exact account; otherwise start a fresh sign-in.
            const tile = await ctx.page.$(`div[data-testid="accountTile"]:has-text("${email}")`)
                .catch(() => null);

            if (tile && (await tile.isVisible().catch(() => false))) {
                await ctx.human.humanClick(tile);
                return;
            }

            await ctx.human.clickFirstVisible(s.useAnother);
        }
    },

    {
        id: 'emailInput',
        match: async (view, cfg) => view.visible(cfg.selectors.emailInput.field),
        handle: async (ctx) => {
            const s = ctx.cfg.selectors.emailInput;
            await ctx.human.typeInto(s.field, ctx.account.email);
            await ctx.human.gaussianSleep(
                ctx.cfg.timing.beforeSubmit * 0.6,
                ctx.cfg.timing.beforeSubmit * 1.4
            );
            await ctx.human.clickFirstVisible(s.submit);
        }
    },

    {
        id: 'passwordInput',
        match: async (view, cfg) => view.visible(cfg.selectors.passwordInput.field),
        handle: async (ctx) => {
            const s = ctx.cfg.selectors.passwordInput;
            // The only place a password is handled. Nothing here is logged.
            await ctx.human.typeInto(s.field, ctx.account.password);
            await ctx.human.gaussianSleep(
                ctx.cfg.timing.beforeSubmit * 0.6,
                ctx.cfg.timing.beforeSubmit * 1.4
            );
            await ctx.human.clickFirstVisible(s.submit);
        }
    }
];

/** First entry whose match() is true, or null. */
async function classify(view, cfg) {
    for (const screen of SCREENS) {
        try {
            if (await screen.match(view, cfg)) return screen;
        } catch {
            // A matcher that throws must not stop the sweep — try the next screen.
        }
    }
    return null;
}

module.exports = { SCREENS, classify };
