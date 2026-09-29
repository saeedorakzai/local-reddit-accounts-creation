"use strict";
/**
 * Human-like behavioral layer for cloakbrowser (JS/TS).
 *
 * Activated via humanize: true in launch() / launchContext().
 * Patches page methods to use Bezier mouse curves, realistic typing, and smooth scrolling.
 *
 * Stealth-aware (fixes #110):
 *   - isInputElement / isSelectorFocused use CDP Isolated Worlds instead of page.evaluate
 *   - Shift symbol typing uses CDP Input.dispatchKeyEvent for isTrusted=true events
 *   - Falls back to page.evaluate only when CDP session is unavailable
 *
 * Patches all interaction methods:
 * click, dblclick, hover, type, fill, check, uncheck, selectOption,
 * press, pressSequentially, tap, dragTo, clear + Frame-level equivalents.
 *
 * ELEMENTHANDLE-LEVEL:
 *   click, dblclick, hover, type, fill, press, selectOption,
 *   check, uncheck, setChecked, tap, focus
 *   + $, $$, waitForSelector (nested elements are also patched)
 *
 * page.$(), page.$$(), page.waitForSelector() and Frame equivalents
 * return patched ElementHandles automatically.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchSingleElementHandle = exports.humanScrollIntoView = exports.scrollToElement = exports.humanType = exports.humanIdle = exports.clickTarget = exports.humanClick = exports.humanMove = exports.mergeConfig = exports.resolveConfig = void 0;
exports.patchBrowser = patchBrowser;
exports.patchContext = patchContext;
exports.patchPage = patchPage;
const config_js_1 = require("./config.js");
const mouse_js_1 = require("./mouse.js");
const keyboard_js_1 = require("./keyboard.js");
const scroll_js_1 = require("./scroll.js");
const elementhandle_js_1 = require("./elementhandle.js");
const actionability_js_1 = require("./actionability.js");
var config_js_2 = require("./config.js");
Object.defineProperty(exports, "resolveConfig", { enumerable: true, get: function () { return config_js_2.resolveConfig; } });
Object.defineProperty(exports, "mergeConfig", { enumerable: true, get: function () { return config_js_2.mergeConfig; } });
var mouse_js_2 = require("./mouse.js");
Object.defineProperty(exports, "humanMove", { enumerable: true, get: function () { return mouse_js_2.humanMove; } });
Object.defineProperty(exports, "humanClick", { enumerable: true, get: function () { return mouse_js_2.humanClick; } });
Object.defineProperty(exports, "clickTarget", { enumerable: true, get: function () { return mouse_js_2.clickTarget; } });
Object.defineProperty(exports, "humanIdle", { enumerable: true, get: function () { return mouse_js_2.humanIdle; } });
var keyboard_js_2 = require("./keyboard.js");
Object.defineProperty(exports, "humanType", { enumerable: true, get: function () { return keyboard_js_2.humanType; } });
var scroll_js_2 = require("./scroll.js");
Object.defineProperty(exports, "scrollToElement", { enumerable: true, get: function () { return scroll_js_2.scrollToElement; } });
Object.defineProperty(exports, "humanScrollIntoView", { enumerable: true, get: function () { return scroll_js_2.humanScrollIntoView; } });
var elementhandle_js_2 = require("./elementhandle.js");
Object.defineProperty(exports, "patchSingleElementHandle", { enumerable: true, get: function () { return elementhandle_js_2.patchSingleElementHandle; } });
// --- Platform-aware select-all shortcut (macOS uses Meta, others use Control) ---
const SELECT_ALL = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';
// ============================================================================
// CDP Isolated World — stealth DOM evaluation
// ============================================================================
/**
 * Manages a CDP isolated execution context for DOM reads.
 * Produces clean Error.stack traces (no 'eval at evaluate :302:')
 * and is invisible to querySelector monkey-patches in the main world.
 *
 * Context ID is invalidated on navigation and auto-recreated on next call.
 */
class StealthEval {
    cdp = null;
    contextId = null;
    page;
    constructor(page) {
        this.page = page;
    }
    async ensureCdp() {
        if (!this.cdp) {
            this.cdp = await this.page.context().newCDPSession(this.page);
        }
        return this.cdp;
    }
    async createWorld() {
        const cdp = await this.ensureCdp();
        const tree = await cdp.send('Page.getFrameTree');
        const frameId = tree.frameTree.frame.id;
        const result = await cdp.send('Page.createIsolatedWorld', {
            frameId,
            worldName: '',
            grantUniveralAccess: true,
        });
        const ctxId = result.executionContextId;
        this.contextId = ctxId;
        return ctxId;
    }
    /**
     * Evaluate a JS expression in the isolated world.
     * Auto-recreates the world if the context was invalidated (navigation).
     * Returns the result value, or undefined on failure.
     */
    async evaluate(expression) {
        if (this.contextId === null) {
            await this.createWorld();
        }
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const cdp = await this.ensureCdp();
                const result = await cdp.send('Runtime.evaluate', {
                    expression,
                    contextId: this.contextId,
                    returnByValue: true,
                });
                if (result.exceptionDetails) {
                    // Context was likely invalidated by navigation
                    if (attempt === 0) {
                        await this.createWorld();
                        continue;
                    }
                    return undefined;
                }
                return result.result?.value;
            }
            catch {
                if (attempt === 0) {
                    this.contextId = null;
                    try {
                        await this.createWorld();
                    }
                    catch {
                        return undefined;
                    }
                    continue;
                }
                return undefined;
            }
        }
        return undefined;
    }
    /** Mark context as stale — call after navigation. */
    invalidate() {
        this.contextId = null;
    }
    /** Get the underlying CDP session (reused for Input.dispatchKeyEvent etc.). */
    async getCdpSession() {
        return this.ensureCdp();
    }
}
// ============================================================================
// Cursor state
// ============================================================================
class CursorState {
    x = 0;
    y = 0;
    initialized = false;
}
// ============================================================================
// Stealth DOM queries — isolated world with evaluate fallback
// ============================================================================
/**
 * Check if selector matches an input/textarea/contenteditable element.
 * Uses CDP Isolated World when available — invisible to main world.
 */
async function isInputElement(stealth, page, selector) {
    if (stealth) {
        try {
            const escaped = JSON.stringify(selector);
            const result = await stealth.evaluate(`
        (() => {
          const el = document.querySelector(${escaped});
          if (!el) return false;
          const tag = el.tagName.toLowerCase();
          return tag === 'input' || tag === 'textarea'
            || el.getAttribute('contenteditable') === 'true';
        })()
      `);
            return !!result;
        }
        catch {
            // Fall through to page.evaluate
        }
    }
    // Fallback: page.evaluate (detectable — should only happen if CDP fails)
    return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el)
            return false;
        const tag = el.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea'
            || el.getAttribute('contenteditable') === 'true';
    }, selector).catch(() => false);
}
/**
 * Check if the element matching selector is currently focused.
 * Uses CDP Isolated World when available — invisible to main world.
 */
async function isSelectorFocused(stealth, page, selector) {
    if (stealth) {
        try {
            const escaped = JSON.stringify(selector);
            const result = await stealth.evaluate(`
        (() => {
          const el = document.querySelector(${escaped});
          return el === document.activeElement;
        })()
      `);
            return !!result;
        }
        catch {
            // Fall through to page.evaluate
        }
    }
    return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el === document.activeElement;
    }, selector).catch(() => false);
}
// ============================================================================
// Page-level patching
// ============================================================================
/**
 * Replace page methods with human-like implementations.
 */
function patchPage(page, cfg, cursor) {
    const originals = {
        click: page.click.bind(page),
        dblclick: page.dblclick.bind(page),
        hover: page.hover.bind(page),
        type: page.type.bind(page),
        fill: page.fill.bind(page),
        check: page.check.bind(page),
        uncheck: page.uncheck.bind(page),
        selectOption: page.selectOption.bind(page),
        press: page.press.bind(page),
        goto: page.goto.bind(page),
        isChecked: page.isChecked.bind(page),
        mouseMove: page.mouse.move.bind(page.mouse),
        mouseClick: page.mouse.click.bind(page.mouse),
        mouseDblclick: page.mouse.dblclick.bind(page.mouse),
        mouseWheel: page.mouse.wheel.bind(page.mouse),
        mouseDown: page.mouse.down.bind(page.mouse),
        mouseUp: page.mouse.up.bind(page.mouse),
        keyboardType: page.keyboard.type.bind(page.keyboard),
        keyboardDown: page.keyboard.down.bind(page.keyboard),
        keyboardUp: page.keyboard.up.bind(page.keyboard),
        keyboardPress: page.keyboard.press.bind(page.keyboard),
        keyboardInsertText: page.keyboard.insertText.bind(page.keyboard),
    };
    page._original = originals;
    page._humanCfg = cfg;
    // --- Stealth infrastructure ---
    const stealth = new StealthEval(page);
    page._stealth = stealth;
    // CDP session for shift symbol typing (lazy-initialized, reuses stealth's session)
    let cdpSession = null;
    const ensureCdp = async () => {
        if (!cdpSession) {
            try {
                cdpSession = await stealth.getCdpSession();
            }
            catch { }
        }
        return cdpSession;
    };
    const raw = {
        move: originals.mouseMove,
        down: originals.mouseDown,
        up: originals.mouseUp,
        wheel: originals.mouseWheel,
    };
    const rawKb = {
        down: originals.keyboardDown,
        up: originals.keyboardUp,
        type: originals.keyboardType,
        insertText: originals.keyboardInsertText,
    };
    async function ensureCursorInit() {
        if (!cursor.initialized) {
            cursor.x = (0, config_js_1.rand)(cfg.initial_cursor_x[0], cfg.initial_cursor_x[1]);
            cursor.y = (0, config_js_1.rand)(cfg.initial_cursor_y[0], cfg.initial_cursor_y[1]);
            await originals.mouseMove(cursor.x, cursor.y);
            cursor.initialized = true;
        }
    }
    // --- goto (invalidate isolated world on navigation) ---
    const humanGoto = async (url, options) => {
        const response = await originals.goto(url, options);
        stealth.invalidate();
        patchFrames(page, cfg, cursor, raw, rawKb, originals, stealth);
        return response;
    };
    // --- click ---
    const humanClickFn = async (selector, options) => {
        await ensureCursorInit();
        const callCfg = (0, config_js_1.mergeConfig)(cfg, options?.human_config ?? options);
        const timeout = options?.timeout ?? 30000;
        const force = options?.force ?? false;
        const skipChecks = options?._skipChecks ?? false;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        if (!force && !skipChecks) {
            await (0, actionability_js_1.ensureActionable)(page, selector, actionability_js_1.CHECKS_CLICK, remainingMs(), force);
        }
        if (callCfg.idle_between_actions) {
            await (0, mouse_js_1.humanIdle)(raw, cursor.x, cursor.y, callCfg);
        }
        const { box, cursorX, cursorY, didScroll } = await (0, scroll_js_1.scrollToElement)(page, raw, selector, cursor.x, cursor.y, callCfg, remainingMs());
        cursor.x = cursorX;
        cursor.y = cursorY;
        const isInput = await isInputElement(stealth, page, selector);
        let finalBox = box;
        if (!force && didScroll) {
            await (0, actionability_js_1.ensureStable)(page, selector, remainingMs());
            finalBox = await page.locator(selector).first().boundingBox({ timeout: Math.max(1, remainingMs()) }) ?? box;
        }
        const target = (0, mouse_js_1.clickTarget)(finalBox, isInput, callCfg);
        if (!force) {
            await (0, actionability_js_1.checkPointerEvents)(page, selector, target.x, target.y, stealth, remainingMs());
        }
        await (0, mouse_js_1.humanMove)(raw, cursor.x, cursor.y, target.x, target.y, callCfg);
        cursor.x = target.x;
        cursor.y = target.y;
        await (0, mouse_js_1.humanClick)(raw, isInput, callCfg);
    };
    // --- dblclick ---
    const humanDblclickFn = async (selector, options) => {
        await ensureCursorInit();
        const callCfg = (0, config_js_1.mergeConfig)(cfg, options?.human_config ?? options);
        const timeout = options?.timeout ?? 30000;
        const force = options?.force ?? false;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        if (!force)
            await (0, actionability_js_1.ensureActionable)(page, selector, actionability_js_1.CHECKS_CLICK, remainingMs(), force);
        if (callCfg.idle_between_actions) {
            await (0, mouse_js_1.humanIdle)(raw, cursor.x, cursor.y, callCfg);
        }
        const { box, cursorX, cursorY, didScroll } = await (0, scroll_js_1.scrollToElement)(page, raw, selector, cursor.x, cursor.y, callCfg, remainingMs());
        cursor.x = cursorX;
        cursor.y = cursorY;
        const isInput = await isInputElement(stealth, page, selector);
        let finalBox = box;
        if (!force && didScroll) {
            await (0, actionability_js_1.ensureStable)(page, selector, remainingMs());
            finalBox = await page.locator(selector).first().boundingBox({ timeout: Math.max(1, remainingMs()) }) ?? box;
        }
        const target = (0, mouse_js_1.clickTarget)(finalBox, isInput, callCfg);
        if (!force) {
            await (0, actionability_js_1.checkPointerEvents)(page, selector, target.x, target.y, stealth, remainingMs());
        }
        await (0, mouse_js_1.humanMove)(raw, cursor.x, cursor.y, target.x, target.y, callCfg);
        cursor.x = target.x;
        cursor.y = target.y;
        await raw.down({ clickCount: 2 });
        await (0, config_js_1.sleep)((0, config_js_1.rand)(30, 60));
        await raw.up({ clickCount: 2 });
    };
    // --- hover ---
    const humanHoverFn = async (selector, options) => {
        await ensureCursorInit();
        const callCfg = (0, config_js_1.mergeConfig)(cfg, options?.human_config ?? options);
        const timeout = options?.timeout ?? 30000;
        const force = options?.force ?? false;
        const skipChecks = options?._skipChecks ?? false;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        if (!force && !skipChecks)
            await (0, actionability_js_1.ensureActionable)(page, selector, actionability_js_1.CHECKS_HOVER, remainingMs(), force);
        if (callCfg.idle_between_actions) {
            await (0, mouse_js_1.humanIdle)(raw, cursor.x, cursor.y, callCfg);
        }
        const { box, cursorX, cursorY, didScroll } = await (0, scroll_js_1.scrollToElement)(page, raw, selector, cursor.x, cursor.y, callCfg, remainingMs());
        cursor.x = cursorX;
        cursor.y = cursorY;
        let finalBox = box;
        if (!force && didScroll) {
            await (0, actionability_js_1.ensureStable)(page, selector, remainingMs());
            finalBox = await page.locator(selector).first().boundingBox({ timeout: Math.max(1, remainingMs()) }) ?? box;
        }
        const target = (0, mouse_js_1.clickTarget)(finalBox, false, callCfg);
        if (!force) {
            await (0, actionability_js_1.checkPointerEvents)(page, selector, target.x, target.y, stealth, remainingMs());
        }
        await (0, mouse_js_1.humanMove)(raw, cursor.x, cursor.y, target.x, target.y, callCfg);
        cursor.x = target.x;
        cursor.y = target.y;
    };
    // --- type ---
    const humanTypeFn = async (selector, text, options) => {
        const callCfg = (0, config_js_1.mergeConfig)(cfg, options?.human_config ?? options);
        const timeout = options?.timeout ?? 30000;
        const force = options?.force ?? false;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        if (!force)
            await (0, actionability_js_1.ensureActionable)(page, selector, actionability_js_1.CHECKS_INPUT, remainingMs(), force);
        await (0, config_js_1.sleep)((0, config_js_1.randRange)(callCfg.field_switch_delay));
        await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config });
        await (0, config_js_1.sleep)((0, config_js_1.rand)(100, 250));
        const cdp = await ensureCdp();
        await (0, keyboard_js_1.humanType)(page, rawKb, text, callCfg, cdp);
    };
    // --- fill (clears existing content first) ---
    const humanFillFn = async (selector, value, options) => {
        const callCfg = (0, config_js_1.mergeConfig)(cfg, options?.human_config ?? options);
        const timeout = options?.timeout ?? 30000;
        const force = options?.force ?? false;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        if (!force)
            await (0, actionability_js_1.ensureActionable)(page, selector, actionability_js_1.CHECKS_INPUT, remainingMs(), force);
        await (0, config_js_1.sleep)((0, config_js_1.randRange)(callCfg.field_switch_delay));
        await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config });
        await (0, config_js_1.sleep)((0, config_js_1.rand)(100, 250));
        await originals.keyboardPress(SELECT_ALL);
        await (0, config_js_1.sleep)((0, config_js_1.rand)(30, 80));
        await originals.keyboardPress('Backspace');
        await (0, config_js_1.sleep)((0, config_js_1.rand)(50, 150));
        const cdp = await ensureCdp();
        await (0, keyboard_js_1.humanType)(page, rawKb, value, callCfg, cdp);
    };
    // --- clear ---
    const humanClearFn = async (selector, options) => {
        const timeout = options?.timeout ?? 30000;
        const force = options?.force ?? false;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        if (!force)
            await (0, actionability_js_1.ensureActionable)(page, selector, actionability_js_1.CHECKS_FOCUS, remainingMs(), force);
        if (!await isSelectorFocused(stealth, page, selector)) {
            await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config });
        }
        await (0, config_js_1.sleep)((0, config_js_1.rand)(50, 150));
        await originals.keyboardPress(SELECT_ALL);
        await (0, config_js_1.sleep)((0, config_js_1.rand)(30, 80));
        await originals.keyboardPress('Backspace');
    };
    // --- check ---
    const humanCheckFn = async (selector, options) => {
        const callCfg = (0, config_js_1.mergeConfig)(cfg, options?.human_config ?? options);
        const timeout = options?.timeout ?? 30000;
        const force = options?.force ?? false;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        if (!force)
            await (0, actionability_js_1.ensureActionable)(page, selector, actionability_js_1.CHECKS_CHECK, remainingMs(), force);
        if (callCfg.idle_between_actions) {
            await (0, mouse_js_1.humanIdle)(raw, cursor.x, cursor.y, callCfg);
        }
        const checked = await originals.isChecked(selector).catch(() => false);
        if (!checked) {
            await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config });
        }
    };
    // --- uncheck ---
    const humanUncheckFn = async (selector, options) => {
        const callCfg = (0, config_js_1.mergeConfig)(cfg, options?.human_config ?? options);
        const timeout = options?.timeout ?? 30000;
        const force = options?.force ?? false;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        if (!force)
            await (0, actionability_js_1.ensureActionable)(page, selector, actionability_js_1.CHECKS_CHECK, remainingMs(), force);
        if (callCfg.idle_between_actions) {
            await (0, mouse_js_1.humanIdle)(raw, cursor.x, cursor.y, callCfg);
        }
        const checked = await originals.isChecked(selector).catch(() => true);
        if (checked) {
            await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config });
        }
    };
    // --- selectOption ---
    const humanSelectOptionFn = async (selector, values, options) => {
        const timeout = options?.timeout ?? 30000;
        const force = options?.force ?? false;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        if (!force)
            await (0, actionability_js_1.ensureActionable)(page, selector, actionability_js_1.CHECKS_FOCUS, remainingMs(), force);
        await humanHoverFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config });
        await (0, config_js_1.sleep)((0, config_js_1.rand)(100, 300));
        return originals.selectOption(selector, values, options);
    };
    // --- press (checks focus first — avoids redundant mouse moves) ---
    const humanPressFn = async (selector, key, options) => {
        const timeout = options?.timeout ?? 30000;
        const force = options?.force ?? false;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        if (!force)
            await (0, actionability_js_1.ensureActionable)(page, selector, actionability_js_1.CHECKS_FOCUS, remainingMs(), force);
        if (!await isSelectorFocused(stealth, page, selector)) {
            await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config });
        }
        await (0, config_js_1.sleep)((0, config_js_1.rand)(50, 150));
        await originals.keyboardPress(key);
    };
    // --- pressSequentially ---
    const humanPressSequentiallyFn = async (selector, text, options) => {
        const callCfg = (0, config_js_1.mergeConfig)(cfg, options?.human_config ?? options);
        const timeout = options?.timeout ?? 30000;
        const force = options?.force ?? false;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        if (!force)
            await (0, actionability_js_1.ensureActionable)(page, selector, actionability_js_1.CHECKS_FOCUS, remainingMs(), force);
        if (!await isSelectorFocused(stealth, page, selector)) {
            await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config });
        }
        await (0, config_js_1.sleep)((0, config_js_1.rand)(100, 250));
        const cdp = await ensureCdp();
        await (0, keyboard_js_1.humanType)(page, rawKb, text, callCfg, cdp);
    };
    // --- tap ---
    const humanTapFn = async (selector, options) => {
        await humanClickFn(selector, options);
    };
    // Assign page-level patches
    page.goto = humanGoto;
    page.click = humanClickFn;
    page.dblclick = humanDblclickFn;
    page.hover = humanHoverFn;
    page.type = humanTypeFn;
    page.fill = humanFillFn;
    page.check = humanCheckFn;
    page.uncheck = humanUncheckFn;
    page.selectOption = humanSelectOptionFn;
    page.press = humanPressFn;
    page.pressSequentially = humanPressSequentiallyFn;
    page.tap = humanTapFn;
    page.clear = humanClearFn;
    // --- mouse patches ---
    page.mouse.move = async (x, y, options) => {
        await ensureCursorInit();
        await (0, mouse_js_1.humanMove)(raw, cursor.x, cursor.y, x, y, cfg);
        cursor.x = x;
        cursor.y = y;
    };
    page.mouse.click = async (x, y, options) => {
        await ensureCursorInit();
        await (0, mouse_js_1.humanMove)(raw, cursor.x, cursor.y, x, y, cfg);
        cursor.x = x;
        cursor.y = y;
        await (0, mouse_js_1.humanClick)(raw, false, cfg);
    };
    // --- keyboard patches ---
    page.keyboard.type = async (text, options) => {
        const cdp = await ensureCdp();
        await (0, keyboard_js_1.humanType)(page, rawKb, text, cfg, cdp);
    };
    // Store helpers for frame patching
    page._humanCursor = cursor;
    page._humanRaw = raw;
    page._humanRawKb = rawKb;
    page._humanOriginals = originals;
    page._humanClickFn = humanClickFn;
    page._humanHoverFn = humanHoverFn;
    page._humanClearFn = humanClearFn;
    page._humanPressFn = humanPressFn;
    page._humanPressSequentiallyFn = humanPressSequentiallyFn;
    page._humanTapFn = humanTapFn;
    page._ensureCursorInit = ensureCursorInit;
    // Initialize cursor immediately so it doesn't visibly jump from (0,0)
    cursor.x = (0, config_js_1.rand)(cfg.initial_cursor_x[0], cfg.initial_cursor_x[1]);
    cursor.y = (0, config_js_1.rand)(cfg.initial_cursor_y[0], cfg.initial_cursor_y[1]);
    originals.mouseMove(cursor.x, cursor.y).then(() => {
        cursor.initialized = true;
    }).catch(() => { });
    // --- Patch Frame-level methods (for sub-frames) ---
    patchFrames(page, cfg, cursor, raw, rawKb, originals, stealth);
    // --- Patch ElementHandle selectors (page.$, page.$$, page.waitForSelector) ---
    (0, elementhandle_js_1.patchPageElementHandles)(page, cfg, cursor, raw, rawKb, originals, stealth);
}
// ============================================================================
// Frame-level patching
// ============================================================================
/**
 * Patch Frame methods so Locator-based calls go through humanization.
 * All 13 methods patched: click, dblclick, hover, type, fill, check, uncheck,
 * selectOption, press, pressSequentially, tap, clear, dragAndDrop.
 */
function patchFrames(page, cfg, cursor, raw, rawKb, originals, stealth) {
    for (const frame of iterFrames(page)) {
        patchSingleFrame(frame, page, cfg, cursor, raw, rawKb, originals, stealth);
        // Patch frame-level ElementHandle selectors ($, $$, waitForSelector)
        (0, elementhandle_js_1.patchFrameElementHandles)(frame, page, cfg, cursor, raw, rawKb, originals, stealth);
    }
}
function firstFrameLocator(frame, selector) {
    const locator = frame.locator(selector);
    return typeof locator.first === 'function' ? locator.first() : locator;
}
async function isFrameInputElement(frame, selector) {
    return firstFrameLocator(frame, selector).evaluate((el) => {
        const tag = el.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea'
            || el.getAttribute('contenteditable') === 'true';
    }).catch(() => false);
}
async function isFrameSelectorFocused(frame, selector) {
    return firstFrameLocator(frame, selector).evaluate((el) => el === document.activeElement)
        .catch(() => false);
}
function patchSingleFrame(frame, page, cfg, cursor, raw, rawKb, originals, stealth) {
    if (frame._humanPatched)
        return;
    frame._humanPatched = true;
    // Save originals for methods that need fallback
    const origFrameClick = frame.click.bind(frame);
    const origFrameDblclick = frame.dblclick.bind(frame);
    const origFrameHover = frame.hover.bind(frame);
    const origFrameType = frame.type.bind(frame);
    const origFrameFill = frame.fill.bind(frame);
    const origFrameCheck = frame.check.bind(frame);
    const origFrameUncheck = frame.uncheck.bind(frame);
    const origFrameSelectOption = frame.selectOption.bind(frame);
    const origFramePress = frame.press.bind(frame);
    const origFramePressSequentially = frame.pressSequentially?.bind(frame);
    const origFrameTap = frame.tap?.bind(frame);
    const origFrameDragAndDrop = frame.dragAndDrop.bind(frame);
    const moveToFrameSelector = async (selector, options, inputBias, remainingMs) => {
        const callCfg = (0, config_js_1.mergeConfig)(cfg, options?.human_config ?? options);
        if (callCfg.idle_between_actions) {
            await (0, mouse_js_1.humanIdle)(raw, cursor.x, cursor.y, callCfg);
        }
        const locator = firstFrameLocator(frame, selector);
        if (typeof locator.scrollIntoViewIfNeeded === 'function') {
            await locator.scrollIntoViewIfNeeded({ timeout: Math.max(1, remainingMs()) }).catch(() => undefined);
        }
        const box = await locator.boundingBox({ timeout: Math.max(1, remainingMs()) }).catch(() => null);
        if (!box)
            return null;
        const isInput = inputBias || await isFrameInputElement(frame, selector);
        const target = (0, mouse_js_1.clickTarget)(box, isInput, callCfg);
        await (0, mouse_js_1.humanMove)(raw, cursor.x, cursor.y, target.x, target.y, callCfg);
        cursor.x = target.x;
        cursor.y = target.y;
        return { callCfg, isInput };
    };
    const frameClick = async (selector, options) => {
        const timeout = options?.timeout ?? 30000;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        const moved = await moveToFrameSelector(selector, options, false, remainingMs);
        if (!moved)
            return origFrameClick(selector, { ...options, timeout: Math.max(1, remainingMs()) });
        await (0, mouse_js_1.humanClick)(raw, moved.isInput, moved.callCfg);
    };
    const getFrameCdp = async () => stealth.getCdpSession().catch(() => null);
    const frameHover = async (selector, options) => {
        const timeout = options?.timeout ?? 30000;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        const moved = await moveToFrameSelector(selector, options, false, remainingMs);
        if (!moved)
            return origFrameHover(selector, { ...options, timeout: Math.max(1, remainingMs()) });
    };
    frame.click = frameClick;
    frame.dblclick = async (selector, options) => {
        const timeout = options?.timeout ?? 30000;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(0, deadline - Date.now());
        const moved = await moveToFrameSelector(selector, options, false, remainingMs);
        if (!moved)
            return origFrameDblclick(selector, { ...options, timeout: Math.max(1, remainingMs()) });
        await raw.down({ clickCount: 2 });
        await (0, config_js_1.sleep)((0, config_js_1.rand)(30, 60));
        await raw.up({ clickCount: 2 });
    };
    frame.hover = frameHover;
    frame.type = async (selector, text, options) => {
        const callCfg = (0, config_js_1.mergeConfig)(cfg, options?.human_config ?? options);
        await (0, config_js_1.sleep)((0, config_js_1.randRange)(callCfg.field_switch_delay));
        await frameClick(selector, options);
        await (0, config_js_1.sleep)((0, config_js_1.rand)(100, 250));
        const cdp = await getFrameCdp();
        await (0, keyboard_js_1.humanType)(page, rawKb, text, callCfg, cdp).catch(() => origFrameType(selector, text, options));
    };
    frame.fill = async (selector, value, options) => {
        const callCfg = (0, config_js_1.mergeConfig)(cfg, options?.human_config ?? options);
        await (0, config_js_1.sleep)((0, config_js_1.randRange)(callCfg.field_switch_delay));
        await frameClick(selector, options);
        await (0, config_js_1.sleep)((0, config_js_1.rand)(100, 250));
        await originals.keyboardPress(SELECT_ALL);
        await (0, config_js_1.sleep)((0, config_js_1.rand)(30, 80));
        await originals.keyboardPress('Backspace');
        await (0, config_js_1.sleep)((0, config_js_1.rand)(50, 150));
        const cdp = await getFrameCdp();
        await (0, keyboard_js_1.humanType)(page, rawKb, value, callCfg, cdp).catch(() => origFrameFill(selector, value, options));
    };
    frame.check = async (selector, options) => {
        const locator = firstFrameLocator(frame, selector);
        if (typeof locator.isChecked !== 'function')
            return origFrameCheck(selector, options);
        const checked = await locator.isChecked();
        if (!checked)
            await frameClick(selector, options).catch(() => origFrameCheck(selector, options));
    };
    frame.uncheck = async (selector, options) => {
        const locator = firstFrameLocator(frame, selector);
        if (typeof locator.isChecked !== 'function')
            return origFrameUncheck(selector, options);
        const checked = await locator.isChecked();
        if (checked)
            await frameClick(selector, options).catch(() => origFrameUncheck(selector, options));
    };
    frame.selectOption = async (selector, values, options) => {
        await frameHover(selector, options);
        await (0, config_js_1.sleep)((0, config_js_1.rand)(100, 300));
        return origFrameSelectOption(selector, values, options);
    };
    frame.press = async (selector, key, options) => {
        if (!await isFrameSelectorFocused(frame, selector)) {
            await frameClick(selector, options);
        }
        await (0, config_js_1.sleep)((0, config_js_1.rand)(50, 150));
        await originals.keyboardPress(key);
    };
    frame.pressSequentially = async (selector, text, options) => {
        const callCfg = (0, config_js_1.mergeConfig)(cfg, options?.human_config ?? options);
        if (!await isFrameSelectorFocused(frame, selector)) {
            await frameClick(selector, options);
        }
        await (0, config_js_1.sleep)((0, config_js_1.rand)(100, 250));
        const cdp = await getFrameCdp();
        await (0, keyboard_js_1.humanType)(page, rawKb, text, callCfg, cdp).catch(() => origFramePressSequentially?.(selector, text, options));
    };
    frame.tap = async (selector, options) => {
        await frameClick(selector, options).catch(() => origFrameTap?.(selector, options));
    };
    frame.clear = async (selector, options) => {
        if (!await isFrameSelectorFocused(frame, selector)) {
            await frameClick(selector, options);
        }
        await (0, config_js_1.sleep)((0, config_js_1.rand)(50, 150));
        await originals.keyboardPress(SELECT_ALL);
        await (0, config_js_1.sleep)((0, config_js_1.rand)(30, 80));
        await originals.keyboardPress('Backspace');
    };
    frame.dragAndDrop = async (source, target, options) => {
        const timeout = options?.timeout ?? 30000;
        const deadline = Date.now() + timeout;
        const remainingMs = () => Math.max(1, deadline - Date.now());
        const srcBox = await firstFrameLocator(frame, source).boundingBox({ timeout: remainingMs() }).catch(() => null);
        const tgtBox = await firstFrameLocator(frame, target).boundingBox({ timeout: remainingMs() }).catch(() => null);
        if (srcBox && tgtBox) {
            const sx = srcBox.x + srcBox.width / 2;
            const sy = srcBox.y + srcBox.height / 2;
            const tx = tgtBox.x + tgtBox.width / 2;
            const ty = tgtBox.y + tgtBox.height / 2;
            await page.mouse.move(sx, sy);
            await (0, config_js_1.sleep)((0, config_js_1.rand)(100, 200));
            await originals.mouseDown();
            await (0, config_js_1.sleep)((0, config_js_1.rand)(80, 150));
            await page.mouse.move(tx, ty);
            await (0, config_js_1.sleep)((0, config_js_1.rand)(80, 150));
            await originals.mouseUp();
        }
        else {
            return origFrameDragAndDrop(source, target, { ...options, timeout: Math.max(1, remainingMs()) });
        }
    };
}
function* iterFrames(page) {
    try {
        const mainFrame = page.mainFrame();
        yield mainFrame;
        for (const child of mainFrame.childFrames()) {
            yield child;
        }
    }
    catch { }
}
// ============================================================================
// Context-level patching
// ============================================================================
function patchContext(context, cfg) {
    const cursor = new CursorState();
    for (const page of context.pages()) {
        patchPage(page, cfg, cursor);
    }
    context.on('page', (page) => {
        if (!page._original) {
            patchPage(page, cfg, new CursorState());
        }
    });
    const origNewPage = context.newPage.bind(context);
    context.newPage = async () => {
        const page = await origNewPage();
        if (!page._original) {
            patchPage(page, cfg, new CursorState());
        }
        return page;
    };
}
// ============================================================================
// Browser-level patching
// ============================================================================
function patchBrowser(browser, cfg) {
    for (const context of browser.contexts()) {
        patchContext(context, cfg);
    }
    const origNewContext = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
        const context = await origNewContext(options);
        patchContext(context, cfg);
        return context;
    };
    const origNewPage = browser.newPage.bind(browser);
    browser.newPage = async (options) => {
        const page = await origNewPage(options);
        if (!page._original) {
            const ctx = page.context();
            if (!ctx._humanPatched) {
                patchContext(ctx, cfg);
                ctx._humanPatched = true;
            }
            patchPage(page, cfg, new CursorState());
        }
        return page;
    };
}
