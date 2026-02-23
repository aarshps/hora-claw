---
description: Reliable startup online/offline broadcast delivery patterns
---

# Status Broadcast Delivery

Online/offline announcements must be reliable across restarts and transient Telegram errors.

## Versioned Message Rules

1. Online and offline announcements must include `Hora-claw v<version>`.
2. Use message builders per chat (`messageBuilder`) instead of one static string.
3. Keep base status text plain (no raw markdown markers like `*`).

## Startup Online Delivery

1. Build a pending set from known chats at startup.
2. Attempt immediate delivery for all pending recipients.
3. Mark successful chat IDs in a delivered set (`bootOnlineNotifiedChats`).
4. Keep unsuccessful recipients in pending set and retry asynchronously.
5. For chats not yet announced on current version, include quick release notes in online message.
6. Persist successful version announcements in `release-announcements.json`.

## Retry Loop Rules

1. Use interval retries (`ONLINE_STATUS_RETRY_INTERVAL_MS`).
2. Cap attempts (`ONLINE_STATUS_RETRY_MAX_ATTEMPTS`) to avoid infinite loops.
3. Guard against overlapping runs with in-flight lock.
4. Stop loop when pending set becomes empty or bot goes offline.
5. Log attempt summary: sent, failed, pending.

## Per-Chat Fallback

1. On any incoming chat interaction, if startup online was not delivered for that chat:
2. Trigger immediate single-chat online send attempt.
3. If it still fails, keep chat in pending set for background retry.
4. On success, update per-chat announced version ledger.

## Telegram Error Handling

1. Respect Telegram `retry_after` rate-limit hints before retrying.
2. If parse-mode formatting causes failure, retry without parse mode.
3. Never crash on send failure; log and continue.

## Offline Delivery

1. Send offline message during graceful shutdown.
2. Stop online retry loop before shutdown broadcast.
3. Keep offline send bounded (small retry count) so shutdown does not hang indefinitely.
4. Offline messages should include the currently running version.

## Shutdown Lifecycle Safety

1. Treat signal handling as single-flight (`shutdownInProgress`) to avoid duplicate cleanup races.
2. Add a forced-exit timeout (`SHUTDOWN_FORCE_EXIT_MS`) so Ctrl+C cannot leave process hanging indefinitely.
3. Bound Telegram send wait time during shutdown using per-send timeout (`TELEGRAM_SEND_TIMEOUT_MS`).
4. On a second termination signal during shutdown, exit immediately.
