---
description: Durable persistence rules for known chat/session IDs
---

# Chat State Persistence

Use a stable storage path so restarts/deploy-folder changes do not lose known chats.

## Storage Rules

1. Primary store must be `HORA_DATA_DIR/chats.json`.
2. Default `HORA_DATA_DIR` is `path.join(os.homedir(), '.hora-claw')` (Windows example: `C:/Users/<user>/.hora-claw`).
3. Never rely only on `process.cwd()` or repo-relative path for primary state.
4. Keep legacy readers for old paths during migration.

## Read Strategy

1. Read primary file first, then merge legacy files.
2. De-duplicate as strings.
3. On JSON parse failures, attempt recovery by extracting numeric chat IDs.
4. Log recovery events so operators can detect corrupted writes.

## Write Strategy

1. Use atomic file writes (temp file + rename) to avoid partial files.
2. Ensure parent directory exists before writing.
3. Optionally mirror to legacy files only when those files already exist.
4. Persist immediately when a new chat ID is discovered.

## Maintenance Rules

1. Keep persistence logic centralized (`readSavedChats`, `persistKnownChats`, merge helper).
2. Any schema/path changes must update startup migration path and this skill.
3. Dashboard and broadcast logic should consume in-memory merged set, not direct file reads.
