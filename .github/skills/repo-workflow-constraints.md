---
description: Operating constraints for code-only edits and direct main-branch delivery in this repository
---

# Repo Workflow Constraints

Use this playbook for routine Hora-claw maintenance under strict operator constraints.
Resolve mode from repo `.env` (or local env) key `HORA_AGENT_MODE`.
If missing or invalid, treat mode as `restricted`.

## Core Operating Mode

1. In `restricted` mode, treat this repo as code-change-only unless the user explicitly requests runtime execution.
2. In `restricted` mode, do not run `npm install`, `npm start`, build commands, or other long-lived app processes by default.
3. In `unrestricted` mode, install/run/build actions are allowed when needed for the task.
4. Prefer static verification (`node --check`, JSON parse checks, `rg`/`git diff` inspection) before expensive runtime actions.
5. Keep `.env.example` default at `HORA_AGENT_MODE=restricted`.

## Branch and Sync Rules

1. Work directly on `main` unless the user asks for a feature branch.
2. Pull latest `origin/main` before starting a new requested change.
3. Keep commits focused and map them to the user-requested change set.
4. Push immediately after checks pass.

## Release and Docs Coupling

1. For functional behavior changes, bump `package.json` version.
2. Update `release-notes.json` highlights for that same version.
3. When behavior or constraints change, update `.github/skills/*.md` in the same commit.
4. Keep each skill file at 100 lines or fewer (enforced by `SKILLS_STANDARD.md`).

## Safety Constraints

1. Preserve Gemini YOLO operation (`--yolo`) unless the user explicitly changes it.
2. Preserve per-user session isolation; never reintroduce global resume behavior.
3. Keep online/offline status messaging versioned and plain-text safe.
4. Avoid destructive git operations unless explicitly requested.

## Verification

1. Confirm `.env.example` contains `HORA_AGENT_MODE=restricted`.
2. If local `.env` sets `HORA_AGENT_MODE=unrestricted`, runtime actions are permitted on that machine only.
