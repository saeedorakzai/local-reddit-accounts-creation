/**
 * Humanize layer — applies CloakBrowser's human-like behavioral patches to an
 * existing Playwright Browser (e.g. one connected to AdsPower over CDP).
 *
 * This is the behavior-only slice of CloakBrowser (MIT, CloakHQ). It patches
 * page/frame/element methods — click, hover, type, fill, press, scroll, mouse —
 * to use Bézier mouse curves, human-timed keystrokes (with occasional typos),
 * and smooth scrolling. Fingerprint stealth is handled by AdsPower, not here.
 *
 * Playwright only — has no effect on Selenium-driven Firefox pages.
 *
 * Usage:
 *   const { humanizeBrowser } = require('../shared/humanize');
 *   await humanizeBrowser(browser, { humanize: true, humanPreset: 'careful' });
 *
 * Options:
 *   humanize     {boolean}  must be true, else this is a no-op
 *   humanPreset  {'default'|'careful'}  'careful' = slower, more deliberate, idle drift
 *   humanConfig  {object}   partial overrides for any HumanConfig field (see human/config.js)
 */

const { patchBrowser, resolveConfig } = require('./human/index.js');

/**
 * Patch a Playwright Browser in place. Existing contexts/pages are patched, and
 * future newContext()/newPage() calls are wrapped automatically. Idempotent per
 * page (guards against double-patching).
 *
 * @param {import('playwright').Browser} browser
 * @param {{ humanize?: boolean, humanPreset?: 'default'|'careful', humanConfig?: object }} [options]
 */
async function humanizeBrowser(browser, options = {}) {
    if (!options || !options.humanize) return;
    const cfg = resolveConfig(options.humanPreset || 'default', options.humanConfig);
    patchBrowser(browser, cfg);
}

module.exports = { humanizeBrowser, resolveConfig };
