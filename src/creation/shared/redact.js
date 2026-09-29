/**
 * Secret redaction.
 *
 * Every password that enters the process is registered here, and anything on its
 * way to a log or a report goes through scrub(). Error messages matter as much as
 * deliberate logging — a Playwright timeout on a filled field can echo its value.
 */

const MASK = '[redacted]';

const secrets = new Set();

function registerSecret(value) {
    if (typeof value === 'string' && value.length >= 4) {
        secrets.add(value);
    }
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace every registered secret in a string. Safe to call on anything —
 * non-strings are coerced, null/undefined pass through unchanged.
 */
function scrub(input) {
    if (input == null) return input;

    let text = typeof input === 'string' ? input : String(input);
    for (const secret of secrets) {
        text = text.replace(new RegExp(escapeRegExp(secret), 'g'), MASK);
    }
    return text;
}

/** An account shaped for logging — same fields minus the password. */
function safeAccount(account) {
    if (!account) return account;
    const { password, ...rest } = account;
    return { ...rest, password: password ? MASK : null };
}

/** scrub() an Error's message, keeping it an Error so callers can rethrow. */
function scrubError(error) {
    if (!(error instanceof Error)) return scrub(error);
    const clean = new Error(scrub(error.message));
    clean.stack = scrub(error.stack);
    return clean;
}

function clearSecrets() {
    secrets.clear();
}

module.exports = {
    registerSecret,
    scrub,
    scrubError,
    safeAccount,
    clearSecrets,
    MASK
};
