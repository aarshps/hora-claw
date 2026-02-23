---
description: Fast resume checklist for future coding sessions on Hora-claw runtime behavior and invariants
---

# Session Handoff Checklist

Use this first when resuming work to avoid reintroducing past regressions.

## Runtime Host Profile

1. Primary runtime home is Beeyeswon Windows machine.
2. `.gemini/settings.json` must keep `tools.sandbox=false`.
3. Do not add restrictive `tools.allowed`/`tools.core` lists on runtime host.

## Identity and Voice

1. Hora-claw should present itself as a personal claw.
2. Avoid bot/agent/project framing unless user explicitly sets project context.
3. `/start` greeting and `normalizeConversationalVoice(...)` must preserve this behavior.

## Session and Reset Safety

1. Session memory is per-chat using `HORA_DATA_DIR/gemini-sessions.json`.
2. Never use global `--resume latest`.
3. `/reset` must only clear current chat session mapping.
4. Missing-session errors during reset/resume are success-path (fresh start), not hard failures.

## Online/Offline and Versioning

1. Online/offline broadcasts include `Hora-claw v<version>`.
2. Release notes are sent once per chat per version.
3. Every functional change should bump `package.json` + `release-notes.json`.

## Long-Running UX and Dashboard

1. Keep typing loop for long tasks.
2. Keep periodic progress updates (`HORA_PROGRESS_UPDATE_INITIAL_DELAY_MS`, `HORA_PROGRESS_UPDATE_INTERVAL_MS`).
3. Dashboard SSE snapshots should include progress metadata (`progressMessage`, `lastProgressAt`).
4. Keep dashboard branding routes aligned (`/logo-round.svg`, `/favicon.svg`).

## Workflow and Skills Hygiene

1. Follow `.env` mode: `HORA_AGENT_MODE=restricted|unrestricted`.
2. In restricted mode, prefer code edits + static checks unless user asks for runtime actions.
3. Keep `.github/skills` updated with behavior changes in the same PR/commit.
4. Keep each skill file <= 100 lines.
