/**
 * The outcome taxonomy. Every account ends in exactly one of these.
 *
 * This is the product of a run: a run that signs in zero accounts is still
 * successful if it says precisely why for each one.
 *
 * TERMINAL_FAILURES are never retried. Retrying a rejected password is what
 * triggers Microsoft account locks, so that rule is enforced here rather than
 * left to each caller.
 */

const OUTCOMES = {
    ALREADY_LOGGED_IN: 'already-logged-in',
    LOGGED_IN: 'logged-in',
    BAD_CREDENTIALS: 'bad-credentials',
    NO_ACCOUNT: 'no-account',
    LOCKED: 'locked',
    VERIFICATION_REQUIRED: 'verification-required',
    CAPTCHA: 'captcha',
    PROFILE_START_FAILED: 'profile-start-failed',
    UNKNOWN: 'unknown',

    // Reddit register (after Outlook success when run.registerAfterLogin)
    REDDIT_CREATED: 'reddit-created',
    ALREADY_REGISTERED: 'already-registered',
    EMAIL_TAKEN: 'email-taken',
    OTP_TIMEOUT: 'otp-timeout',
    OUTLOOK_NOT_LOGGED_IN: 'outlook-not-logged-in'
};

const SUCCESS = new Set([
    OUTCOMES.ALREADY_LOGGED_IN,
    OUTCOMES.LOGGED_IN,
    OUTCOMES.REDDIT_CREATED,
    OUTCOMES.ALREADY_REGISTERED
]);

/** Reached a definite answer — do not retry, do not try to work around. */
const TERMINAL_FAILURES = new Set([
    OUTCOMES.BAD_CREDENTIALS,
    OUTCOMES.NO_ACCOUNT,
    OUTCOMES.LOCKED,
    OUTCOMES.VERIFICATION_REQUIRED,
    OUTCOMES.CAPTCHA,
    OUTCOMES.EMAIL_TAKEN
]);

/** Needs a human. Nothing here is something the bot should attempt itself. */
const NEEDS_HUMAN = new Set([
    OUTCOMES.LOCKED,
    OUTCOMES.VERIFICATION_REQUIRED,
    OUTCOMES.CAPTCHA,
    OUTCOMES.BAD_CREDENTIALS,
    OUTCOMES.NO_ACCOUNT,
    OUTCOMES.EMAIL_TAKEN
]);

const LABELS = {
    [OUTCOMES.ALREADY_LOGGED_IN]: 'Already signed in (session alive)',
    [OUTCOMES.LOGGED_IN]: 'Signed in this run',
    [OUTCOMES.BAD_CREDENTIALS]: 'Password rejected',
    [OUTCOMES.NO_ACCOUNT]: 'No such Microsoft account',
    [OUTCOMES.LOCKED]: 'Account locked / suspended',
    [OUTCOMES.VERIFICATION_REQUIRED]: 'Needs identity verification',
    [OUTCOMES.CAPTCHA]: 'Captcha challenge shown',
    [OUTCOMES.PROFILE_START_FAILED]: 'AdsPower profile did not start',
    [OUTCOMES.UNKNOWN]: 'Unrecognised screen (screenshot saved)',
    [OUTCOMES.REDDIT_CREATED]: 'Reddit account created this run',
    [OUTCOMES.ALREADY_REGISTERED]: 'Reddit already registered on this profile',
    [OUTCOMES.EMAIL_TAKEN]: 'Reddit says email already registered',
    [OUTCOMES.OTP_TIMEOUT]: 'Reddit OTP / verify mail never arrived',
    [OUTCOMES.OUTLOOK_NOT_LOGGED_IN]: 'Outlook session not alive for Reddit register'
};

/** Report order — successes first, then things you can act on. */
const REPORT_ORDER = [
    OUTCOMES.REDDIT_CREATED,
    OUTCOMES.ALREADY_REGISTERED,
    OUTCOMES.LOGGED_IN,
    OUTCOMES.ALREADY_LOGGED_IN,
    OUTCOMES.BAD_CREDENTIALS,
    OUTCOMES.NO_ACCOUNT,
    OUTCOMES.LOCKED,
    OUTCOMES.VERIFICATION_REQUIRED,
    OUTCOMES.CAPTCHA,
    OUTCOMES.EMAIL_TAKEN,
    OUTCOMES.OTP_TIMEOUT,
    OUTCOMES.OUTLOOK_NOT_LOGGED_IN,
    OUTCOMES.PROFILE_START_FAILED,
    OUTCOMES.UNKNOWN
];

function isSuccess(outcome) {
    return SUCCESS.has(outcome);
}

function isRetryable(outcome) {
    return !SUCCESS.has(outcome) && !TERMINAL_FAILURES.has(outcome);
}

function label(outcome) {
    return LABELS[outcome] || outcome;
}

module.exports = {
    OUTCOMES,
    SUCCESS,
    TERMINAL_FAILURES,
    NEEDS_HUMAN,
    LABELS,
    REPORT_ORDER,
    isSuccess,
    isRetryable,
    label
};
