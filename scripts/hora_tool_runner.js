#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

const DATA_DIR = process.env.HORA_DATA_DIR || path.join(os.homedir(), '.hora-claw');
const SECURE_ROOT = process.env.HORA_SECURE_TOOL_DIR || path.join(DATA_DIR, 'secure-tools');
const SCRIPT_TIMEOUT_MS = parsePositiveNumber(process.env.HORA_SECURE_SCRIPT_TIMEOUT_MS, 2 * 60 * 1000);
const SCRIPT_MAX_BUFFER_BYTES = parsePositiveNumber(process.env.HORA_SECURE_SCRIPT_MAX_BUFFER_BYTES, 4 * 1024 * 1024);
const API_TIMEOUT_MS = parsePositiveNumber(process.env.HORA_API_TIMEOUT_MS, 45 * 1000);
const API_MAX_RESPONSE_BYTES = parsePositiveNumber(process.env.HORA_API_MAX_RESPONSE_BYTES, 512 * 1024);

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'undefined') {
    return [];
  }
  return [value];
}

function getLastFlag(flags, key, fallback = undefined) {
  const value = flags[key];
  if (typeof value === 'undefined') {
    return fallback;
  }
  if (Array.isArray(value)) {
    return value[value.length - 1];
  }
  return value;
}

function parseArgs(argv) {
  const passthroughIndex = argv.indexOf('--');
  const primary = passthroughIndex === -1 ? argv : argv.slice(0, passthroughIndex);
  const passthrough = passthroughIndex === -1 ? [] : argv.slice(passthroughIndex + 1);

  const command = primary[0] || '';
  const flags = {};
  const positional = [];

  function pushFlag(key, value) {
    if (Object.prototype.hasOwnProperty.call(flags, key)) {
      if (Array.isArray(flags[key])) {
        flags[key].push(value);
      } else {
        flags[key] = [flags[key], value];
      }
    } else {
      flags[key] = value;
    }
  }

  for (let i = 1; i < primary.length; i += 1) {
    const token = primary[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const eqIndex = token.indexOf('=');
    if (eqIndex !== -1) {
      const key = token.slice(2, eqIndex);
      const value = token.slice(eqIndex + 1);
      pushFlag(key, value);
      continue;
    }

    const key = token.slice(2);
    const nextToken = primary[i + 1];
    if (typeof nextToken !== 'undefined' && !nextToken.startsWith('--')) {
      pushFlag(key, nextToken);
      i += 1;
    } else {
      pushFlag(key, true);
    }
  }

  return { command, flags, positional, passthrough };
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isInsideDirectory(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeDelete(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function isRegularFile(filePath) {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch (error) {
    return false;
  }
}

function shouldDeleteSecureSourceFile(sourcePath) {
  const secureRootPath = path.resolve(SECURE_ROOT);
  const resolvedSourcePath = path.resolve(sourcePath);
  if (!isInsideDirectory(secureRootPath, resolvedSourcePath)) {
    return false;
  }
  if (resolvedSourcePath === secureRootPath) {
    return false;
  }
  return isRegularFile(resolvedSourcePath);
}

function decodeBase64(value) {
  try {
    return Buffer.from(String(value), 'base64');
  } catch (error) {
    throw new Error(`Invalid base64 payload: ${error.message}`);
  }
}

function resolveRuntime(runtimeRaw) {
  const runtime = String(runtimeRaw || '').trim().toLowerCase();
  const isWindows = process.platform === 'win32';

  if (runtime === 'node' || runtime === 'javascript' || runtime === 'js') {
    return { name: 'node', extension: '.js', command: process.execPath, argsPrefix: [] };
  }
  if (runtime === 'python' || runtime === 'py') {
    return { name: 'python', extension: '.py', command: process.env.HORA_PYTHON_BIN || (isWindows ? 'python' : 'python3'), argsPrefix: [] };
  }
  if (runtime === 'bash' || runtime === 'sh') {
    return { name: 'bash', extension: '.sh', command: process.env.HORA_BASH_BIN || 'bash', argsPrefix: [] };
  }
  if (runtime === 'powershell' || runtime === 'pwsh' || runtime === 'ps1') {
    return {
      name: 'powershell',
      extension: '.ps1',
      command: process.env.HORA_POWERSHELL_BIN || (isWindows ? 'powershell' : 'pwsh'),
      argsPrefix: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']
    };
  }

  throw new Error('Unsupported runtime. Use one of: node, python, bash, powershell.');
}

function execFilePromise(command, args, options) {
  return new Promise((resolve) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      resolve({
        error: error || null,
        stdout: stdout || '',
        stderr: stderr || ''
      });
    });
  });
}

async function handleRunScript(cli) {
  const runtimeFlag = getLastFlag(cli.flags, 'runtime', '');
  if (!runtimeFlag) {
    return { ok: false, error: 'Missing required flag --runtime.' };
  }

  let scriptContent = null;
  const scriptInline = getLastFlag(cli.flags, 'script', null);
  const scriptBase64 = getLastFlag(cli.flags, 'script-base64', null);
  const scriptFile = getLastFlag(cli.flags, 'script-file', null);

  const sources = [scriptInline !== null, scriptBase64 !== null, scriptFile !== null].filter(Boolean).length;
  if (sources !== 1) {
    return { ok: false, error: 'Provide exactly one of --script, --script-base64, or --script-file.' };
  }

  if (scriptInline !== null) {
    scriptContent = String(scriptInline);
  } else if (scriptBase64 !== null) {
    scriptContent = decodeBase64(scriptBase64).toString('utf8');
  } else {
    scriptContent = fs.readFileSync(path.resolve(String(scriptFile)), 'utf8');
  }

  const runtime = resolveRuntime(runtimeFlag);
  ensureDirectory(SECURE_ROOT);

  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const runDir = path.join(SECURE_ROOT, 'runs', runId);
  const scriptPath = path.join(runDir, `task${runtime.extension}`);
  const startedAt = Date.now();

  let result = {
    ok: false,
    runtime: runtime.name,
    secureRoot: SECURE_ROOT,
    runId,
    cleanedUp: false,
    sourceFileDeleted: false
  };

  try {
    ensureDirectory(runDir);
    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o700 });

    const args = runtime.argsPrefix.concat([scriptPath], cli.passthrough);
    const execResult = await execFilePromise(runtime.command, args, {
      cwd: runDir,
      timeout: SCRIPT_TIMEOUT_MS,
      maxBuffer: SCRIPT_MAX_BUFFER_BYTES,
      windowsHide: true,
      env: {
        ...process.env,
        HORA_SECURE_RUN_DIR: runDir
      }
    });

    const timedOut = Boolean(execResult.error && /timed out/i.test(String(execResult.error.message || '')));
    result = {
      ...result,
      ok: !execResult.error,
      command: runtime.command,
      exitCode: execResult.error && Number.isInteger(execResult.error.code) ? execResult.error.code : (execResult.error ? 1 : 0),
      signal: execResult.error ? execResult.error.signal || null : null,
      timedOut,
      durationMs: Date.now() - startedAt,
      stdout: execResult.stdout,
      stderr: execResult.stderr || (execResult.error ? String(execResult.error.message || '') : '')
    };
  } catch (error) {
    result = {
      ...result,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error.message
    };
  } finally {
    const cleanup = safeDelete(runDir);
    result.cleanedUp = cleanup.ok;
    if (!cleanup.ok) {
      result.cleanupError = cleanup.error;
    }
  }

  if (scriptFile) {
    const sourcePath = path.resolve(String(scriptFile));
    if (shouldDeleteSecureSourceFile(sourcePath)) {
      const sourceCleanup = safeDelete(sourcePath);
      result.sourceFileDeleted = sourceCleanup.ok;
      if (!sourceCleanup.ok) {
        result.sourceFileDeleteError = sourceCleanup.error;
      }
    } else if (isInsideDirectory(SECURE_ROOT, sourcePath)) {
      result.sourceFileDeleteSkipped = true;
    }
  }

  return result;
}

function parseHeaderPairs(values) {
  const headers = Object.create(null);
  for (const rawValue of values) {
    const pair = String(rawValue);
    const separator = pair.indexOf(':');
    if (separator <= 0) {
      throw new Error(`Invalid header "${pair}". Expected "Name: Value".`);
    }
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    headers[name] = value;
  }
  return headers;
}

function sendHttpRequest({ url, method, headers, body, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : target.protocol === 'http:' ? http : null;
    if (!transport) {
      reject(new Error('Only http:// and https:// URLs are supported.'));
      return;
    }

    const req = transport.request(target, { method, headers }, (res) => {
      const chunks = [];
      let totalBytes = 0;
      let capturedBytes = 0;

      res.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (capturedBytes >= maxBytes) {
          return;
        }

        const remaining = maxBytes - capturedBytes;
        if (chunk.length > remaining) {
          chunks.push(chunk.slice(0, remaining));
          capturedBytes += remaining;
          return;
        }

        chunks.push(chunk);
        capturedBytes += chunk.length;
      });

      res.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode || 0,
          statusMessage: res.statusMessage || '',
          headers: res.headers,
          body: bodyBuffer.toString('utf8'),
          totalBytes,
          capturedBytes,
          truncated: totalBytes > maxBytes
        });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);

    if (body && body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

async function handleApi(cli) {
  const url = getLastFlag(cli.flags, 'url', '');
  if (!url) {
    return { ok: false, error: 'Missing required flag --url.' };
  }

  const method = String(getLastFlag(cli.flags, 'method', 'GET')).toUpperCase();
  const headers = parseHeaderPairs(toArray(cli.flags.header));

  const bodyInlineProvided = typeof cli.flags.body !== 'undefined';
  const bodyBase64Provided = typeof cli.flags['body-base64'] !== 'undefined';
  const bodyFileProvided = typeof cli.flags['body-file'] !== 'undefined';
  const bodySourceCount = [bodyInlineProvided, bodyBase64Provided, bodyFileProvided].filter(Boolean).length;
  if (bodySourceCount > 1) {
    return { ok: false, error: 'Provide at most one of --body, --body-base64, or --body-file.' };
  }

  let body = null;
  if (bodyInlineProvided) {
    body = Buffer.from(String(getLastFlag(cli.flags, 'body')), 'utf8');
  } else if (bodyBase64Provided) {
    body = decodeBase64(getLastFlag(cli.flags, 'body-base64'));
  } else if (bodyFileProvided) {
    body = fs.readFileSync(path.resolve(String(getLastFlag(cli.flags, 'body-file'))));
  }

  if (body && typeof headers['Content-Length'] === 'undefined' && typeof headers['content-length'] === 'undefined') {
    headers['Content-Length'] = String(body.length);
  }

  const timeoutMs = parsePositiveNumber(getLastFlag(cli.flags, 'timeout-ms', API_TIMEOUT_MS), API_TIMEOUT_MS);
  const maxBytes = parsePositiveNumber(getLastFlag(cli.flags, 'max-response-bytes', API_MAX_RESPONSE_BYTES), API_MAX_RESPONSE_BYTES);
  const startedAt = Date.now();

  try {
    const response = await sendHttpRequest({
      url,
      method,
      headers,
      body,
      timeoutMs,
      maxBytes
    });

    return {
      ok: true,
      method,
      url,
      durationMs: Date.now() - startedAt,
      timeoutMs,
      statusCode: response.statusCode,
      statusMessage: response.statusMessage,
      headers: response.headers,
      responseBody: response.body,
      responseBytes: response.totalBytes,
      capturedBytes: response.capturedBytes,
      truncated: response.truncated
    };
  } catch (error) {
    return {
      ok: false,
      method,
      url,
      durationMs: Date.now() - startedAt,
      timeoutMs,
      error: error.message
    };
  }
}

function helpPayload() {
  return {
    ok: true,
    usage: [
      'node ./scripts/hora_tool_runner.js api --url <http(s)://...> [--method GET] [--header "Name: Value"] [--body "..."] [--body-base64 "..."] [--body-file /path/body.json]',
      'node ./scripts/hora_tool_runner.js run-script --runtime <node|python|bash|powershell> --script-base64 <base64-script> [-- arg1 arg2]',
      'node ./scripts/hora_tool_runner.js run-script --runtime <node|python|bash|powershell> --script-file /path/to/script [-- arg1 arg2]'
    ],
    secureRoot: SECURE_ROOT
  };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  ensureDirectory(SECURE_ROOT);

  if (!cli.command || cli.command === 'help' || cli.flags.help) {
    printJson(helpPayload());
    return;
  }

  let output;
  if (cli.command === 'api') {
    output = await handleApi(cli);
  } else if (cli.command === 'run-script') {
    output = await handleRunScript(cli);
  } else {
    output = { ok: false, error: `Unknown command "${cli.command}". Use "help" for usage.` };
  }

  printJson(output);
  process.exit(output.ok ? 0 : 1);
}

main().catch((error) => {
  printJson({
    ok: false,
    error: error.message
  });
  process.exit(1);
});
