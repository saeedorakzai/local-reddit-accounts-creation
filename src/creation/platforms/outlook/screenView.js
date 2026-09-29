/**
 * A snapshot of what the page is showing right now.
 *
 * Captured once per state-machine step and handed to every screen matcher, so
 * classifying 14 screens costs one URL read and one text read rather than 14.
 */

class ScreenView {
    constructor(page, url, text) {
        this.page = page;
        this.url = url || '';
        this.text = (text || '').toLowerCase();
    }

    static async capture(page) {
        let url = '';
        let text = '';

        try {
            url = typeof page.url === 'function' ? page.url() : page.url;
            if (url && typeof url.then === 'function') url = await url;
        } catch {
            url = '';
        }

        try {
            text = await page.$eval('body', (el) => el.innerText || '');
        } catch {
            text = '';
        }

        return new ScreenView(page, url, text);
    }

    /** True if any selector in the list resolves to a visible element. */
    async visible(selectors) {
        const list = Array.isArray(selectors) ? selectors : [selectors];
        for (const selector of list) {
            if (!selector) continue;
            try {
                const element = await this.page.$(selector);
                if (element && (await element.isVisible())) return true;
            } catch {
                // A selector the engine rejects must not abort the sweep.
            }
        }
        return false;
    }

    hasText(phrases) {
        const list = Array.isArray(phrases) ? phrases : [phrases];
        return list.some((phrase) => phrase && this.text.includes(String(phrase).toLowerCase()));
    }

    urlIncludes(patterns) {
        const list = Array.isArray(patterns) ? patterns : [patterns];
        const url = this.url.toLowerCase();
        return list.some((pattern) => pattern && url.includes(String(pattern).toLowerCase()));
    }
}

module.exports = { ScreenView };
