---
description: Repo-scoped Gemini tool permissions plus secure API/script execution workflow
---

# Secure Tooling Capabilities

Hora-claw now supports web browsing, API calls, and temporary script execution with cleanup.

## Repo-Scoped Tool Permissions

1. Project tool policy is in `.gemini/settings.json`.
2. Runtime host is Beeyeswon Windows machine; keep `tools.sandbox=false`.
3. Do not use restrictive `tools.allowed`/`tools.core` allowlists for runtime host because they can trigger "tool execution denied by policy" during valid tool calls.
4. If a hardening pass reintroduces allowlists, validate every actual command shape first or expect regressions.
5. Keep Gemini sandbox disabled by default unless host sandbox runtime is installed/configured.

## Tool Runner Contract

1. Script path: `scripts/hora_tool_runner.js`.
2. Supported commands:
3. `api` for HTTP(S) calls.
4. `run-script` for temporary script execution.
5. JSON output is required for both success and failure paths.

## API Mode Rules

1. Require `--url`; default method is `GET`.
2. Support headers via repeated `--header "Name: Value"`.
3. Support body via one of: `--body`, `--body-base64`, `--body-file`.
4. Enforce request timeout and max response size (`HORA_API_TIMEOUT_MS`, `HORA_API_MAX_RESPONSE_BYTES`).
5. Report truncation (`truncated: true`) when response exceeds capture limit.

## Script Mode Rules

1. Require `--runtime` and exactly one source: `--script`, `--script-base64`, or `--script-file`.
2. Execute in isolated run dir under `HORA_SECURE_TOOL_DIR` (default `path.join(os.homedir(), '.hora-claw', 'secure-tools')`; Windows example `C:/Users/<user>/.hora-claw/secure-tools`).
3. Enforce timeout and output caps (`HORA_SECURE_SCRIPT_TIMEOUT_MS`, `HORA_SECURE_SCRIPT_MAX_BUFFER_BYTES`).
4. Always clean run directory in `finally` and expose cleanup result in JSON.
5. If `--script-file` is inside secure root, delete the source file after run.
6. On Windows host, prefer `powershell` runtime for shell-style scripting unless a different runtime is explicitly required.

## Integration Points

1. `index.js` ensures secure root exists at startup (`ensureSecureToolDir`).
2. Gemini system/tooling context points agents to use:
3. `node ./scripts/hora_tool_runner.js api`
4. `node ./scripts/hora_tool_runner.js run-script ...`

## Verification

1. `node --check scripts/hora_tool_runner.js`
2. `node -e "JSON.parse(require('fs').readFileSync('.gemini/settings.json','utf8'))"`
3. Confirm `.gemini/settings.json` has no restrictive `tools.allowed` list on Beeyeswon runtime host.
