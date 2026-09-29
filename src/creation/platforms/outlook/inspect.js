/**
 * Live DOM reconnaissance.
 *
 * Dumps what a Microsoft sign-in screen actually contains, and which of the
 * configured selectors hit it. This is how an `unknown` outcome turns into a new
 * screen-table entry: run it, read the dump, add the selectors.
 *
 * Never records an input's value — only its structure. Passwords must not reach
 * a diagnostics file any more than they reach a log.
 */

const fs = require('fs');
const path = require('path');

const { SCREENS } = require('./screens');
const { scrub } = require('../../shared/redact');

const REPO_ROOT = require('../../projectRoot');
const MAX_TEXT = 1500;

/** Structure of every interactive element on the page. No values. */
const COLLECT = () => {
    const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            style.opacity !== '0'
        );
    };

    const isField = (el) => /^(input|textarea|select)$/i.test(el.tagName);

    const describe = (el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || null,
        name: el.getAttribute('name') || null,
        id: el.id || null,
        placeholder: el.getAttribute('placeholder') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        role: el.getAttribute('role') || null,
        testId: el.getAttribute('data-test-id') || el.getAttribute('data-testid') || null,
        // NEVER read el.value — for an input that is the typed password. Structure
        // only; button labels come from innerText, which fields don't have.
        text: isField(el) ? null : (el.innerText || '').trim().slice(0, 80) || null,
        visible: visible(el)
    });

    const all = (selector) => Array.from(document.querySelectorAll(selector));

    return {
        title: document.title,
        inputs: all('input, textarea, select').map(describe),
        buttons: all('button, input[type="submit"], input[type="button"], [role="button"]')
            .map(describe)
            .filter((b) => b.visible),
        headings: all('h1, h2, h3, [role="heading"]')
            .filter(visible)
            .map((el) => (el.innerText || '').trim())
            .filter(Boolean)
            .slice(0, 10),
        errors: all('[role="alert"], .alert-error, [id$="Error"]')
            .filter(visible)
            .map((el) => ({ id: el.id || null, text: (el.innerText || '').trim().slice(0, 200) }))
            .filter((e) => e.text),
        iframes: all('iframe').map((el) => ({
            id: el.id || null,
            src: (el.getAttribute('src') || '').slice(0, 120),
            visible: visible(el)
        })),
        links: all('a')
            .filter(visible)
            .map((el) => (el.innerText || '').trim())
            .filter(Boolean)
            .slice(0, 20)
    };
};

/** Which configured selector groups actually match right now. */
async function probeSelectors(page, cfg) {
    const hits = {};

    for (const [screenId, group] of Object.entries(cfg.selectors)) {
        for (const [key, value] of Object.entries(group)) {
            if (typeof value !== 'string') continue;      // skip text/url arrays
            let matched = false;
            try {
                const element = await page.$(value);
                matched = Boolean(element && (await element.isVisible()));
            } catch {
                matched = false;
            }
            if (matched) {
                hits[screenId] = hits[screenId] || [];
                hits[screenId].push(key);
            }
        }
    }

    return hits;
}

async function capture(page, cfg, view, screen, meta = {}) {
    let dom = {};
    try {
        dom = await page.evaluate(COLLECT);
    } catch (error) {
        dom = { error: error.message };
    }

    const selectorHits = await probeSelectors(page, cfg);

    // Enumerate child frames (privacy notice, captcha, etc. render inside them).
    const frames = [];
    try {
        for (const frame of page.frames()) {
            if (frame === page.mainFrame()) continue;
            let buttons = [];
            try {
                buttons = await frame.evaluate(() =>
                    Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"], a[role="button"]'))
                        .map((el) => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim())
                        .filter(Boolean)
                        .slice(0, 12)
                );
            } catch {
                buttons = ['<cross-origin — unreadable>'];
            }
            frames.push({ url: (frame.url() || '').slice(0, 90), buttons });
        }
    } catch {
        // ignore
    }

    return {
        frames,
        ...meta,
        url: view.url,
        title: dom.title || null,
        classifiedAs: screen ? screen.id : null,
        terminal: screen ? Boolean(screen.terminal) : null,
        outcome: screen?.outcome || null,
        selectorHits,
        headings: dom.headings || [],
        errors: dom.errors || [],
        inputs: (dom.inputs || []).filter((i) => i.visible),
        hiddenInputCount: (dom.inputs || []).filter((i) => !i.visible).length,
        buttons: dom.buttons || [],
        iframes: (dom.iframes || []).filter((f) => f.visible || f.src),
        links: dom.links || [],
        text: view.text.slice(0, MAX_TEXT)
    };
}

/** Console rendering — what I read to decide what the table needs. */
function render(snapshot) {
    const lines = [];
    const list = (items) => (items.length ? items.join(', ') : '(none)');

    lines.push('');
    lines.push('─'.repeat(74));
    lines.push(`STEP ${snapshot.step ?? '?'}  [${snapshot.phase}]  →  ` +
        `${snapshot.classifiedAs || '❓ UNRECOGNISED'}`);
    lines.push('─'.repeat(74));
    lines.push(`url:    ${snapshot.url}`);
    lines.push(`title:  ${snapshot.title || '(none)'}`);

    if (snapshot.headings.length) {
        lines.push(`headings: ${list(snapshot.headings)}`);
    }

    if (snapshot.errors.length) {
        lines.push('errors:');
        for (const e of snapshot.errors) {
            lines.push(`   #${e.id || '?'}  "${e.text}"`);
        }
    }

    lines.push('inputs:');
    if (!snapshot.inputs.length) {
        lines.push('   (none visible)');
    }
    for (const i of snapshot.inputs) {
        lines.push(
            `   <${i.tag}${i.type ? ` type=${i.type}` : ''}` +
            `${i.name ? ` name=${i.name}` : ''}${i.id ? ` id=${i.id}` : ''}` +
            `${i.ariaLabel ? ` aria-label="${i.ariaLabel}"` : ''}>`
        );
    }

    lines.push('buttons:');
    if (!snapshot.buttons.length) {
        lines.push('   (none visible)');
    }
    for (const b of snapshot.buttons.slice(0, 12)) {
        lines.push(
            `   <${b.tag}${b.type ? ` type=${b.type}` : ''}${b.id ? ` id=${b.id}` : ''}>` +
            ` "${b.text || b.ariaLabel || ''}"`
        );
    }

    if (snapshot.iframes.length) {
        lines.push('iframes:');
        for (const f of snapshot.iframes) {
            lines.push(`   #${f.id || '?'}  ${f.src}`);
        }
    }

    if (snapshot.frames && snapshot.frames.length) {
        lines.push('child frames:');
        for (const f of snapshot.frames) {
            lines.push(`   ${f.url}`);
            if (f.buttons.length) lines.push(`      buttons: ${f.buttons.join(' | ')}`);
        }
    }

    const hitKeys = Object.keys(snapshot.selectorHits);
    lines.push(`selector hits: ${hitKeys.length
        ? hitKeys.map((k) => `${k}(${snapshot.selectorHits[k].join('+')})`).join('  ')
        : '(none — nothing in outlook.js matches this page)'}`);

    if (!snapshot.classifiedAs) {
        lines.push('');
        lines.push('page text:');
        lines.push(snapshot.text.split('\n').filter(Boolean).slice(0, 25)
            .map((l) => `   ${l}`).join('\n'));
    }

    return lines.join('\n');
}

/**
 * A hook for OutlookLoginSession that prints each screen and saves a JSON
 * snapshot. `stopBeforePassword` halts before any credential is typed.
 */
function createInspector({ account, stopBeforePassword = false } = {}) {
    const dir = path.join(REPO_ROOT, 'diagnostics');
    fs.mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeEmail = (account?.email || 'unknown').replace(/[^a-z0-9]/gi, '_');
    const file = path.join(dir, `${safeEmail}-${stamp}.json`);
    const snapshots = [];

    return {
        file,
        snapshots,
        onStep: async ({ step, view, screen, page, cfg, phase }) => {
            const raw = await capture(page, cfg, view, screen, { step, phase });
            // Backstop: even though we never read input.value, scrub the whole
            // snapshot so no registered secret can reach the console or disk.
            const snapshot = JSON.parse(scrub(JSON.stringify(raw)));
            snapshots.push(snapshot);
            console.log(scrub(render(snapshot)));

            fs.writeFileSync(file, JSON.stringify(snapshots, null, 2) + '\n', 'utf8');

            if (stopBeforePassword && screen?.id === 'passwordInput') {
                return { stop: true, reason: 'reached the password screen (--safe)' };
            }
            return null;
        }
    };
}

module.exports = { createInspector, capture, render, probeSelectors, SCREENS };
