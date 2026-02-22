---
description: Architectural rules for the SSE Realtime Dashboard
---

# Local SSE Dashboard

Hora-claw exposes a built-in dashboard over HTTP + SSE.

## Endpoints and Contract

1. `GET /dashboard` (and `/`) serves the HTML dashboard.
2. `GET /api/state` returns current runtime snapshot.
3. `GET /events` streams snapshot updates via Server-Sent Events.
4. `GET /healthz` returns minimal readiness and port status.

## Startup and Reachability Rules

1. Start dashboard server independently of `bot.launch()`; dashboard must not depend on bot startup success.
2. Port selection order:
3. `DASHBOARD_PORT` -> `PORT` -> `8787`.
4. Support public URL override with `DASHBOARD_PUBLIC_BASE_URL`.
5. Log effective URL after successful bind.
6. On bind failures (`EADDRINUSE`, `EACCES`), try fallback candidates before giving up.

## Snapshot and Streaming

1. Snapshot source is `buildDashboardSnapshot()`.
2. Include runtime state, per-session state, and delivery metrics (`onlinePending`).
3. Keep open SSE responses in `dashboardClients`.
4. On client error/close, remove from set immediately.
5. Broadcast on state changes plus heartbeat interval.

## Shutdown Rules

1. On shutdown, end all SSE clients before closing server.
2. Reset dashboard readiness flags after close.
3. Keep cleanup idempotent; repeated stop calls should be safe.
