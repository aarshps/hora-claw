const { Telegraf } = require('telegraf');
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
require('dotenv').config();

function parsePositiveNumber(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

const TELEGRAM_HANDLER_TIMEOUT_MS = parsePositiveNumber(process.env.TELEGRAM_HANDLER_TIMEOUT_MS, 30 * 60 * 1000);
const GEMINI_EXEC_TIMEOUT_MS = parsePositiveNumber(process.env.GEMINI_EXEC_TIMEOUT_MS, 20 * 60 * 1000);
const GEMINI_EXEC_MAX_BUFFER_BYTES = parsePositiveNumber(process.env.GEMINI_EXEC_MAX_BUFFER_BYTES, 10 * 1024 * 1024);

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {
    handlerTimeout: TELEGRAM_HANDLER_TIMEOUT_MS
});
const DATA_DIR = process.env.HORA_DATA_DIR || path.join(os.homedir(), '.hora-claw');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const LEGACY_CHATS_FILES = Array.from(new Set([
    path.join(__dirname, 'chats.json'),
    path.resolve(process.cwd(), 'chats.json')
])).filter(filePath => filePath !== CHATS_FILE);
const LOGO_SVG_FILE = path.join(__dirname, 'logo.svg');
const GEMINI_PATH = 'C:\\Users\\Aarsh\\AppData\\Roaming\\npm\\gemini.cmd';

const DASHBOARD_HOST = process.env.DASHBOARD_HOST || '0.0.0.0';
const DASHBOARD_PORT = parsePositiveNumber(process.env.DASHBOARD_PORT || process.env.PORT, 8787);
const APP_PORT_FALLBACK = parsePositiveNumber(process.env.PORT, 0);
const DASHBOARD_PUBLIC_BASE_URL = (process.env.DASHBOARD_PUBLIC_BASE_URL || '').trim();
const ACTIVE_WINDOW_MS = Number(process.env.DASHBOARD_ACTIVE_WINDOW_MS || 10 * 60 * 1000);
const ONLINE_STATUS_MESSAGE = '🟢 *Hora-claw is online!* I am ready to assist you.';
const OFFLINE_STATUS_MESSAGE = '🔴 *Hora-claw is going offline!* I will be back shortly.';
const ONLINE_STATUS_RETRY_INTERVAL_MS = parsePositiveNumber(process.env.ONLINE_STATUS_RETRY_INTERVAL_MS, 30 * 1000);
const ONLINE_STATUS_RETRY_MAX_ATTEMPTS = Math.max(1, Math.floor(parsePositiveNumber(process.env.ONLINE_STATUS_RETRY_MAX_ATTEMPTS, 20)));

const dashboardClients = new Set();
const sessions = new Map();
const bootOnlineNotifiedChats = new Set();
const pendingOnlineStatusChats = new Set();
let dashboardServer = null;
let dashboardStartPromise = null;
let dashboardPortInUse = DASHBOARD_PORT;
let onlineRetryTimer = null;
let onlineRetryInFlight = false;
let onlineRetryAttempts = 0;

const runtimeState = {
    startedAt: Date.now(),
    botOnline: false,
    totalMessages: 0,
    lastResetAt: null,
    lastOnlineBroadcastAt: null,
    dashboardReady: false
};

function ensureDataDir() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error(`Failed to prepare data directory ${DATA_DIR}:`, error);
    }
}

function parseChatIdsFromRawContent(content, sourcePath) {
    try {
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .map(item => String(item).trim())
            .filter(Boolean);
    } catch (jsonError) {
        // Recover from partial/corrupted writes by extracting numeric IDs from raw text.
        const recovered = Array.from(new Set((content.match(/-?\d{6,}/g) || []).map(value => value.trim())));
        if (recovered.length > 0) {
            console.warn(`Recovered ${recovered.length} chat id(s) from non-JSON data in ${sourcePath}.`);
        } else {
            console.error(`Failed to parse chat IDs from ${sourcePath}:`, jsonError.message);
        }
        return recovered;
    }
}

function readSavedChats() {
    const filesToRead = [CHATS_FILE, ...LEGACY_CHATS_FILES];

    const mergedChatIds = new Set();
    for (const filePath of filesToRead) {
        if (!fs.existsSync(filePath)) {
            continue;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const parsedChatIds = parseChatIdsFromRawContent(content, filePath);
            for (const chatId of parsedChatIds) {
                mergedChatIds.add(String(chatId));
            }
        } catch (error) {
            console.error(`Failed to read chat IDs from ${filePath}`, error);
        }
    }

    return Array.from(mergedChatIds);
}

ensureDataDir();
const knownChats = new Set(readSavedChats());
console.log(`Loaded ${knownChats.size} known chat(s) for status broadcasts from ${CHATS_FILE}.`);

function writeFileAtomic(filePath, content) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, content);
    try {
        fs.renameSync(tempPath, filePath);
    } catch (renameError) {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            fs.renameSync(tempPath, filePath);
            return;
        }

        throw renameError;
    }
}

function persistKnownChats() {
    const serialized = JSON.stringify(Array.from(knownChats), null, 2);
    const filesToWrite = [CHATS_FILE];
    for (const legacyFile of LEGACY_CHATS_FILES) {
        if (fs.existsSync(legacyFile)) {
            filesToWrite.push(legacyFile);
        }
    }

    for (const filePath of filesToWrite) {
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            writeFileAtomic(filePath, serialized);
        } catch (error) {
            console.error(`Failed to write chat IDs to ${filePath}`, error);
        }
    }
}

if (knownChats.size > 0) {
    persistKnownChats();
}

function mergeKnownChatsFromDisk() {
    let added = 0;
    for (const chatId of readSavedChats()) {
        const key = String(chatId);
        if (!knownChats.has(key)) {
            knownChats.add(key);
            getSession(key);
            added += 1;
        }
    }

    if (added > 0) {
        persistKnownChats();
    }

    return added;
}

function getSession(chatId) {
    const key = String(chatId);

    if (!sessions.has(key)) {
        sessions.set(key, {
            chatId: key,
            linkedAt: Date.now(),
            lastSeenAt: null,
            lastReplyAt: null,
            status: 'idle',
            messageCount: 0,
            lastError: null
        });
    }

    return sessions.get(key);
}

function hydrateSessionsFromKnownChats() {
    for (const chatId of knownChats) {
        getSession(chatId);
    }
}

function sendSse(res, event, payload) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildDashboardSnapshot() {
    const now = Date.now();
    const sessionList = Array.from(sessions.values()).map(session => {
        const isActive = session.status === 'processing'
            || (session.lastSeenAt !== null && (now - session.lastSeenAt) <= ACTIVE_WINDOW_MS);

        return {
            chatId: session.chatId,
            linkedAt: session.linkedAt,
            lastSeenAt: session.lastSeenAt,
            lastReplyAt: session.lastReplyAt,
            status: session.status,
            messageCount: session.messageCount,
            lastError: session.lastError,
            isActive
        };
    }).sort((a, b) => {
        const left = a.lastSeenAt || a.linkedAt || 0;
        const right = b.lastSeenAt || b.linkedAt || 0;
        return right - left;
    });

    return {
        generatedAt: now,
        activeWindowMs: ACTIVE_WINDOW_MS,
        runtimeState,
        dashboard: {
            ready: runtimeState.dashboardReady,
            host: DASHBOARD_HOST,
            port: dashboardPortInUse,
            url: getDashboardUrl(dashboardPortInUse),
            healthUrl: `${getDashboardUrl(dashboardPortInUse).replace(/\/dashboard$/, '')}/healthz`
        },
        totals: {
            linked: sessionList.length,
            active: sessionList.filter(item => item.isActive).length,
            processing: sessionList.filter(item => item.status === 'processing').length,
            errors: sessionList.filter(item => item.status === 'error').length,
            onlinePending: pendingOnlineStatusChats.size
        },
        sessions: sessionList
    };
}

function broadcastDashboardUpdate(reason) {
    if (dashboardClients.size === 0) {
        return;
    }

    const snapshot = buildDashboardSnapshot();
    for (const client of dashboardClients) {
        try {
            sendSse(client, 'snapshot', { reason, snapshot });
        } catch (error) {
            dashboardClients.delete(client);
        }
    }
}

function renderDashboardPage() {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hora-claw Dashboard</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    :root {
      --bg: #0b0f14;
      --panel: #101720;
      --line: #273341;
      --text: #d3dde7;
      --muted: #8da0b3;
      --accent: #3aa4ff;
      --good: #23b26d;
      --warn: #d9a441;
      --bad: #e05d6f;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: "JetBrains Mono", "SFMono-Regular", Consolas, Menlo, monospace;
    }

    main {
      max-width: 980px;
      margin: 24px auto;
      padding: 20px;
    }

    .panel {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 10px;
      padding: 16px;
    }

    h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
    }

    .panel-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }

    .brand-logo-canvas {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.02);
      display: grid;
      place-items: center;
      overflow: hidden;
      flex: 0 0 auto;
    }

    .brand-logo {
      width: 26px;
      height: 26px;
      object-fit: contain;
    }

    .header-meta {
      color: var(--muted);
      font-size: 12px;
      margin-top: 2px;
    }

    .top {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
    }

    .metric {
      min-width: 140px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.01);
    }

    .metric .label {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }

    .metric .value {
      font-size: 20px;
      margin-top: 4px;
    }

    .status-bar {
      margin: 8px 0 16px 0;
      color: var(--muted);
      font-size: 12px;
    }

    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 7px;
      background: var(--warn);
    }

    .status-dot.ok { background: var(--good); }
    .status-dot.bad { background: var(--bad); }
    .status-dot.warn { background: var(--warn); }

    .list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .node {
      position: relative;
      margin-left: 10px;
      padding: 0 0 14px 28px;
      border-left: 1px solid var(--line);
    }

    .node:last-child {
      padding-bottom: 0;
      border-left-color: transparent;
    }

    .node::before {
      content: '';
      position: absolute;
      left: -6px;
      top: 3px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 2px solid var(--accent);
      background: var(--panel);
    }

    .node::after {
      content: '->';
      position: absolute;
      left: 10px;
      top: -1px;
      color: var(--accent);
      font-size: 11px;
    }

    .node.active::before { border-color: var(--good); }
    .node.status-error::before { border-color: var(--bad); }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }

    .title {
      font-size: 13px;
      color: var(--text);
    }

    .badge {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      text-transform: uppercase;
      color: var(--muted);
    }

    .node.status-processing .badge {
      color: var(--good);
      border-color: var(--good);
    }

    .node.status-error .badge {
      color: var(--bad);
      border-color: var(--bad);
    }

    .node.status-idle .badge {
      color: var(--accent);
      border-color: var(--accent);
    }

    .meta {
      margin-top: 5px;
      color: var(--muted);
      font-size: 12px;
    }

    .meta.error {
      color: var(--bad);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .empty {
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 14px;
      color: var(--muted);
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <div class="panel-header">
        <div class="brand-logo-canvas">
          <img src="/logo.svg" alt="Hora-claw logo" class="brand-logo" />
        </div>
        <div>
          <h1>Hora-claw Session Links</h1>
          <div class="header-meta">Live graph of linked chat sessions and runtime status.</div>
        </div>
      </div>
      <div class="top">
        <article class="metric">
          <div class="label">Linked Sessions</div>
          <div class="value" id="metric-linked">0</div>
        </article>
        <article class="metric">
          <div class="label">Active Sessions</div>
          <div class="value" id="metric-active">0</div>
        </article>
        <article class="metric">
          <div class="label">Processing</div>
          <div class="value" id="metric-processing">0</div>
        </article>
        <article class="metric">
          <div class="label">Errors</div>
          <div class="value" id="metric-errors">0</div>
        </article>
        <article class="metric">
          <div class="label">Online Pending</div>
          <div class="value" id="metric-online-pending">0</div>
        </article>
      </div>
      <div class="status-bar">
        <span class="status-dot warn" id="stream-dot"></span>
        stream: <span id="stream-status">connecting</span> |
        bot: <span id="bot-status">offline</span> |
        updated: <span id="updated-at">never</span> |
        active window: <span id="active-window">0m</span>
      </div>
      <ul class="list" id="session-list"></ul>
    </section>
  </main>
  <script>
    (function () {
      var linkedEl = document.getElementById('metric-linked');
      var activeEl = document.getElementById('metric-active');
      var processingEl = document.getElementById('metric-processing');
      var errorsEl = document.getElementById('metric-errors');
      var onlinePendingEl = document.getElementById('metric-online-pending');
      var botStatusEl = document.getElementById('bot-status');
      var updatedAtEl = document.getElementById('updated-at');
      var activeWindowEl = document.getElementById('active-window');
      var listEl = document.getElementById('session-list');
      var streamDotEl = document.getElementById('stream-dot');
      var streamStatusEl = document.getElementById('stream-status');

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function formatAge(timestamp) {
        if (!timestamp) return 'never';
        var diff = Date.now() - Number(timestamp);
        if (diff < 1000) return 'now';

        var units = [
          ['d', 86400000],
          ['h', 3600000],
          ['m', 60000],
          ['s', 1000]
        ];

        for (var i = 0; i < units.length; i += 1) {
          var amount = Math.floor(diff / units[i][1]);
          if (amount >= 1) {
            return amount + units[i][0] + ' ago';
          }
        }

        return 'now';
      }

      function formatClock(timestamp) {
        if (!timestamp) return 'never';
        return new Date(Number(timestamp)).toLocaleString();
      }

      function setStreamState(label, level) {
        streamStatusEl.textContent = label;
        streamDotEl.className = 'status-dot ' + level;
      }

      function render(snapshot) {
        linkedEl.textContent = snapshot.totals.linked;
        activeEl.textContent = snapshot.totals.active;
        processingEl.textContent = snapshot.totals.processing;
        errorsEl.textContent = snapshot.totals.errors;
        onlinePendingEl.textContent = snapshot.totals.onlinePending;
        botStatusEl.textContent = snapshot.runtimeState.botOnline ? 'online' : 'offline';
        updatedAtEl.textContent = formatClock(snapshot.generatedAt);
        activeWindowEl.textContent = Math.round(snapshot.activeWindowMs / 60000) + 'm';

        listEl.innerHTML = '';
        if (!snapshot.sessions.length) {
          listEl.innerHTML = '<li class="empty">No linked sessions yet. Send /start to Hora-claw from Telegram.</li>';
          return;
        }

        snapshot.sessions.forEach(function (session, index) {
          var li = document.createElement('li');
          li.className = 'node status-' + session.status + (session.isActive ? ' active' : '');

          var errorLine = session.lastError
            ? '<div class="meta error">error: ' + escapeHtml(session.lastError) + '</div>'
            : '';

          li.innerHTML =
            '<div class="row">' +
              '<div class="title">node ' + (index + 1) + ' -> chat ' + escapeHtml(session.chatId) + '</div>' +
              '<div class="badge">' + escapeHtml(session.status) + '</div>' +
            '</div>' +
            '<div class="meta">link: ' + (session.isActive ? 'active' : 'idle') +
              ' | messages: ' + session.messageCount +
              ' | last seen: ' + formatAge(session.lastSeenAt) + '</div>' +
            '<div class="meta">last reply: ' + formatAge(session.lastReplyAt) + '</div>' +
            errorLine;
          listEl.appendChild(li);
        });
      }

      function connectStream() {
        var source = new EventSource('/events');

        source.addEventListener('snapshot', function (event) {
          try {
            var payload = JSON.parse(event.data);
            render(payload.snapshot);
            setStreamState('live', 'ok');
          } catch (error) {
            setStreamState('data error', 'bad');
          }
        });

        source.onopen = function () {
          setStreamState('live', 'ok');
        };

        source.onerror = function () {
          setStreamState('reconnecting', 'warn');
        };
      }

      fetch('/api/state')
        .then(function (response) { return response.json(); })
        .then(function (snapshot) { render(snapshot); })
        .catch(function () { setStreamState('no initial data', 'bad'); });

      connectStream();
    })();
  </script>
</body>
</html>`;
}

function renderRoundedFaviconSvg(logoSvgBuffer) {
    const logoBase64 = Buffer.from(logoSvgBuffer).toString('base64');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <clipPath id="icon-clip">
      <circle cx="32" cy="32" r="30" />
    </clipPath>
  </defs>
  <circle cx="32" cy="32" r="31" fill="#0b0f14" />
  <circle cx="32" cy="32" r="30" fill="#101720" stroke="#273341" stroke-width="1.5" />
  <g clip-path="url(#icon-clip)">
    <image href="data:image/svg+xml;base64,${logoBase64}" x="11" y="11" width="42" height="42" preserveAspectRatio="xMidYMid meet" />
  </g>
</svg>`;
}

function handleDashboardRequest(req, res) {
    const host = req.headers.host || `localhost:${dashboardPortInUse}`;
    const requestUrl = new URL(req.url || '/', `http://${host}`);
    const pathname = requestUrl.pathname;

    if (req.method === 'GET' && pathname === '/logo.svg') {
        fs.readFile(LOGO_SVG_FILE, (error, content) => {
            if (error) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('logo.svg not found');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'image/svg+xml; charset=utf-8',
                'Cache-Control': 'public, max-age=86400'
            });
            res.end(content);
        });
        return;
    }

    if (req.method === 'GET' && pathname === '/favicon.svg') {
        fs.readFile(LOGO_SVG_FILE, (error, content) => {
            if (error) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('logo.svg not found');
                return;
            }

            const faviconSvg = renderRoundedFaviconSvg(content);
            res.writeHead(200, {
                'Content-Type': 'image/svg+xml; charset=utf-8',
                'Cache-Control': 'public, max-age=86400'
            });
            res.end(faviconSvg);
        });
        return;
    }

    if (req.method === 'GET' && (pathname === '/' || pathname === '/dashboard')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderDashboardPage());
        return;
    }

    if (req.method === 'GET' && pathname === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(buildDashboardSnapshot()));
        return;
    }

    if (req.method === 'GET' && pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            ok: true,
            dashboardReady: runtimeState.dashboardReady,
            dashboardPort: dashboardPortInUse,
            botOnline: runtimeState.botOnline
        }));
        return;
    }

    if (req.method === 'GET' && pathname === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        res.write('retry: 3000\n\n');
        dashboardClients.add(res);
        res.on('error', () => {
            dashboardClients.delete(res);
        });
        sendSse(res, 'snapshot', { reason: 'initial', snapshot: buildDashboardSnapshot() });

        req.on('close', () => {
            dashboardClients.delete(res);
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
}

function getDashboardUrl(port = dashboardPortInUse) {
    if (DASHBOARD_PUBLIC_BASE_URL) {
        return `${DASHBOARD_PUBLIC_BASE_URL.replace(/\/+$/, '')}/dashboard`;
    }

    const hostForUrl = DASHBOARD_HOST === '0.0.0.0' ? 'localhost' : DASHBOARD_HOST;
    return `http://${hostForUrl}:${port}/dashboard`;
}

function getDashboardPortCandidates() {
    const candidates = [DASHBOARD_PORT];
    if (APP_PORT_FALLBACK > 0 && !candidates.includes(APP_PORT_FALLBACK)) {
        candidates.push(APP_PORT_FALLBACK);
    }
    return candidates;
}

function listenDashboardOnPort(server, host, port) {
    return new Promise((resolve, reject) => {
        const onError = (error) => {
            cleanup();
            reject(error);
        };

        const onListening = () => {
            cleanup();
            resolve();
        };

        const cleanup = () => {
            server.off('error', onError);
            server.off('listening', onListening);
        };

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
    });
}

function startDashboardServer() {
    if (dashboardStartPromise) {
        return dashboardStartPromise;
    }

    dashboardServer = http.createServer(handleDashboardRequest);
    dashboardStartPromise = (async () => {
        const candidates = getDashboardPortCandidates();
        let lastError = null;

        for (const port of candidates) {
            try {
                await listenDashboardOnPort(dashboardServer, DASHBOARD_HOST, port);
                dashboardPortInUse = Number(dashboardServer.address()?.port || port);
                runtimeState.dashboardReady = true;

                dashboardServer.on('error', (error) => {
                    console.error('Dashboard server error:', error);
                });

                console.log(`Dashboard is live at ${getDashboardUrl(dashboardPortInUse)}`);
                if (DASHBOARD_HOST === '0.0.0.0') {
                    console.log(`Dashboard local shortcut: http://localhost:${dashboardPortInUse}/dashboard`);
                }
                return;
            } catch (error) {
                lastError = error;
                const code = error?.code || 'UNKNOWN';
                console.warn(`Dashboard bind failed on ${DASHBOARD_HOST}:${port} (${code}).`);
                if (code !== 'EADDRINUSE' && code !== 'EACCES') {
                    break;
                }
            }
        }

        runtimeState.dashboardReady = false;
        throw lastError || new Error('Unable to start dashboard server');
    })().catch((error) => {
        console.error('Dashboard server failed to start:', error);
        dashboardStartPromise = null;
        if (dashboardServer) {
            try {
                dashboardServer.close();
            } catch (closeError) {
                console.error('Failed to close dashboard server after startup error:', closeError);
            }
        }
        dashboardServer = null;
        throw error;
    });

    return dashboardStartPromise;
}

async function stopDashboardServer() {
    if (dashboardStartPromise) {
        try {
            await dashboardStartPromise;
        } catch (error) {
            // Startup already logged; continue with cleanup.
        }
    }

    if (!dashboardServer) {
        runtimeState.dashboardReady = false;
        dashboardStartPromise = null;
        return;
    }

    for (const client of dashboardClients) {
        try {
            client.end();
        } catch (error) {
            console.error('Failed to close dashboard client:', error);
        }
    }
    dashboardClients.clear();

    await new Promise(resolve => {
        dashboardServer.close(() => resolve());
    });

    runtimeState.dashboardReady = false;
    dashboardPortInUse = DASHBOARD_PORT;
    dashboardServer = null;
    dashboardStartPromise = null;
}

function saveChatId(chatId) {
    const key = String(chatId);
    getSession(key);

    if (!knownChats.has(key)) {
        knownChats.add(key);
        persistKnownChats();
    }

    if (runtimeState.botOnline && !bootOnlineNotifiedChats.has(key)) {
        ensureOnlineStatusForChat(key).catch(error => {
            console.error(`[online-fallback] Unexpected failure for ${key}:`, error);
        });
    }

    broadcastDashboardUpdate('session-linked');
}

function markSessionSeen(chatId) {
    const session = getSession(chatId);
    session.lastSeenAt = Date.now();
    session.lastError = null;
}

function setSessionStatus(chatId, status, extra = {}) {
    const session = getSession(chatId);
    session.status = status;
    Object.assign(session, extra);
    broadcastDashboardUpdate('session-status');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getTelegramErrorText(error) {
    return String(
        error?.response?.description
        || error?.description
        || error?.message
        || ''
    );
}

function getRetryAfterSeconds(error) {
    const retryAfter = error?.response?.parameters?.retry_after;
    if (!Number.isFinite(Number(retryAfter))) {
        return null;
    }
    return Number(retryAfter);
}

async function sendStatusMessageToChat(chatId, message, options = {}) {
    const parseMode = options.parseMode || null;

    try {
        const params = parseMode ? { parse_mode: parseMode } : {};
        await bot.telegram.sendMessage(chatId, message, params);
        return { ok: true, parseMode };
    } catch (error) {
        const retryAfterSeconds = getRetryAfterSeconds(error);
        if (retryAfterSeconds !== null && retryAfterSeconds >= 0) {
            const delayMs = (retryAfterSeconds + 1) * 1000;
            await sleep(delayMs);
            try {
                const params = parseMode ? { parse_mode: parseMode } : {};
                await bot.telegram.sendMessage(chatId, message, params);
                return { ok: true, parseMode, retried: true };
            } catch (retryError) {
                return { ok: false, error: retryError };
            }
        }

        const errorText = getTelegramErrorText(error).toLowerCase();
        const isMarkdownParsingError = errorText.includes("can't parse entities") || errorText.includes('parse entities');
        if (isMarkdownParsingError && parseMode) {
            try {
                await bot.telegram.sendMessage(chatId, message);
                return { ok: true, parseMode: null };
            } catch (fallbackError) {
                return { ok: false, error: fallbackError };
            }
        }

        return { ok: false, error };
    }
}

async function sendStatusUpdateOnce(message, options = {}) {
    const recipients = Array.isArray(options.chatIds) ? options.chatIds.map(chatId => String(chatId)) : Array.from(knownChats);
    let sent = 0;
    let failed = 0;
    const onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : null;
    const label = options.label || 'status';

    for (const chatId of recipients) {
        const sendResult = await sendStatusMessageToChat(chatId, message, options);
        if (sendResult.ok) {
            sent += 1;
            if (onSuccess) {
                onSuccess(String(chatId));
            }
        } else {
            failed += 1;
            console.error(`[${label}] Failed to send to ${chatId}:`, sendResult.error);
        }
    }

    return { sent, failed, total: recipients.length };
}

async function broadcastStatus(message, options = {}) {
    const attempts = Math.max(1, Math.floor(parsePositiveNumber(options.attempts, 1)));
    const retryDelayMs = parsePositiveNumber(options.retryDelayMs, 2500);
    const label = options.label || 'status';
    const totalRecipients = Array.isArray(options.chatIds) ? options.chatIds.length : knownChats.size;

    let result = { sent: 0, failed: 0, total: totalRecipients };
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        result = await sendStatusUpdateOnce(message, options);
        if (result.total === 0 || result.sent > 0 || attempt === attempts) {
            return result;
        }

        console.warn(`[${label}] No recipients acknowledged on attempt ${attempt}/${attempts}; retrying in ${retryDelayMs}ms.`);
        await sleep(retryDelayMs);
    }

    return result;
}

function stopOnlineRetryLoop() {
    if (onlineRetryTimer) {
        clearInterval(onlineRetryTimer);
        onlineRetryTimer = null;
    }
    onlineRetryInFlight = false;
    onlineRetryAttempts = 0;
}

async function flushPendingOnlineStatus(label = 'online') {
    if (!runtimeState.botOnline || pendingOnlineStatusChats.size === 0) {
        return {
            sent: 0,
            failed: 0,
            total: pendingOnlineStatusChats.size,
            pending: pendingOnlineStatusChats.size
        };
    }

    const recipients = Array.from(pendingOnlineStatusChats);
    const result = await broadcastStatus(ONLINE_STATUS_MESSAGE, {
        attempts: 1,
        label,
        chatIds: recipients,
        onSuccess: (chatId) => {
            const key = String(chatId);
            bootOnlineNotifiedChats.add(key);
            pendingOnlineStatusChats.delete(key);
        }
    });

    runtimeState.lastOnlineBroadcastAt = Date.now();
    return { ...result, pending: pendingOnlineStatusChats.size };
}

function scheduleOnlineRetryLoop() {
    if (onlineRetryTimer || !runtimeState.botOnline || pendingOnlineStatusChats.size === 0) {
        return;
    }

    onlineRetryTimer = setInterval(() => {
        if (onlineRetryInFlight) {
            return;
        }

        if (!runtimeState.botOnline || pendingOnlineStatusChats.size === 0) {
            stopOnlineRetryLoop();
            return;
        }

        if (onlineRetryAttempts >= ONLINE_STATUS_RETRY_MAX_ATTEMPTS) {
            console.warn(`[online-retry] Reached retry limit with ${pendingOnlineStatusChats.size} pending chat(s).`);
            stopOnlineRetryLoop();
            return;
        }

        onlineRetryInFlight = true;
        onlineRetryAttempts += 1;
        flushPendingOnlineStatus(`online-retry-${onlineRetryAttempts}`).then(result => {
            console.log(`[online-retry] Attempt ${onlineRetryAttempts}: sent ${result.sent}/${result.total}, pending ${result.pending}`);
            if (result.pending === 0) {
                stopOnlineRetryLoop();
            }
        }).catch(error => {
            console.error('[online-retry] Unexpected failure:', error);
        }).finally(() => {
            onlineRetryInFlight = false;
        });
    }, ONLINE_STATUS_RETRY_INTERVAL_MS);

    if (typeof onlineRetryTimer.unref === 'function') {
        onlineRetryTimer.unref();
    }
}

async function ensureOnlineStatusForChat(chatId) {
    const key = String(chatId);
    if (!runtimeState.botOnline || bootOnlineNotifiedChats.has(key)) {
        return;
    }

    pendingOnlineStatusChats.add(key);
    const result = await broadcastStatus(ONLINE_STATUS_MESSAGE, {
        attempts: 1,
        label: 'online-fallback',
        chatIds: [key],
        onSuccess: () => {
            bootOnlineNotifiedChats.add(key);
            pendingOnlineStatusChats.delete(key);
        }
    });

    if (result.sent > 0) {
        runtimeState.lastOnlineBroadcastAt = Date.now();
    }

    if (pendingOnlineStatusChats.has(key)) {
        console.warn(`[online-fallback] Pending delivery for ${key}; scheduling retries.`);
        scheduleOnlineRetryLoop();
    } else if (result.sent > 0) {
        console.log(`[online-fallback] Delivered startup online status to ${key}.`);
    }
}

function isMissingSessionError(output = '') {
    const text = output.toLowerCase();
    return [
        'session not found',
        'no session',
        'failed to resume',
        'does not exist',
        'unknown session'
    ].some(fragment => text.includes(fragment));
}

function safeReply(ctx, text, extra) {
    return ctx.reply(text, extra).catch(error => {
        console.error('Failed to send Telegram reply:', error);
        return null;
    });
}

function isCommandText(text = '') {
    return /^\/[a-z0-9_]+(?:@[a-z0-9_]+)?/i.test(String(text).trim());
}

function runGeminiCliCommand(command, callback) {
    exec(command, {
        windowsHide: true,
        timeout: GEMINI_EXEC_TIMEOUT_MS,
        maxBuffer: GEMINI_EXEC_MAX_BUFFER_BYTES
    }, callback);
}

function runGemini(prompt, useResume = true) {
    return new Promise((resolve, reject) => {
        const personaPrefix = "[System Context: You are a human-like claw named Hora-claw, serving the user via Telegram. You can do stuff. Never use the word 'agent', or refer to yourself as Gemini, a project, or a CLI. You are the claw itself.]\\n\\n";
        const fullPrompt = personaPrefix + prompt;
        const escapedPrompt = fullPrompt.replace(/"/g, '""');
        let command = `"${GEMINI_PATH}" -p "${escapedPrompt}" --yolo`;
        if (useResume) {
            command += ' --resume latest';
        }

        console.log(`Executing: ${command}`);

        runGeminiCliCommand(command, (error, stdout, stderr) => {
            if (error) {
                console.log(`Gemini process finished with error code ${error.code}`);
                const stderrText = (stderr || '').toLowerCase();
                if (useResume && (stderrText.includes('failed to resume') || stderrText.includes('not found'))) {
                    console.log('Falling back to new session (no resume found)');
                    return runGemini(prompt, false).then(resolve).catch(reject);
                }
                console.error(`Gemini Error: ${stderr}`);
                if (stdout && stdout.trim()) {
                    return resolve(stdout);
                }
                return reject(new Error(stderr || error.message));
            }
            resolve(stdout);
        });
    });
}

hydrateSessionsFromKnownChats();
const snapshotTimer = setInterval(() => broadcastDashboardUpdate('heartbeat'), 5000);
snapshotTimer.unref();

bot.start((ctx) => {
    saveChatId(ctx.chat.id);
    markSessionSeen(ctx.chat.id);
    setSessionStatus(ctx.chat.id, 'idle');
    safeReply(ctx, 'Welcome! I am Hora-claw. How can I help you today?');
});

bot.command('dashboard', async (ctx) => {
    const url = getDashboardUrl(dashboardPortInUse);
    safeReply(ctx, `Dashboard: ${url}`);
});

bot.command('reset', async (ctx) => {
    const chatId = String(ctx.chat.id);
    saveChatId(chatId);
    markSessionSeen(chatId);
    setSessionStatus(chatId, 'processing');

    safeReply(ctx, 'Resetting my memory and starting a fresh session... 🧹');

    try {
        const resetCommand = `"${GEMINI_PATH}" --delete-session latest`;
        runGeminiCliCommand(resetCommand, (error, stdout, stderr) => {
            try {
                const cliOutput = `${stdout || ''}\n${stderr || ''}`.trim();
                runtimeState.lastResetAt = Date.now();

                if (error && !isMissingSessionError(cliOutput)) {
                    console.error('Error deleting session:', error, cliOutput);
                    setSessionStatus(chatId, 'error', { lastSeenAt: Date.now(), lastError: cliOutput || error.message });
                    safeReply(ctx, 'I could not clear memory right now. Please try /reset again.');
                    return;
                }

                if (error && isMissingSessionError(cliOutput)) {
                    console.log('No existing latest session found; starting fresh.');
                    setSessionStatus(chatId, 'idle', { lastSeenAt: Date.now(), lastError: null });
                    safeReply(ctx, 'No previous memory was found. I am ready for a new task as Hora-claw.');
                    return;
                }

                if (stderr && stderr.trim()) {
                    console.warn('Gemini delete-session warning:', stderr.trim());
                }

                setSessionStatus(chatId, 'idle', { lastSeenAt: Date.now(), lastError: null });
                safeReply(ctx, 'Memory cleared! I am ready for a new task as Hora-claw.');
            } catch (callbackError) {
                console.error('Unexpected /reset callback failure:', callbackError);
                setSessionStatus(chatId, 'error', { lastSeenAt: Date.now(), lastError: callbackError.message });
                safeReply(ctx, 'Reset failed due to an internal error. Please try /reset again.');
            }
        });
    } catch (error) {
        console.error('Failed to execute reset command:', error);
        setSessionStatus(chatId, 'error', { lastSeenAt: Date.now(), lastError: error.message });
        safeReply(ctx, 'Reset failed due to an internal error. Please try /reset again.');
    }
});

bot.on('text', async (ctx) => {
    const userMessage = ctx.message.text;
    if (isCommandText(userMessage)) {
        return;
    }
    const chatId = String(ctx.chat.id);

    console.log(`Received message: ${userMessage}`);
    saveChatId(chatId);
    markSessionSeen(chatId);

    const session = getSession(chatId);
    session.messageCount += 1;
    runtimeState.totalMessages += 1;
    setSessionStatus(chatId, 'processing', { lastSeenAt: Date.now(), lastError: null });

    let typingInterval = setInterval(() => {
        ctx.sendChatAction('typing').catch(() => { });
    }, 4000);

    try {
        await ctx.sendChatAction('typing');
        let output = await runGemini(userMessage);
        clearInterval(typingInterval);

        output = output.replace(/Loaded cached credentials\.?/gi, '').trim();

        if (!output) {
            output = "I'm sorry, I couldn't generate a response.";
        }

        const striptags = require('striptags');
        const { marked } = require('marked');
        let htmlOutput = marked.parse(output, { breaks: true });

        htmlOutput = htmlOutput.replace(/<\/p>/g, '\n');
        htmlOutput = htmlOutput.replace(/<br\s*\/?>/g, '\n');

        const allowedTags = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'a', 'code', 'pre'];
        htmlOutput = striptags(htmlOutput, allowedTags).trim();

        if (htmlOutput.length > 4000) {
            for (let i = 0; i < htmlOutput.length; i += 4000) {
                await ctx.replyWithHTML(htmlOutput.substring(i, i + 4000)).catch(err => {
                    console.error('Telegram replyWithHTML error:', err);
                    return safeReply(ctx, output.substring(i, i + 4000));
                });
            }
        } else {
            await ctx.replyWithHTML(htmlOutput).catch(err => {
                console.error('Telegram replyWithHTML error:', err);
                return safeReply(ctx, output);
            });
        }

        setSessionStatus(chatId, 'idle', {
            lastSeenAt: Date.now(),
            lastReplyAt: Date.now(),
            lastError: null
        });
    } catch (error) {
        clearInterval(typingInterval);
        console.error('Gemini Execution Error:', error);
        setSessionStatus(chatId, 'error', {
            lastSeenAt: Date.now(),
            lastError: error.message
        });
        safeReply(ctx, 'An error occurred. Gemini said: ' + error.message.substring(0, 150));
    }
});

bot.catch((error, ctx) => {
    console.error('Telegraf middleware error:', error);

    if (ctx && ctx.chat && ctx.chat.id) {
        setSessionStatus(String(ctx.chat.id), 'error', {
            lastSeenAt: Date.now(),
            lastError: error.message
        });
        safeReply(ctx, 'An internal bot error occurred. Please retry.');
    }
});

startDashboardServer().catch(() => {
    // Error already logged in startDashboardServer.
});

bot.launch().catch(err => {
    runtimeState.botOnline = false;
    broadcastDashboardUpdate('bot-launch-error');
    console.error('Failed to launch bot:', err);
});

// Execute startup logic concurrently with bot polling
(async () => {
    runtimeState.botOnline = true;
    broadcastDashboardUpdate('bot-online');

    const mergedChatCount = mergeKnownChatsFromDisk();
    if (mergedChatCount > 0) {
        console.log(`Merged ${mergedChatCount} chat(s) from disk before online status broadcast.`);
    }

    pendingOnlineStatusChats.clear();
    for (const chatId of knownChats) {
        if (!bootOnlineNotifiedChats.has(chatId)) {
            pendingOnlineStatusChats.add(chatId);
        }
    }

    console.log('hora-claw is running on Telegram!');
    try {
        await bot.telegram.getMe();
    } catch (error) {
        console.warn('[online] Telegram API warmup check failed before startup broadcast:', error.message || error);
    }

    const onlineStatusResult = await flushPendingOnlineStatus('online-startup');
    console.log(`Online status delivery: sent ${onlineStatusResult.sent}/${onlineStatusResult.total}, failed ${onlineStatusResult.failed}, pending ${onlineStatusResult.pending}`);
    if (onlineStatusResult.total === 0) {
        console.warn('[online] No known chats at startup. Online status will be sent when a chat next interacts.');
    } else if (onlineStatusResult.pending > 0) {
        console.warn(`[online] ${onlineStatusResult.pending} chat(s) still pending startup online delivery. Retrying in background.`);
        scheduleOnlineRetryLoop();
    }
})();

const gracefulShutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down...`);

    runtimeState.botOnline = false;
    stopOnlineRetryLoop();
    broadcastDashboardUpdate('bot-offline');
    const offlineStatusResult = await broadcastStatus(OFFLINE_STATUS_MESSAGE, {
        attempts: 2,
        retryDelayMs: 1500,
        label: 'offline'
    });
    console.log(`Offline status delivery: sent ${offlineStatusResult.sent}/${offlineStatusResult.total}, failed ${offlineStatusResult.failed}`);
    await stopDashboardServer();
    bot.stop(signal);
    process.exit(0);
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
