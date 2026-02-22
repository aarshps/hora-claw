# Hora-claw

Hora-claw is a personalized autonomous agent built as a Telegram bot. It connects to the Gemini CLI running locally on your machine, acting as a conversational interface for powerful agentic capabilities.

## Features

- **Autonomous Agent**: Leverages the Gemini CLI (with YOLO mode) to autonomously execute tasks requested via Telegram.
- **Session Resume**: Automatically resumes the latest Gemini session to maintain context across interactions.
- **Markdown Rendering**: Properly parses and formats Gemini's markdown output into Telegram-compatible HTML, preserving spacing and styling.
- **Persistent Typing Indicator**: Shows a continuous "typing..." action in Telegram while Gemini is processing the request, providing real-time feedback.
- **Status Broadcasts**: Notifies all users who have interacted with the bot when Hora-claw goes online or offline.
- **Live Dashboard**: Exposes a real-time, dark-mode dashboard for linked sessions, activity, and errors.
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
   Create a `.env` file in the root directory and add your Telegram Bot Token:
   ```env
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

   # Optional: persistent data directory for chat IDs/state
   HORA_DATA_DIR=/absolute/path/for/hora-claw-data

   # Optional dashboard config
   DASHBOARD_HOST=0.0.0.0
   DASHBOARD_PORT=8787
   DASHBOARD_PUBLIC_BASE_URL=https://your-server-domain-or-ip

   # Optional startup online-status retry behavior
   ONLINE_STATUS_RETRY_INTERVAL_MS=30000
   ONLINE_STATUS_RETRY_MAX_ATTEMPTS=20
   ```

## Usage

Start the bot using the npm script. The bot will run in the background and log output to `bot.log`.

```bash
npm start
```

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

### Stopping the Bot

To gracefully stop the bot and allow it to broadcast its offline status, use `Ctrl+C` or send a termination signal to the Node process.

```bash
Stop-Process -Name "node" -Force # Windows PowerShell example
```

## How It Works

1. **Initialization**: At startup, the bot loads chat IDs from a persistent data directory (`HORA_DATA_DIR`, default `~/.hora-claw/chats.json`) and runs startup online-status delivery with retries for pending recipients.
2. **Receiving Messages**: When a user sends a message, the bot saves their Chat ID and starts a persistent typing indicator.
3. **Execution**: The bot spans a child process to execute the `gemini` CLI command, passing the user's message as the prompt. It attempts to resume the `latest` session. If no session exists, it falls back to a new session.
4. **Session + Status Tracking**: Runtime session state is tracked and streamed to the dashboard through server-sent events.
5. **Formatting**: The raw markdown output from Gemini is parsed using the `marked` library, converted to HTML, and stripped of tags not supported by Telegram using `striptags`.
6. **Replying**: The formatted HTML is sent back to the user in Telegram. Long responses are automatically chunked into 4000-character segments to comply with Telegram's limits.

## Files

- `index.js`: The main application logic containing the Telegram bot setup, Gemini CLI execution, and formatting.
- `package.json`: Project metadata and dependencies (`telegraf`, `dotenv`, `marked`, `striptags`).
- `~/.hora-claw/chats.json` (or `HORA_DATA_DIR/chats.json`): (Auto-generated) Stores Telegram Chat IDs for broadcasting status messages.
- `bot.log`: (Auto-generated) Standard output and error logs from the Node server and the underlying Gemini CLI process.

## Dependencies

- [telegraf](https://www.npmjs.com/package/telegraf) - Modern Telegram Bot API framework for Node.js
- [dotenv](https://www.npmjs.com/package/dotenv) - Loads environment variables from a `.env` file
- [marked](https://www.npmjs.com/package/marked) - A markdown parser and compiler
- [striptags](https://www.npmjs.com/package/striptags) - PHP `strip_tags` in Node.js, used to filter HTML tags for Telegram

## License

ISC
