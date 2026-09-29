/**
 * Register feature settings — how Reddit signup behaves.
 *
 * Profiles and batching live in config/app.js.
 * Selectors and DOM timing live in src/config/platforms/reddit.js.
 */

module.exports = {
    reddit: {
        // After email → OTP → credentials, pause so the live browser can be checked.
        // Batch `npm start` forces this off; `npm run inspect:reddit` turns it on.
        pauseAfterComplete: false,
        discoveryPauseMs: 30 * 60 * 1000,

        // How long to poll Outlook for the Reddit verification mail / link.
        otpTimeoutMs: 180000,
        verifyLinkTimeoutMs: 180000,

        // Sometimes double-click Continue after email — Reddit skips OTP and later
        // sends a clickable verify link instead. 0 = never, 1 = always.
        doubleClickRegisterChance: 0.45,

        // Captcha / offline / proxy blips: refresh and retry this many times.
        gateRetries: 4,
        // Wait between network retries (then refresh). Captcha refreshes immediately.
        networkBackoffMs: [5000, 10000, 20000, 20000],

        // Onboarding variance — never the same path for every account.
        genderSkipChance: 0.25,
            interestPickMin: 2,
            interestPickMax: 5,
            // Rare Skip on interests when Reddit shows the with_skip_button variant.
            interestSkipChance: 0.1,
            customizeFeedSkipChance: 0.3,
            customizeFeedPickMin: 2,
            customizeFeedPickMax: 5,
            interstitialSkipChance: 0.55,

        settleMs: { min: 1200, max: 2600 },

        maxSteps: 20,
        sessionTimeoutMs: 420000
    }
};
