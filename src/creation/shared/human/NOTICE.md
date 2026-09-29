# Vendored: CloakBrowser human-behavior layer

These files are the compiled-to-CommonJS output of the `human/` module from
**CloakBrowser** (https://github.com/CloakHQ/CloakBrowser), MIT License,
Copyright (c) 2026 CloakHQ.

Only the behavioral humanization layer was vendored — Bézier mouse movement,
human-timed typing (with occasional typos), smooth accelerating/decelerating
scroll, and actionability auto-waits. None of CloakBrowser's C++ stealth
Chromium binary is used here; fingerprint stealth is provided by AdsPower.

The layer patches a standard Playwright `Browser` object in place, so it works
over the CDP connection AdsPower exposes (`chromium.connectOverCDP`).

Source: research/CloakBrowser-main/js/src/human/*.ts (target ES2022, module CommonJS).
Do not edit by hand — regenerate from source if upgrading.
