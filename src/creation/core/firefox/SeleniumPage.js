/**
 * SeleniumPage — a Playwright-`page`-compatible adapter backed by selenium-webdriver.
 *
 * AdsPower "FlowerBrowser" profiles are Firefox and don't speak CDP, so Playwright
 * can't drive them. This adapter exposes the slice of the Playwright `page` /
 * ElementHandle / Locator API that the bot actually uses, backed by geckodriver
 * attached to the already-running AdsPower Firefox via `--connect-existing`.
 *
 * Key parity concern: Playwright's CSS engine pierces open shadow DOM by default
 * (Reddit's shreddit-* components rely on this). Selenium's By.css does NOT. So all
 * selector-engine methods ($$, $, waitForSelector, click(sel), locator) route through
 * an injected shadow-piercing deep query. `evaluate(fn)` runs the caller's function
 * verbatim (it uses whatever DOM it wants), matching Playwright semantics.
 */

const { Builder, Key, Origin } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');

const DEFAULT_TIMEOUT = 30000;
const POLL_INTERVAL = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// In-page shadow-piercing query helpers, injected into every selector-engine call.
const DEEP_FN_SRC = `
function __deepAll(sel, ctx){
  const root = ctx || document;
  const out = []; const seen = new Set();
  (function walk(r){
    let nodes; try { nodes = r.querySelectorAll(sel); } catch(e){ nodes = null; }
    if (nodes){ for (let i=0;i<nodes.length;i++){ if(!seen.has(nodes[i])){ seen.add(nodes[i]); out.push(nodes[i]); } } }
    if (r.shadowRoot) walk(r.shadowRoot);            // root's OWN shadow tree (e.g. shreddit-post)
    let all; try { all = r.querySelectorAll('*'); } catch(e){ all = []; }
    for (let i=0;i<all.length;i++){ if (all[i].shadowRoot) walk(all[i].shadowRoot); }
  })(root);
  return out;
}
function __deepOne(sel, ctx){
  const root = ctx || document;
  let res = null;
  (function walk(r){
    if (res) return;
    let n; try { n = r.querySelector(sel); } catch(e){ n = null; }
    if (n){ res = n; return; }
    if (r.shadowRoot){ walk(r.shadowRoot); if (res) return; }
    let all; try { all = r.querySelectorAll('*'); } catch(e){ all = []; }
    for (let i=0;i<all.length;i++){ if (res) break; if (all[i].shadowRoot) walk(all[i].shadowRoot); }
  })(root);
  return res;
}`;

/** Convert a Playwright key string (e.g. 'Control+Enter', 'Escape') to Selenium key parts. */
function parseKey(key) {
    const NAMED = {
        escape: Key.ESCAPE, enter: Key.ENTER, delete: Key.DELETE, tab: Key.TAB,
        backspace: Key.BACK_SPACE, pagedown: Key.PAGE_DOWN, pageup: Key.PAGE_UP,
        arrowdown: Key.ARROW_DOWN, arrowup: Key.ARROW_UP, arrowleft: Key.ARROW_LEFT,
        arrowright: Key.ARROW_RIGHT, home: Key.HOME, end: Key.END, space: ' ',
    };
    const MODS = { control: Key.CONTROL, shift: Key.SHIFT, alt: Key.ALT, meta: Key.META };
    const parts = key.split('+');
    const main = parts[parts.length - 1];
    const mods = parts.slice(0, -1).map((m) => MODS[m.toLowerCase()]).filter(Boolean);
    const mainKey = NAMED[main.toLowerCase()] || main;
    return { mods, mainKey };
}

/** Wraps a Selenium WebElement to mimic a Playwright ElementHandle. */
class ElementHandle {
    constructor(page, el) {
        this.page = page;
        this.el = el; // selenium WebElement
    }

    async isVisible() {
        try { return await this.el.isDisplayed(); } catch { return false; }
    }

    async isEnabled() {
        try { return await this.el.isEnabled(); } catch { return false; }
    }

    async getAttribute(name) {
        try { return await this.el.getAttribute(name); } catch { return null; }
    }

    async textContent() {
        return this.getAttribute('textContent');
    }

    async innerText() {
        try { return await this.el.getText(); } catch { return ''; }
    }

    async scrollIntoViewIfNeeded() {
        await this.page.driver.executeScript(
            'arguments[0].scrollIntoView({block:"center",inline:"center"});', this.el
        );
    }

    async click() {
        await this.el.click();
    }

    async hover() {
        await this.page.driver.actions().move({ origin: this.el }).perform();
    }

    async type(text) {
        await this.el.sendKeys(text);
    }

    async press(key) {
        const { mods, mainKey } = parseKey(key);
        if (mods.length === 0) { await this.el.sendKeys(mainKey); return; }
        await this.el.sendKeys(Key.chord(...mods, mainKey));
    }

    async boundingBox() {
        return this.page.driver.executeScript(
            'const r=arguments[0].getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};',
            this.el
        );
    }

    /** Scoped shadow-piercing query within this element (Playwright ElementHandle.$). */
    async $(selector) {
        const el = await this.page.driver.executeScript(
            `${DEEP_FN_SRC}\nreturn __deepOne(arguments[1], arguments[0]);`, this.el, selector
        );
        return el ? new ElementHandle(this.page, el) : null;
    }

    async $$(selector) {
        const els = await this.page.driver.executeScript(
            `${DEEP_FN_SRC}\nreturn __deepAll(arguments[1], arguments[0]);`, this.el, selector
        );
        return (els || []).map((e) => new ElementHandle(this.page, e));
    }

    /** Playwright element-scoped evaluate: fn(element, arg). */
    async evaluate(fn, arg) {
        const script = `${DEEP_FN_SRC}\nreturn (${fn.toString()}).apply(null, arguments);`;
        return arg === undefined
            ? this.page.driver.executeScript(script, this.el)
            : this.page.driver.executeScript(script, this.el, arg);
    }
}

/** Mimics a Playwright Locator over a (shadow-piercing) selector. */
class Locator {
    constructor(page, selector, index = null) {
        this.page = page;
        this.selector = selector;
        this.index = index; // null = whole set; number = specific element
    }

    first() { return new Locator(this.page, this.selector, 0); }
    nth(i) { return new Locator(this.page, this.selector, i); }

    async count() {
        const els = await this.page._deepAll(this.selector);
        return els.length;
    }

    async _resolve() {
        const els = await this.page._deepAll(this.selector);
        const idx = this.index == null ? 0 : this.index;
        return els[idx] || null;
    }

    async _handle() {
        const el = await this._resolve();
        return el ? new ElementHandle(this.page, el) : null;
    }

    async isVisible() { const h = await this._handle(); return h ? h.isVisible() : false; }
    async getAttribute(n) { const h = await this._handle(); return h ? h.getAttribute(n) : null; }
    async innerText() { const h = await this._handle(); return h ? h.innerText() : ''; }
    async textContent() { const h = await this._handle(); return h ? h.textContent() : null; }
    async scrollIntoViewIfNeeded() { const h = await this._handle(); if (h) await h.scrollIntoViewIfNeeded(); }
    async hover() { const h = await this._handle(); if (h) await h.hover(); }
    async click() { const h = await this._handle(); if (h) await h.click(); }
    async evaluate(fn, arg) { const h = await this._handle(); return h ? h.evaluate(fn, arg) : null; }
}

class SeleniumPage {
    constructor(driver) {
        this.driver = driver;
        this._url = '';

        this.keyboard = {
            press: (key) => this._pressGlobal(key),
            type: (text) => this.driver.actions().sendKeys(text).perform(),
        };
        this.mouse = {
            // Playwright's mouse.move dispatches synthetic events without hit-testing.
            // Selenium's Actions API DOES hit-test and errors on hidden overlays
            // (e.g. Reddit's auth-flow-manager), so dispatch synthetic events via JS instead.
            move: (x, y) => this.driver.executeScript(
                'var x=arguments[0],y=arguments[1],t=document.elementFromPoint(x,y);' +
                'if(t){["mousemove","mouseover"].forEach(function(ty){t.dispatchEvent(' +
                'new MouseEvent(ty,{clientX:x,clientY:y,bubbles:true,cancelable:true}));});}',
                Math.round(x), Math.round(y)
            ).catch(() => {}),
            click: (x, y) => this._clickAt(Math.round(x), Math.round(y)),
            wheel: (dx, dy) => this.driver.executeScript('window.scrollBy(arguments[0], arguments[1]);', Math.round(dx), Math.round(dy)),
        };
        // Single-window model: expose enough of context/browser for callers that poke at it.
        this.context = {
            pages: () => [this],
            newPage: async () => this,
        };
    }

    /** Attach geckodriver to an already-running AdsPower Firefox profile. */
    static async attach({ webdriverPath, marionettePort }) {
        const service = new firefox.ServiceBuilder(webdriverPath)
            .addArguments('--marionette-port', String(marionettePort), '--connect-existing');

        const options = new firefox.Options();
        options.setPageLoadStrategy('eager'); // ~ domcontentloaded

        const driver = await new Builder()
            .forBrowser('firefox')
            .setFirefoxService(service)
            .setFirefoxOptions(options)
            .build();

        await driver.manage().setTimeouts({ pageLoad: 45000, script: 30000 });

        const page = new SeleniumPage(driver);
        // One-time detection diagnostic — navigator.webdriver=true is a strong bot tell.
        try {
            const wd = await driver.executeScript('return navigator.webdriver;');
            const handles = await driver.getAllWindowHandles();
            console.log(`   🔎 navigator.webdriver=${wd} · windows=${handles.length}`);
        } catch { /* non-fatal */ }
        return page;
    }

    // --- shadow-piercing primitives ---
    async _deepAll(selector) {
        return this.driver.executeScript(`${DEEP_FN_SRC}\nreturn __deepAll(arguments[0]);`, selector);
    }
    async _deepOne(selector) {
        return this.driver.executeScript(`${DEEP_FN_SRC}\nreturn __deepOne(arguments[0]);`, selector);
    }

    /**
     * If the current top-level browsing context was torn down (Reddit challenge
     * redirects / AdsPower closing a startup tab can do this), switch to a live
     * window handle so subsequent commands don't all fail. Returns true if recovered.
     */
    async _recoverWindow(err) {
        const m = (err && err.message) || '';
        if (!/BrowsingContext|no such window|does no longer exist|web element reference/i.test(m)) {
            return false;
        }
        try {
            const handles = await this.driver.getAllWindowHandles();
            if (handles && handles.length) {
                await this.driver.switchTo().window(handles[handles.length - 1]);
                return true;
            }
        } catch { /* connection itself is gone — unrecoverable here */ }
        return false;
    }

    // --- navigation ---
    async goto(url, opts = {}) {
        try {
            await this.driver.get(url);
        } catch (e) {
            if (await this._recoverWindow(e)) {
                try {
                    await this.driver.get(url); // retry once on a live window
                } catch (e2) {
                    throw new Error(`goto failed for ${url}: ${e2.message}`);
                }
            } else {
                throw new Error(`goto failed for ${url}: ${e.message}`);
            }
        }
        this._url = await this.driver.getCurrentUrl().catch(() => url);
    }

    async goBack() {
        await this.driver.navigate().back();
        this._url = await this.driver.getCurrentUrl().catch(() => this._url);
    }

    url() { return this._url; }

    async title() { return this.driver.getTitle(); }

    async currentUrl() {
        this._url = await this.driver.getCurrentUrl();
        return this._url;
    }

    // --- waiting ---
    async waitForTimeout(ms) { await sleep(ms); }

    async waitForSelector(selector, opts = {}) {
        const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
        const needVisible = opts.state === 'visible' || opts.state === undefined;
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const el = await this._deepOne(selector);
            if (el) {
                if (!needVisible) return new ElementHandle(this, el);
                const visible = await el.isDisplayed().catch(() => false);
                if (visible) return new ElementHandle(this, el);
            }
            await sleep(POLL_INTERVAL);
        }
        throw new Error(`waitForSelector timeout ${timeout}ms exceeded for: ${selector}`);
    }

    async waitForFunction(fn, arg, opts = {}) {
        const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
        const poll = opts.polling && Number.isInteger(opts.polling) ? opts.polling : POLL_INTERVAL;
        const script = `return (${fn.toString()}).apply(null, arguments);`;
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const res = arg === undefined
                ? await this.driver.executeScript(script).catch(() => null)
                : await this.driver.executeScript(script, arg).catch(() => null);
            if (res) return res;
            await sleep(poll);
        }
        throw new Error(`waitForFunction timeout ${timeout}ms exceeded`);
    }

    // --- selector engine (shadow-piercing, Playwright-parity) ---
    async $(selector) {
        const el = await this._deepOne(selector);
        return el ? new ElementHandle(this, el) : null;
    }

    async $$(selector) {
        const els = await this._deepAll(selector);
        return els.map((el) => new ElementHandle(this, el));
    }

    async $eval(selector, fn, arg) {
        const script = `${DEEP_FN_SRC}\nconst el = __deepOne(arguments[0]); if(!el) throw new Error('no element for ${selector.replace(/'/g, "")}'); return (${fn.toString()}).apply(null, [el, arguments[1]]);`;
        return this.driver.executeScript(script, selector, arg);
    }

    async $$eval(selector, fn, arg) {
        const script = `${DEEP_FN_SRC}\nconst out = __deepAll(arguments[0]); return (${fn.toString()}).apply(null, [out, arguments[1]]);`;
        return this.driver.executeScript(script, selector, arg);
    }

    locator(selector) { return new Locator(this, selector); }

    // --- actions ---
    async click(selector, opts = {}) {
        const handle = await this.waitForSelector(selector, { state: 'visible', timeout: opts.timeout });
        await handle.scrollIntoViewIfNeeded().catch(() => {});
        await handle.click();
    }

    /** Playwright page.evaluate: fn(arg). Runs caller's function verbatim in-page. */
    async evaluate(fn, arg) {
        const body = typeof fn === 'function' ? fn.toString() : String(fn);
        const script = `return (${body}).apply(null, arguments);`;
        return arg === undefined
            ? this.driver.executeScript(script)
            : this.driver.executeScript(script, arg);
    }

    /**
     * Click at viewport coords the way Playwright would: resolve the visible element
     * at that point (elementFromPoint skips hidden overlays) and issue a trusted
     * native click. Falls back to an Actions coordinate click if that fails.
     */
    async _clickAt(x, y) {
        let el = null;
        try {
            el = await this.driver.executeScript(
                'return document.elementFromPoint(arguments[0], arguments[1]);', x, y
            );
        } catch { /* fall through to actions */ }

        if (el) {
            try { await el.click(); return; } catch { /* covered/stale — try actions */ }
        }
        try {
            await this.driver.actions().move({ x, y, origin: Origin.VIEWPORT }).click().perform();
        } catch { /* a missed click, like Playwright clicking empty space */ }
    }

    async _pressGlobal(key) {
        const { mods, mainKey } = parseKey(key);
        if (mods.length === 0) {
            await this.driver.actions().sendKeys(mainKey).perform();
            return;
        }
        let a = this.driver.actions();
        for (const m of mods) a = a.keyDown(m);
        a = a.sendKeys(mainKey);
        for (const m of [...mods].reverse()) a = a.keyUp(m);
        await a.perform();
    }

    async close() {
        try { await this.driver.quit(); } catch { /* already gone */ }
    }
}

module.exports = { SeleniumPage, ElementHandle, Locator };
