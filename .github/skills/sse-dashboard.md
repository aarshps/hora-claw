---
description: Architectural rules for the SSE Realtime Dashboard
---

# Local SSE Dashboard

Hora-claw runs a local HTTP server that streams session activities to a dashboard interface via Server-Sent Events (SSE).

## Key Patterns
1. **State Snapshots**: The standard update mechanism is `buildDashboardSnapshot()`. It aggregates the global `runtimeState` and active `sessions` map into a JSON object.
2. **Dashboard Clients**: Hold open HTTP responses in a global `dashboardClients` Set. Every time a chat updates its status or a heartbeat fires (e.g., every 5s), iterate through the set and `res.write` the chunk. Remove clients that throw error or fire `'close'`.
3. **Active Windows**: Differentiate between "Linked" sessions (known to the bot) and "Active" sessions (seen within `ACTIVE_WINDOW_MS` threshold, default 10m).
4. **Graceful Shutdown**: Always terminate the Dashboard HTTP server cleanly during `SIGINT`/`SIGTERM`. Iterate over `dashboardClients` and explicitly `.end()` them before calling `dashboardServer.close()`. This prevents Node from hanging.
