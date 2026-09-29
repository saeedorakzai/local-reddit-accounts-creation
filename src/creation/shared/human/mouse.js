"use strict";
/**
 * cloakbrowser-human — Human-like mouse movement and clicking.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.humanMove = humanMove;
exports.clickTarget = clickTarget;
exports.humanClick = humanClick;
exports.humanIdle = humanIdle;
const config_js_1 = require("./config.js");
// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------
function easeInOut(t) {
    return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function bezier(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const uu = u * u;
    const uuu = uu * u;
    const tt = t * t;
    const ttt = tt * t;
    return {
        x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
        y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    };
}
function randomControlPoints(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx, dy);
    const px = -dy / (dist || 1);
    const py = dx / (dist || 1);
    const bias1 = (0, config_js_1.rand)(-0.3, 0.3) * dist;
    const bias2 = (0, config_js_1.rand)(-0.3, 0.3) * dist;
    return [
        { x: start.x + dx * 0.25 + px * bias1, y: start.y + dy * 0.25 + py * bias1 },
        { x: start.x + dx * 0.75 + px * bias2, y: start.y + dy * 0.75 + py * bias2 },
    ];
}
// ---------------------------------------------------------------------------
// Human mouse movement
// ---------------------------------------------------------------------------
async function humanMove(raw, startX, startY, endX, endY, cfg) {
    const dist = Math.hypot(endX - startX, endY - startY);
    if (dist < 1)
        return;
    const steps = Math.max(cfg.mouse_min_steps, Math.min(cfg.mouse_max_steps, Math.round(dist / cfg.mouse_steps_divisor)));
    const start = { x: startX, y: startY };
    const end = { x: endX, y: endY };
    const [cp1, cp2] = randomControlPoints(start, end);
    let burstCounter = 0;
    const burstSize = (0, config_js_1.randIntRange)(cfg.mouse_burst_size);
    for (let i = 0; i <= steps; i++) {
        const progress = i / steps;
        const easedT = easeInOut(progress);
        const pt = bezier(start, cp1, cp2, end, easedT);
        const wobbleAmp = Math.sin(Math.PI * progress) * cfg.mouse_wobble_max;
        const wx = pt.x + (Math.random() - 0.5) * 2 * wobbleAmp;
        const wy = pt.y + (Math.random() - 0.5) * 2 * wobbleAmp;
        await raw.move(Math.round(wx), Math.round(wy));
        burstCounter++;
        if (burstCounter >= burstSize && i < steps) {
            await (0, config_js_1.sleep)((0, config_js_1.randRange)(cfg.mouse_burst_pause));
            burstCounter = 0;
        }
    }
    if (Math.random() < cfg.mouse_overshoot_chance) {
        const overshootDist = (0, config_js_1.randRange)(cfg.mouse_overshoot_px);
        const angle = Math.atan2(endY - startY, endX - startX);
        const ovX = Math.round(endX + Math.cos(angle) * overshootDist);
        const ovY = Math.round(endY + Math.sin(angle) * overshootDist);
        await raw.move(ovX, ovY);
        await (0, config_js_1.sleep)((0, config_js_1.rand)(30, 70));
        const corrX = Math.round(endX + (Math.random() - 0.5) * 4);
        const corrY = Math.round(endY + (Math.random() - 0.5) * 4);
        await raw.move(corrX, corrY);
    }
}
// ---------------------------------------------------------------------------
// Human click
// ---------------------------------------------------------------------------
function clickTarget(box, isInput, cfg) {
    if (isInput) {
        const xFrac = (0, config_js_1.randRange)(cfg.click_input_x_range);
        const yFrac = (0, config_js_1.rand)(0.30, 0.70);
        return {
            x: Math.round(box.x + box.width * xFrac),
            y: Math.round(box.y + box.height * yFrac),
        };
    }
    const xFrac = (0, config_js_1.rand)(0.35, 0.65);
    const yFrac = (0, config_js_1.rand)(0.35, 0.65);
    return {
        x: Math.round(box.x + box.width * xFrac),
        y: Math.round(box.y + box.height * yFrac),
    };
}
async function humanClick(raw, isInput, cfg) {
    const aimDelay = isInput
        ? (0, config_js_1.randRange)(cfg.click_aim_delay_input)
        : (0, config_js_1.randRange)(cfg.click_aim_delay_button);
    await (0, config_js_1.sleep)(aimDelay);
    const holdTime = isInput
        ? (0, config_js_1.randRange)(cfg.click_hold_input)
        : (0, config_js_1.randRange)(cfg.click_hold_button);
    await raw.down();
    await (0, config_js_1.sleep)(holdTime);
    await raw.up();
}
async function humanIdle(raw, secondsOrCx, cxOrCy, cyOrCfg, maybeCfg) {
    const hasExplicitSeconds = maybeCfg !== undefined;
    const seconds = hasExplicitSeconds
        ? secondsOrCx
        : (0, config_js_1.rand)(cyOrCfg.idle_between_duration[0], cyOrCfg.idle_between_duration[1]);
    const cx = hasExplicitSeconds ? cxOrCy : secondsOrCx;
    const cy = hasExplicitSeconds ? cyOrCfg : cxOrCy;
    const cfg = hasExplicitSeconds ? maybeCfg : cyOrCfg;
    const endTime = Date.now() + seconds * 1000;
    let x = cx;
    let y = cy;
    while (Date.now() < endTime) {
        const dx = (Math.random() - 0.5) * 2 * cfg.idle_drift_px;
        const dy = (Math.random() - 0.5) * 2 * cfg.idle_drift_px;
        x += dx;
        y += dy;
        await raw.move(Math.round(x), Math.round(y));
        await (0, config_js_1.sleep)((0, config_js_1.randRange)(cfg.idle_pause_range));
    }
}
