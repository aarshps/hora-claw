---
description: Patterns for handling Telegram Bot interactions safely and avoiding timeouts
---

# Telegram Bot Patterns

## Timeouts & Safe Replies
The Telegraf API handles requests. Be cautious of timeout windows (`TELEGRAM_HANDLER_TIMEOUT_MS`). 

1. **Safe Replies**: When executing long-running Agent commands (e.g., Gemini CLI), always wrap `ctx.reply` in a `catch` block to prevent the bot from crashing if the connection expires or the user blocks the bot. Use a `safeReply` wrapper.
2. **Chunking**: Telegram has a 4096 character limit. When sending long Agent responses, convert them to HTML and slice them into chunks of ~4000 characters.
3. **HTML Formatting**: `marked` parses markdown to HTML. Strip unsupported tags with `striptags`, allowing only `['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'a', 'code', 'pre']`.
4. **Typing Indicator**: Run `ctx.sendChatAction('typing')` in a `setInterval` (e.g., every 4s) while waiting for long background tasks to prevent Telegram from dropping the typing status. Always `clearInterval` in both `try` and `catch` blocks.
5. **Graceful Degradation**: If markdown parsing fails (error `can't parse entities`), fallback to sending raw text without the `parse_mode` parameter.
