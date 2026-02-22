---
description: Patterns for handling Telegram Bot interactions safely and avoiding timeouts
---

# Telegram Bot Patterns

## Request and Timeout Safety

1. Configure Telegraf with explicit `handlerTimeout` (env: `TELEGRAM_HANDLER_TIMEOUT_MS`) for long CLI operations.
2. Add global `bot.catch(...)` to capture middleware exceptions and keep process alive.
3. Use `safeReply(...)` wrapper for all non-trivial replies and fallback paths.
4. Never leave promise-returning reply calls unhandled inside catch branches.

## Command Routing Rules

1. Prevent command text from entering generic text pipeline:
2. Guard `bot.on('text')` with command detection (`/^\/.../`) and early return.
3. Keep command handlers (`/reset`, `/dashboard`, `/version`) isolated from Gemini prompt execution flow.

## Response Formatting Rules

1. Convert markdown to HTML with `marked`.
2. Strip unsupported tags using `striptags`; allow only Telegram-safe subset.
3. Chunk long outbound messages at about 4000 characters (Telegram hard limit is 4096).
4. On `replyWithHTML` failures, fallback to plain text via `safeReply(...)`.

## Long-Running Interaction UX

1. While Gemini runs, send `typing` action on interval (~4s).
2. Always clear typing interval in both success and error paths.
3. On CLI failure, update session error state and send a bounded error summary to user.
