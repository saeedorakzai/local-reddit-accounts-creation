/**
 * Platform factory — the seam between src/core/ and the platform's DOM knowledge.
 *
 * Core calls platform.login() / platform.register(); it never learns what a
 * sign-in form is.
 */

const OutlookAuth = require('./outlook/auth');
const OutlookLoginSession = require('../features/login/platforms/outlook/session');
const RedditRegisterSession = require('../features/register/platforms/reddit/session');

function createPlatform(page, platformName, config) {
    if (platformName === 'outlook') {
        return {
            name: 'outlook',
            url: config.platforms.outlook.inboxUrl,
            isLoggedIn: () => OutlookAuth.checkPage(page, config.platforms.outlook),
            login: () => new OutlookLoginSession(page, config).run(),
            // Same browser / Outlook tab; opens Reddit in a new tab.
            register: () => new RedditRegisterSession(page, config).run()
        };
    }

    if (platformName === 'reddit') {
        return {
            name: 'reddit',
            url: config.platforms.reddit.registerUrl,
            register: () => new RedditRegisterSession(page, config).run()
        };
    }

    throw new Error(`Unknown platform: ${platformName}`);
}

module.exports = { createPlatform };
