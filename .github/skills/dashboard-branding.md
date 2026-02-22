---
description: Dashboard logo/favicon branding rules using rounded SVG output
---

# Dashboard Branding

Dashboard brand assets are served from `index.js` HTTP routes.

## Asset Routes

1. `GET /logo.svg` serves raw `logo.svg` from repo root.
2. `GET /logo-round.svg` serves rounded-clipped SVG generated from `logo.svg`.
3. `GET /favicon.svg` serves the same rounded output as `/logo-round.svg`.

## Rendering Rules

1. Keep rounded rendering in a shared helper (`renderRoundedLogoSvg`).
2. Rounded output must clip the source SVG itself; avoid fake circle wrappers around square image blocks.
3. Preserve SVG MIME type and cache headers for all logo/favicon endpoints.

## Dashboard HTML Integration

1. Header logo image source must be `/logo-round.svg`.
2. Favicon link must be `/favicon.svg`.
3. Avoid separate CSS canvas wrappers that distort or mask the logo incorrectly.

## When Updating Logo

1. Replace `logo.svg` asset if needed.
2. Verify both `/logo-round.svg` and `/favicon.svg` still render correctly from the same source.
3. Keep header and favicon routes in sync; do not fork rendering logic.

## Verification

1. `node --check index.js`
2. Confirm `index.js` contains:
3. `<link rel="icon" ... href="/favicon.svg">`
4. `<img src="/logo-round.svg" ...>`
