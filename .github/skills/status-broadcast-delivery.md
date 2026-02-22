---
description: Reliable startup online/offline broadcast delivery patterns
---

# Status Broadcast Delivery

Online/offline announcements must be reliable across restarts and transient Telegram errors.

## Startup Online Delivery

1. Build a pending set from known chats at startup.
2. Attempt immediate delivery for all pending recipients.
3. Mark successful chat IDs in a delivered set (`bootOnlineNotifiedChats`).
4. Keep unsuccessful recipients in pending set and retry asynchronously.

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

## Telegram Error Handling

1. Respect Telegram `retry_after` rate-limit hints before retrying.
2. If parse-mode formatting causes failure, retry without parse mode.
3. Never crash on send failure; log and continue.

## Offline Delivery

1. Send offline message during graceful shutdown.
2. Stop online retry loop before shutdown broadcast.
3. Keep offline send bounded (small retry count) so shutdown does not hang indefinitely.
