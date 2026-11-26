# Long-running commands over MCP: Local Commander and Desktop Commander on one scenario

A small, repeatable test of what happens to a long command when an AI client starts it on your computer, reads it, cancels it, goes away in the middle, and then works with a second computer.

**Disclosure.** The test was designed and run by an agent working for the maker of Local Commander. Read the results with that in mind. Everything needed to repeat the local runs is in this repository. Found a mistake? Open an issue and we will fix this page.

## Runs

| Date (UTC) | What | Log |
| --- | --- | --- |
| 25 Nov 2026, 17:46–17:49 | Desktop Commander 0.3.4, local over stdio, S1–S3 | [`results/2026-11-25/dc-run.json`](results/2026-11-25/dc-run.json) |
| 25 Nov 2026, 17:49–17:52 | Local Commander through its hosted relay, S1–S4 | [`results/2026-11-25/lc-run.md`](results/2026-11-25/lc-run.md) |
| 26 Nov 2026, 07:27–07:30 | Desktop Commander 0.3.4 again, from a fresh clone of this repository | [`results/2026-11-26/dc-run.json`](results/2026-11-26/dc-run.json) |
| 26 Nov 2026, 07:33–07:36 | Local Commander self-hosted edition 0.1.4, local over stdio, S1–S3 | [`results/2026-11-26/lca-run.json`](results/2026-11-26/lca-run.json) |

All runs on one Windows 11 Pro computer (10.0.26300, Node.js 22.18.0); S4 used a second Windows computer. In the logs, the path of the local test folder is shown as `<run-folder>`; nothing else in them is edited.

## Scenarios

| | What is checked |
| --- | --- |
| S1 | A 60-second command: when the client gets control back, whether output is readable while it runs, whether the end is received |
| S2 | Cancel after about 10 seconds: does the work really stop |
| S3 | The client goes away mid-command; a new client looks for the command |
| S4 | A second computer from the same client |

The workload is the same everywhere: [`tick.ps1`](tick.ps1) writes `tick N HH:mm:ss` once a second for 60 seconds, to the output and to a file, and records its own PID in a separate file. The files show whether the process is alive regardless of what a tool reports.

## 1. Same mode: local server over stdio, same client

Both servers were started by the same kind of MCP client script on `@modelcontextprotocol/sdk` 1.32.2 ([`dc-run.mjs`](dc-run.mjs), [`lca-run.mjs`](lca-run.mjs)), with the home directory redirected into the run folder.

| | Desktop Commander 0.3.4 | Local Commander self-hosted 0.1.4 |
| --- | --- | --- |
| Package | `@wonderwhy-er/desktop-commander`, MIT ([release commit 9a101b1](https://github.com/wonderwhy-er/DesktopCommanderMCP/commit/9a101b17e44577f0baefa4c7120f087881c5cc56)) | [`local-commander-mcp-agent`](https://github.com/netbka/local-commander-mcp-agent), MIT |
| Settings changed | Telemetry (on by default in 0.3.4, [`config-manager.ts`](https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/9a101b17e44577f0baefa4c7120f087881c5cc56/src/config-manager.ts#L280)) and the welcome page switched off before the first start: [`config.json`](home/.claude-server-commander/config.json). This file does not cover installation: `npm install` runs the package's postinstall script, which reports the installation to telemetry.desktopcommander.app ([`track-installation.js`](https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/9a101b17e44577f0baefa4c7120f087881c5cc56/track-installation.js)); our installs ran it | Command allowlist set to `powershell` only; the default list has developer tools (git, node, npm, python and similar) and no shell: [`lca-config.json`](lca-config.json) |
| How a command is given | A shell command string (`start_process`), checked against a default blocklist ([`config-manager.ts`](https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/9a101b17e44577f0baefa4c7120f087881c5cc56/src/config-manager.ts)) | An executable and an argument array (`process_start`) |
| S1 | `start_process` returned after 3.9 s (4.3 s on 26 Nov) with the PID and the first three lines (two on 26 Nov); how long it waits for initial output is set by `timeout_ms` (3 s here). At 20 s `read_process_output` returned 19 lines (18); at 66 s, 42 new lines (43): the rest of the `tick` lines and `done`. Each read returns only the lines added since the previous read. The file has 60 lines | `process_start` returned after 0.06 s with an ID and the PID, no output. At 20 s `process_output` returned the 20 lines captured so far, `running: true`; at 66 s, all 60 lines and `done` (1084 bytes), exit code 0. Each read returns the last `tailChars` characters of the captured output (32 000 by default), which here was the whole output. The file has 60 lines |
| S2 | `force_terminate` ended both the shell and the workload. 10 lines written (9 on 26 Nov); no new lines after 3 and 8 s | `process_kill` returned after 1.9 s with `killConfirmed: true`; workload ended. 10 lines written, still 10 after 3 and 8 s. `process_list` still shows the process with `running: false` and its exit time |
| S3 | The stdio server process ended with the client. The shell ended; **the workload kept running** and wrote all 60 lines. New server: `list_sessions` says "No active sessions", `read_process_output` by PID says "No session found". Neither state nor output | The stdio server process ended with the client and **stopped the workload**: 10 lines, no more. New server: `process_list` is empty, `process_output` says "Unknown process id: 1". Neither state nor output; no process left behind |

**What S3 shows.** In local mode both servers live only as long as the client that started them. Desktop Commander leaves a running command to finish on its own, with nobody watching it. The Local Commander self-hosted edition stops its commands when it shuts down. Which one you want depends on the job: a build you want finished, or no stray processes. In neither case does a new client get the output back.

## 2. Local Commander through its hosted relay

This is how ChatGPT and Claude connect to Local Commander: the AI client talks to the service at localcmd.app, and an agent on each computer runs the commands. Agent 0.3.81 on the first computer, 0.3.79 on the second; tool contract 2026-10-17. Client: Claude Code through the Local Commander connector in claude.ai. Times before and after each call were taken with separate shell commands, so they include client overhead. Full Access to the D:\ and C:\ drives.

| | Local Commander, hosted |
| --- | --- |
| S1 | `command_run` returned operation IDs with state `accepted` and no output; accepted 2.1 s after the request, the call returned after 3.7 s including client overhead. At about 19 s `operation_output` returned 19 lines with state `running`; after the end, the whole output (1083 bytes, 60 lines and `done`), `resultCode: SUCCESS`. The file has 60 lines |
| S2 | `operation_cancel`: state `cancelled` 0.13 s after the request, workload ended. 16 lines written (the request went out later because of client latency); still 16 after 8 and 13 s |
| S3 | The client closed its session (`execution_session_close`); the agent and the relay kept running. The workload kept running and wrote all 60 lines. From a new session `operation_status` for the same ID showed the command still running (`state: accepted`, no finish time), then `finished`, `SUCCESS`. `operation_output` returns `SESSION_EXPIRED`: output cannot be read after the session is closed |
| S4 | The same client opened a session on the second computer and ran a command there: `exitCode: 0`, full output received |

Desktop Commander's counterpart here is Desktop Commander Remote. According to its docs it connects "one or more devices" and needs a Desktop Commander account ([desktopcommander.app](https://desktopcommander.app/) and [`src/remote-device/README.md`](https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/9a101b17e44577f0baefa4c7120f087881c5cc56/src/remote-device/README.md) at 9a101b1, read 19 Nov 2026). It was not tested.

## How to read this

- **Section 1 compares like with like; section 2 has no Desktop Commander column.** Desktop Commander Remote was not tested.
- **S3 in section 2 models a different event.** The client closed its session while the agent and relay kept running. A network drop between the client and the relay was not modelled.
- **This is not a speed test.** Desktop Commander's return time is set by `timeout_ms`; the hosted Local Commander times include client overhead.
- **One Windows computer.** macOS and Linux were not tested. Each mode ran once, Desktop Commander twice.
- **A gap everywhere.** Once the client has gone, the command's output does not come back in any tested mode. The hosted Local Commander keeps the state and result code.

## Where Desktop Commander is stronger

From these runs:

- The first lines of output come back in the response to the start call.
- It ran the shell command string with no settings change: it checks commands against a blocklist, not an allowlist. The Local Commander self-hosted edition needed its allowlist changed to run `powershell`.
- A command keeps running to the end if the client goes away, when that is what you want.

Outside these runs, according to its docs and source code (0.3.4):

- Output can be read by line position (`offset`, `length` in [`ReadProcessOutputArgsSchema`](https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/9a101b17e44577f0baefa4c7120f087881c5cc56/src/tools/schemas.ts#L37-L43)), and there are interactive sessions.
- Over 10 000 GitHub stars (10 423 on 26 Nov 2026).

## Repeat it

### Local runs (Windows, Node.js 22)

```powershell
git clone https://github.com/netbka/mcp-long-command-test
cd mcp-long-command-test
npm install --prefix dc @wonderwhy-er/desktop-commander@0.3.4 @modelcontextprotocol/sdk@1.32.2
npm install --prefix lca local-commander-mcp-agent@0.1.4
node dc-run.mjs
node lca-run.mjs
```

Each script takes about 2.5 minutes and writes `logs/dc-run.json` or `logs/lca-run.json`. The committed `home/.claude-server-commander/config.json` keeps Desktop Commander's telemetry and welcome page off; delete it to test the defaults.

### Hosted Local Commander

1. Connect a computer at localcmd.app and add the Local Commander connector to your AI client.
2. Follow the steps in [`results/2026-11-25/lc-run.md`](results/2026-11-25/lc-run.md) with the same command: `powershell -NoProfile -ExecutionPolicy Bypass -File <path>\tick.ps1 -Tag <tag>`, `timeoutMs` 180000. Use a new random UUID for every `operationId`.

## Changes since the first run

Two edits so the scripts run from any folder; the logic is the same:

- `tick.ps1` writes to `logs` next to itself and creates the folder. On 25 Nov the path was a fixed folder on the test computer.
- `dc-run.mjs` creates `logs` if it is missing.

## License

Scripts: MIT, see [LICENSE](LICENSE). Desktop Commander and Local Commander are products of their respective owners.
