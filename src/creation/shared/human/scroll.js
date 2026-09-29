"use strict";
/**
 * cloakbrowser-human — Human-like scrolling via mouse wheel events.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.humanScrollIntoView = humanScrollIntoView;
exports.scrollToElement = scrollToElement;
const config_js_1 = require("./config.js");
const mouse_js_1 = require("./mouse.js");
function isInViewport(bounds, viewportHeight, cfg) {
    const topEdge = bounds.y;
    const bottomEdge = bounds.y + bounds.height;
    const zoneTop = viewportHeight * cfg.scroll_target_zone[0];
    const zoneBottom = viewportHeight * cfg.scroll_target_zone[1];
    return topEdge >= zoneTop && bottomEdge <= zoneBottom;
}
async function smoothWheel(raw, delta, cfg) {
    const absD = Math.abs(delta);
    const sign = delta > 0 ? 1 : -1;
    let sent = 0;
    while (sent < absD) {
        const stepSize = (0, config_js_1.rand)(20, 40);
        const chunk = Math.min(stepSize, absD - sent);
        await raw.wheel(0, Math.round(chunk) * sign);
        sent += chunk;
        await (0, config_js_1.sleep)((0, config_js_1.rand)(8, 20));
    }
}
/**
 * Humanized scrolling that takes an arbitrary ``getBox`` callable.
 *
 * Used by both ``scrollToElement`` (selector-based) and the ElementHandle
 * ``scrollIntoViewIfNeeded`` patch so the same accelerate → cruise →
 * decelerate → overshoot behavior runs everywhere.
 */
async function humanScrollIntoView(page, raw, getBox, cursorX, cursorY, cfg) {
    // Headed launches default to no_viewport so the page tracks the real OS
    // window; page.viewportSize() is then null. Fall back to the live window
    // dimensions so humanize works headed (the stealth-relevant mode).
    let viewport = page.viewportSize();
    if (!viewport) {
        viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    }
    if (!viewport || !viewport.height)
        throw new Error('Viewport size not available');
    let box = await getBox();
    if (!box)
        throw new Error('Element not found while scrolling into view');
    if (isInViewport(box, viewport.height, cfg)) {
        return { box, cursorX, cursorY, didScroll: false };
    }
    // Move cursor into scroll area
    const scrollAreaX = Math.round(viewport.width * (0, config_js_1.rand)(0.3, 0.7));
    const scrollAreaY = Math.round(viewport.height * (0, config_js_1.rand)(0.3, 0.7));
    await (0, mouse_js_1.humanMove)(raw, cursorX, cursorY, scrollAreaX, scrollAreaY, cfg);
    cursorX = scrollAreaX;
    cursorY = scrollAreaY;
    await (0, config_js_1.sleep)((0, config_js_1.randRange)(cfg.scroll_pre_move_delay));
    // Calculate scroll distance
    const targetY = viewport.height * (0, config_js_1.rand)(cfg.scroll_target_zone[0], cfg.scroll_target_zone[1]);
    const elementCenter = box.y + box.height / 2;
    const distanceToScroll = elementCenter - targetY;
    const direction = distanceToScroll > 0 ? 1 : -1;
    const absDistance = Math.abs(distanceToScroll);
    const avgDelta = (cfg.scroll_delta_base[0] + cfg.scroll_delta_base[1]) / 2;
    const totalClicks = Math.max(3, Math.ceil(absDistance / avgDelta));
    const accelSteps = (0, config_js_1.randIntRange)(cfg.scroll_accel_steps);
    const decelSteps = (0, config_js_1.randIntRange)(cfg.scroll_decel_steps);
    let scrolled = 0;
    // Scroll loop: accelerate → cruise → decelerate
    for (let i = 0; i < totalClicks; i++) {
        let delta;
        let pause;
        if (i < accelSteps) {
            delta = (0, config_js_1.rand)(80, 100);
            pause = (0, config_js_1.randRange)(cfg.scroll_pause_slow);
        }
        else if (i >= totalClicks - decelSteps) {
            delta = (0, config_js_1.rand)(60, 90);
            pause = (0, config_js_1.randRange)(cfg.scroll_pause_slow);
        }
        else {
            delta = (0, config_js_1.randRange)(cfg.scroll_delta_base);
            pause = (0, config_js_1.randRange)(cfg.scroll_pause_fast);
        }
        delta *= 1 + (Math.random() - 0.5) * 2 * cfg.scroll_delta_variance;
        delta = Math.round(delta) * direction;
        await smoothWheel(raw, delta, cfg);
        scrolled += Math.abs(delta);
        await (0, config_js_1.sleep)(pause);
        // Check visibility every 3 steps
        if (i % 3 === 2 || i === totalClicks - 1) {
            box = await getBox();
            if (box && isInViewport(box, viewport.height, cfg)) {
                break;
            }
        }
        if (scrolled >= absDistance * 1.1)
            break;
    }
    // Optional overshoot + correction
    if (Math.random() < cfg.scroll_overshoot_chance) {
        const overshootPx = Math.round((0, config_js_1.randRange)(cfg.scroll_overshoot_px)) * direction;
        await smoothWheel(raw, overshootPx, cfg);
        await (0, config_js_1.sleep)((0, config_js_1.randRange)(cfg.scroll_settle_delay));
        const corrections = (0, config_js_1.randIntRange)([1, 2]);
        for (let c = 0; c < corrections; c++) {
            const corrDelta = Math.round((0, config_js_1.rand)(40, 80)) * -direction;
            await smoothWheel(raw, corrDelta, cfg);
            await (0, config_js_1.sleep)((0, config_js_1.rand)(100, 250));
        }
    }
    // Settle
    await (0, config_js_1.sleep)((0, config_js_1.randRange)(cfg.scroll_settle_delay));
    box = await getBox();
    if (!box)
        throw new Error('Element lost after scrolling into view');
    return { box, cursorX, cursorY, didScroll: true };
}
/**
 * Selector-based humanized scroll.
 *
 * ``timeout`` is forwarded to Playwright's ``boundingBox({ timeout })`` so
 * callers like ``page.click('#x', { timeout: 5000 })`` can wait longer for
 * slow-loading elements (#172). Default matches Playwright's 30000ms when not specified.
 *
 * Returns `{ box, cursorX, cursorY, didScroll }`.
 */
async function scrollToElement(page, raw, selector, cursorX, cursorY, cfg, timeout) {
    return humanScrollIntoView(page, raw, () => getElementBox(page, selector, timeout), cursorX, cursorY, cfg);
}
async function getElementBox(page, selector, timeout = 30000) {
    const el = page.locator(selector).first();
    try {
        const box = await el.boundingBox({ timeout: Math.max(1, timeout) });
        return box;
    }
    catch {
        return null;
    }
}
