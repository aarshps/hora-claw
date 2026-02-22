---
description: Executing the Gemini CLI persistently on Windows
---

# Gemini CLI Execution

Hora-claw relies on a global `gemini-cli` NPM package.

## Execution Rules
1. **Spawn Error Handling**: Always catch `spawn EINVAL` and `TimeoutErrors`. The CLI can fail to execute if buffers exceed limits or the Node event loop blocks. Provide `maxBuffer` and `timeout` limits to `exec`.
2. **Session Resumption**: Use `--resume latest` to maintain context. If the session fails to resume (watch `stderr` for "session not found" or "failed to resume"), automatically seamlessly fallback and execute the command again *without* the `--resume` flag to start a fresh sequence.
3. **Prompt Injection**: System instructions (e.g., "You are a human-like claw...") should be prepended to the user prompt string before passing it via `-p` to the CLI.
4. **Memory Wipe**: Implement `/reset` by calling `gemini --delete-session latest` rather than manually deleting files. Trap specifically for standard "missing session" errors to avoid throwing user-facing errors when deleting an already empty session.
