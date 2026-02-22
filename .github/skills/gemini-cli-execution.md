---
description: Executing the Gemini CLI persistently on Windows
---

# Gemini CLI Execution

Hora-claw shells out to a global Gemini CLI binary on Windows.

## Core Implementation Pattern

1. Use `exec(...)` for `gemini.cmd` commands; avoid `execFile(...)` for `.cmd` to prevent `spawn EINVAL`.
2. Build commands with quoted binary path:
3. Example shape: `"${GEMINI_PATH}" -p "..." --yolo --resume latest`.
4. Centralize execution in one helper (current code: `runGeminiCliCommand`) with:
5. `windowsHide: true`
6. bounded `timeout` (`GEMINI_EXEC_TIMEOUT_MS`)
7. bounded `maxBuffer` (`GEMINI_EXEC_MAX_BUFFER_BYTES`)

## Resume and Reset Behavior

1. Default to `--resume latest` for continuity.
2. If stderr indicates missing resume session (`failed to resume`, `not found`), retry once without resume.
3. `/reset` must call `--delete-session latest`.
4. Treat "session missing" as success (fresh state), not as user-facing failure.
5. Only mark reset as error for non-missing-session failures.

## Reliability Guardrails

1. Wrap reset callback logic in defensive `try/catch` to avoid callback crashes.
2. Never treat non-fatal stderr alone as hard failure.
3. Keep a dedicated missing-session matcher (`isMissingSessionError`) and update it if CLI wording changes.
4. Preserve persona/system prefix behavior before passing `-p` prompt text.
5. If command invocation behavior changes, update this skill with exact error signatures.
