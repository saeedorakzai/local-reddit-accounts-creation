/**
 * Prefix console output with the active AdsPower profile label
 * while a warmup / activity coroutine runs (safe under Promise.all).
 */

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
let patched = false;

const raw = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
};

function ensureConsolePatch() {
    if (patched) return;
    patched = true;

    for (const method of ['log', 'warn', 'error']) {
        console[method] = (...args) => {
            const label = als.getStore()?.label;
            if (label) {
                raw[method](`${label}`, ...args);
            } else {
                raw[method](...args);
            }
        };
    }
}

/**
 * Run async work with every console.log/warn/error prefixed by `label`.
 * @param {string} label e.g. "k1e5piy2 - 1/5"
 * @param {() => Promise<any>} fn
 */
function runWithProfileLog(label, fn) {
    ensureConsolePatch();
    return als.run({ label }, fn);
}

function getProfileLabel() {
    return als.getStore()?.label || null;
}

module.exports = { runWithProfileLog, getProfileLabel };
