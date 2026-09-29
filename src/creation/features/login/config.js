/**
 * Login feature settings — how the sign-in behaves.
 *
 * Profiles and batching live in config/app.js.
 * Selectors and DOM timing live in src/config/platforms/outlook.js.
 */

module.exports = {
    outlook: {
        // Land on the inbox before ever touching login.live.com. A live session
        // then costs one navigation, and it is the order a real browser does things.
        checkInboxFirst: true,

        // Answer Yes to "Stay signed in?" so the session survives to the next run.
        staySignedIn: true,

        // Together these guarantee the state machine terminates. Never remove either.
        maxSteps: 25,
        sessionTimeoutMs: 180000,

        // Transient failures only — navigation timeouts, page crashes. Terminal
        // outcomes are never retried; retrying a rejected password locks accounts.
        loginRetries: 1,

        // Pause after each navigation before classifying the screen.
        // Keep generous — Outlook's SPA often looks empty mid-transition.
        // Identity wipe is permanently disabled — a live session is always kept.
        settleMs: { min: 1800, max: 3500 }
    }
};
