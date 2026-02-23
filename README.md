# Hora-claw

Hora-claw is a personalized autonomous claw built for Telegram. It connects to the Gemini CLI running locally on your machine and provides a conversational interface for powerful capabilities.
Primary runtime home is a Windows PC (Beeyeswon laptop), so Windows-first examples are provided below.

## Features

- **Autonomous Claw**: Leverages the Gemini CLI (with YOLO mode) to autonomously execute tasks requested via Telegram.
- **Per-Chat Session Memory**: Each Telegram chat has its own Gemini session ID and isolated memory.
- **Markdown Rendering**: Properly parses and formats Gemini's markdown output into Telegram-compatible HTML, preserving spacing and styling.
- **Persistent Typing Indicator**: Shows a continuous "typing..." action in Telegram while Gemini is processing the request, providing real-time feedback.
- **Periodic Progress Updates**: Sends timed in-chat updates during long tasks so users can see ongoing progress.
- **Status Broadcasts**: Notifies all users who have interacted with the bot when Hora-claw goes online or offline.
- **Versioned Broadcasts**: Online/offline status messages include the current Hora-claw version.
- **Live Dashboard**: Exposes a real-time, dark-mode dashboard for linked sessions, activity, and errors.
- **Web + API + Script Ops**: Supports internet browsing tools, direct API calls, and secure temporary script execution with automatic cleanup.
- **Release Notes Broadcasts**: On a new version, users receive quick release notes once per chat when Hora-claw comes online.
- **Graceful Shutdown**: Handles `SIGINT` and `SIGTERM` signals to broadcast the offline status before exiting.

## Prerequisites

- Node.js (v14 or higher recommended)
- Telegram Bot Token (obtained from [@BotFather](https://t.me/BotFather))
- [Gemini CLI](https://github.com/google/gemini-cli) installed globally (`npm install -g @google/gemini-cli`) and authenticated.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/aarshps/hora-claw.git
   cd hora-claw
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Environment Variables:
   Copy `.env.example` to `.env` and set your values (Windows PowerShell):
   ```powershell
   Copy-Item .env.example .env
   ```
   If you use Git Bash:
   ```bash
   cp .env.example .env
   ```
   Required and common variables:
   ```env
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

   # Agent workflow mode for this machine/repo clone.
   # default behavior if unset/invalid: restricted
   # allowed values: restricted | unrestricted
   HORA_AGENT_MODE=restricted

   # Optional: persistent data directory for chat IDs/state
   # Windows example:
   HORA_DATA_DIR=C:/hora-claw/data

   # Optional dashboard config
   DASHBOARD_HOST=0.0.0.0
   DASHBOARD_PORT=8787
   DASHBOARD_PUBLIC_BASE_URL=https://your-server-domain-or-ip

   # Optional startup online-status retry behavior
   ONLINE_STATUS_RETRY_INTERVAL_MS=30000
   ONLINE_STATUS_RETRY_MAX_ATTEMPTS=20

   # Optional secure tool runner directory (used for temp scripts/execution)
   # Windows example:
   HORA_SECURE_TOOL_DIR=C:/hora-claw/secure-tools

   # Optional secure script/API limits
   HORA_SECURE_SCRIPT_TIMEOUT_MS=120000
   HORA_SECURE_SCRIPT_MAX_BUFFER_BYTES=4194304
   HORA_API_TIMEOUT_MS=45000
   HORA_API_MAX_RESPONSE_BYTES=524288

   # Optional Telegram send timeout and shutdown protection
   TELEGRAM_SEND_TIMEOUT_MS=15000
   SHUTDOWN_FORCE_EXIT_MS=15000

   # Optional periodic in-chat progress updates during long tasks
   HORA_PROGRESS_UPDATE_INITIAL_DELAY_MS=20000
   HORA_PROGRESS_UPDATE_INTERVAL_MS=30000

   # Optional Gemini sandbox override for Hora-claw calls (default false)
   HORA_GEMINI_SANDBOX=false
   ```

   Set `HORA_AGENT_MODE=unrestricted` only on machines where coding agents are allowed to run install/build/start commands.

## Usage

Start the bot using the npm script.

```bash
npm start
```

If you explicitly want file logging via shell redirection:

```bash
npm run start:log
```

Commands:
- `/dashboard` - returns the dashboard URL.
- `/version` - returns the current running version and release highlights.

### Dashboard

Open the dashboard at:

```text
http://<server-ip>:8787/dashboard
```

If configured differently, use:

```text
http://<DASHBOARD_HOST>:<DASHBOARD_PORT>/dashboard
```

Notes:
- If `DASHBOARD_PORT` is not set, the bot uses `PORT` (if present) and then falls back to `8787`.
- Health check endpoint: `/healthz`
- Telegram command `/dashboard` returns the currently configured dashboard URL.

### Secure Tool Runner

Hora-claw includes a local tool runner at:

```text
scripts/hora_tool_runner.js
```

It supports:
- `api`: outbound HTTP(S) API calls with method/headers/body support.
- `run-script`: executes temporary scripts (`node`, `python`, `bash`, `powershell`) in a secure folder.

For `run-script`, a temporary run directory is created under `HORA_SECURE_TOOL_DIR` (or default `%USERPROFILE%/.hora-claw/secure-tools` on Windows), and script artifacts are removed automatically after execution.

### Release Versioning

Version and release notes are sourced from:
- `package.json` -> `version`
- `release-notes.json` -> `version` + `highlights`

For each new release:
1. Bump `package.json` version.
2. Update `release-notes.json` highlights for that version.
3. Deploy/restart Hora-claw.

Optional helper:
```bash
npm run release:bump -- 1.1.1 "Short note 1" "Short note 2"
```

On startup, Hora-claw sends:
- Online message with version to all known chats.
- Quick release notes for the new version (once per chat per version).

### Stopping the Bot

To gracefully stop the bot and allow it to broadcast its offline status, use `Ctrl+C` or send a termination signal to the Node process.

```bash
Stop-Process -Name "node" -Force # Windows PowerShell example
```

## How It Works

1. **Initialization**: At startup, the bot loads chat IDs from a persistent data directory (`HORA_DATA_DIR`, default `%USERPROFILE%/.hora-claw/chats.json` on Windows) and runs startup online-status delivery with retries for pending recipients.
2. **Receiving Messages**: When a user sends a message, the bot saves their Chat ID and starts a persistent typing indicator.
3. **Execution**: The bot spawns a child process to execute the `gemini` CLI command in headless JSON mode, passing the user's message as the prompt. It resumes a session specific to that chat ID; if missing, it starts a new one and stores the returned session ID.
4. **Session + Status Tracking**: Runtime session state is tracked and streamed to the dashboard through server-sent events.
5. **Formatting**: The raw markdown output from Gemini is parsed using the `marked` library, converted to HTML, and stripped of tags not supported by Telegram using `striptags`.
6. **Replying**: The formatted HTML is sent back to the user in Telegram. Long responses are automatically chunked into 4000-character segments to comply with Telegram's limits.

## Files

- `index.js`: The main application logic containing the Telegram bot setup, Gemini CLI execution, and formatting.
- `package.json`: Project metadata and dependencies (`telegraf`, `dotenv`, `marked`, `striptags`).
- `%USERPROFILE%/.hora-claw/chats.json` (or `HORA_DATA_DIR/chats.json`): (Auto-generated) Stores Telegram Chat IDs for broadcasting status messages.
- `%USERPROFILE%/.hora-claw/gemini-sessions.json` (or `HORA_DATA_DIR/gemini-sessions.json`): (Auto-generated) Stores chat-to-session mappings for isolated memory.
- `bot.log`: (Optional) Created when using `npm run start:log`.

## Dependencies

- [telegraf](https://www.npmjs.com/package/telegraf) - Modern Telegram Bot API framework for Node.js
- [dotenv](https://www.npmjs.com/package/dotenv) - Loads environment variables from a `.env` file
- [marked](https://www.npmjs.com/package/marked) - A markdown parser and compiler
- [striptags](https://www.npmjs.com/package/striptags) - PHP `strip_tags` in Node.js, used to filter HTML tags for Telegram

## License

ISC
