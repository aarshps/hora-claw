---
description: Executing the Gemini CLI persistently on Windows
---

# Gemini CLI Execution

Hora-claw shells out to a global Gemini CLI binary on Windows.

## Core Implementation Pattern

1. Use `exec(...)` for `gemini.cmd` commands; avoid `execFile(...)` for `.cmd` to prevent `spawn EINVAL`.
2. Build commands with quoted binary path:
3. Example shape: `"${GEMINI_PATH}" -p "..." --yolo --output-format json --resume "<session-id>"`.
4. Centralize execution in one helper (current code: `runGeminiCliCommand`) with:
5. `windowsHide: true`
6. bounded `timeout` (`GEMINI_EXEC_TIMEOUT_MS`)
7. bounded `maxBuffer` (`GEMINI_EXEC_MAX_BUFFER_BYTES`)
8. Parse JSON headless output (`response`, `session_id`, `error`) from stdout/stderr.
9. If `--output-format` is unsupported in installed CLI, fallback once to `--yolo` text output mode.
10. Force `GEMINI_SANDBOX=false` by default for bot calls (override via `HORA_GEMINI_SANDBOX`) to avoid missing sandbox-command failures.

## Resume and Reset Behavior

1. Never use global `--resume latest`; this causes cross-user memory sharing.
2. Store per-chat session IDs in `HORA_DATA_DIR/gemini-sessions.json`.
3. Resume using that chat's stored session ID only.
4. If resume target is missing (`failed to resume`, `session not found`, etc.), clear mapping and retry once without resume.
5. `/reset` must delete only that chat's stored session ID, then clear mapping.
6. Treat "session missing" as success (fresh state), not as user-facing failure.

## Reliability Guardrails

1. Wrap reset callback logic in defensive `try/catch` to avoid callback crashes.
2. Never treat non-fatal stderr alone as hard failure.
3. Filter known CLI noise lines (for example "YOLO mode is enabled...") before surfacing user-facing errors.
4. If process exit succeeded and a cleaned stdout response exists, treat it as valid output even if text includes words like "cannot" or "failed".
5. Keep a dedicated missing-session matcher (`isMissingSessionError`) and update it if CLI wording changes.
6. Preserve persona/system prefix behavior before passing `-p` prompt text.
7. If command invocation behavior changes, update this skill with exact error signatures.
