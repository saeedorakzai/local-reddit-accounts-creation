/**
 * Timing and intent.
 *
 * The vendored layer in human/ makes an action look human — Bézier mouse paths,
 * keystroke timing. This decides *when* to act: how long to read a screen, how
 * long to hesitate before a consequential click.
 *
 * Trimmed from the reference project: everything about feeds, scroll sessions,
 * upvotes, and container batching was dropped. None of it applies to a sign-in
 * form, and leaving it here invites someone to reintroduce it.
 */

/** Mean reading speed in characters per second, plus a floor for glance-reads. */
const READ_CHARS_PER_SEC = 18;
const MIN_READ_MS = 600;
const MAX_READ_MS = 6000;

class HumanBehavior {
    constructor(page, timing = {}) {
        this.page = page;
        this.timing = timing;
    }

    randomBetween(min, max) {
        const lo = Math.min(min, max);
        const hi = Math.max(min, max);
        return Math.floor(Math.random() * (hi - lo + 1)) + lo;
    }

    /** Box-Muller, clamped to ±2σ so a tail draw never stalls a run. */
    gaussianRandom(mean, stdDev) {
        let u = 0;
        let v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        const clamped = Math.max(-2, Math.min(2, z));
        return mean + clamped * stdDev;
    }

    gaussianBetween(min, max) {
        const lo = Math.min(min, max);
        const hi = Math.max(min, max);
        const mean = (lo + hi) / 2;
        const stdDev = (hi - lo) / 4;
        return Math.round(Math.max(lo, Math.min(hi, this.gaussianRandom(mean, stdDev))));
    }

    async sleep(ms) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms))));
    }

    /** A normally distributed pause. Fixed delays are a fingerprint. */
    async gaussianSleep(minMs, maxMs) {
        await this.sleep(this.gaussianBetween(minMs, maxMs));
    }

    /** Scales with how much text is on screen. */
    async readingPause(textLength = 100) {
        const base = (textLength / READ_CHARS_PER_SEC) * 1000;
        const target = Math.max(MIN_READ_MS, Math.min(MAX_READ_MS, base));
        await this.gaussianSleep(target * 0.7, target * 1.3);
    }

    /** The beat between finishing reading and deciding. */
    async thinkingPause() {
        await this.gaussianSleep(500, 1800);
    }

    /**
     * Read the screen, think, then act. Use before anything consequential —
     * submitting credentials, answering "Stay signed in?".
     */
    async hesitateBefore(action, { textLength = 120 } = {}) {
        await this.readingPause(textLength);
        await this.thinkingPause();
        return action();
    }

    /** How much text the page is actually showing, for readingPause(). */
    async visibleTextLength() {
        try {
            const text = await this.page.$eval('body', (el) => el.innerText || '');
            return text.trim().length;
        } catch {
            return 200;
        }
    }

    async isVisible(selector) {
        try {
            const element = await this.page.$(selector);
            if (!element) return false;
            return await element.isVisible();
        } catch {
            return false;
        }
    }

    /** First visible match across a comma-joined or array selector list. */
    async firstVisible(selectors) {
        const list = Array.isArray(selectors) ? selectors : [selectors];
        for (const selector of list) {
            if (!selector) continue;
            try {
                const element = await this.page.$(selector);
                if (element && (await element.isVisible())) {
                    return { element, selector };
                }
            } catch {
                // A malformed or unsupported selector should not abort the sweep.
            }
        }
        return null;
    }

    /** Move to the element and click it. Motion comes from the humanize layer. */
    async humanClick(element) {
        await element.scrollIntoViewIfNeeded().catch(() => {});
        await this.gaussianSleep(120, 380);
        await element.click();
    }

    async humanHover(element) {
        await element.scrollIntoViewIfNeeded().catch(() => {});
        await element.hover();
        await this.gaussianSleep(150, 450);
    }

    /**
     * Click the first visible selector from the list.
     * @returns {Promise<boolean>} whether anything was clicked
     */
    async clickFirstVisible(selectors) {
        const hit = await this.firstVisible(selectors);
        if (!hit) return false;
        await this.humanClick(hit.element);
        return true;
    }

    async clearField(element) {
        try {
            await element.click({ clickCount: 3 });      // select existing text
        } catch {
            await element.click().catch(() => {});
        }
        // Works regardless of platform modifier.
        await element.press('Control+A').catch(() => {});
        await element.press('Meta+A').catch(() => {});
        await element.press('Delete').catch(() => {});
    }

    /**
     * Type into the first visible match, then confirm the field holds exactly what
     * was intended.
     *
     * This matters most for passwords: the humanize layer injects occasional typos,
     * and while it corrects them itself, an uncorrected one would submit a wrong
     * password — a false rejection that, repeated, is exactly what locks a Microsoft
     * account. So we read the value back and retype until it matches; if it never
     * does, we throw rather than submit a bad value.
     *
     * @returns {Promise<boolean>} false only when no field matched the selectors
     */
    async typeInto(selectors, text, { verify = true, maxAttempts = 4 } = {}) {
        const hit = await this.firstVisible(selectors);
        if (!hit) return false;

        const element = hit.element;
        const delay = this.timing.typeDelay || this.randomBetween(60, 140);

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await this.humanClick(element);
            await this.gaussianSleep(150, 400);
            await this.clearField(element);
            await this.gaussianSleep(100, 250);

            await element.type(text, { delay });

            if (!verify) return true;

            let value;
            try {
                value = await element.inputValue();
            } catch {
                // If the field's value can't be read, don't guess — accept the type
                // rather than loop forever. Passwords always support inputValue().
                return true;
            }

            if (value === text) return true;

            await this.gaussianSleep(250, 600);
        }

        // Never submit a value we could not enter exactly.
        throw new Error(
            `Field did not accept the intended value exactly after ${maxAttempts} attempts`
        );
    }

    /**
     * Click the first visible match across the main frame AND every child frame.
     * Consent notices and captchas render inside same-site iframes whose buttons
     * the main-frame query cannot see.
     * @returns {Promise<boolean>}
     */
    async clickFirstVisibleInAnyFrame(selectors) {
        if (await this.clickFirstVisible(selectors)) return true;

        const list = Array.isArray(selectors) ? selectors : [selectors];
        for (const frame of this.page.frames()) {
            for (const selector of list) {
                if (!selector) continue;
                try {
                    const element = await frame.$(selector);
                    if (element && (await element.isVisible())) {
                        await element.scrollIntoViewIfNeeded().catch(() => {});
                        await this.gaussianSleep(120, 300);
                        await element.click();
                        return true;
                    }
                } catch {
                    // cross-origin or bad selector — keep scanning
                }
            }
        }
        return false;
    }

    async maybe(probability, fn) {
        if (Math.random() < probability) return fn();
        return null;
    }

    pickRandom(items) {
        return items[Math.floor(Math.random() * items.length)];
    }
}

module.exports = HumanBehavior;
