---
description: Version source-of-truth and startup release-note announcement workflow
---

# Release Versioning

Hora-claw release identity and startup notes are version-driven.

## Source of Truth

1. Runtime version comes from `package.json` (`version` field).
2. Release highlights come from `release-notes.json` (`highlights` array).
3. If `release-notes.json.version` differs from `package.json.version`, broadcast still uses package version and logs warning.

## Runtime Wiring

1. `index.js` loads release info at startup (`loadReleaseInfo`).
2. `runtimeState.version` and `runtimeState.releaseHighlights` must stay populated.
3. `/version` command returns current version and release highlights.

## Per-Chat Release Tracking

1. Announcement ledger file: `HORA_DATA_DIR/release-announcements.json`.
2. Format is `{ "<chatId>": "<last_announced_version>" }`.
3. On successful online send for a chat, record current version via `markReleaseAnnounced`.
4. Persist changes atomically using `writeFileAtomic`.

## Startup Messaging Rules

1. Online message must include `Hora-claw v<version>`.
2. Include quick release notes only when chat has not yet received current version.
3. Offline message must include `Hora-claw v<version>`.
4. Release note bullets should stay short and human-readable.

## Updating Releases

1. Helper script: `scripts/bump_release.js`.
2. NPM wrapper: `npm run release:bump -- <version> "note1" "note2"`.
3. Every functional change should include:
4. `package.json` version bump.
5. `release-notes.json` highlights update.
6. Keep highlights concise (max 6 are used by runtime).

## Verification

1. `node --check index.js`
2. `node --check scripts/bump_release.js`
3. `node -e "JSON.parse(require('fs').readFileSync('release-notes.json','utf8'))"`
