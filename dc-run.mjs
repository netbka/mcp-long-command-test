// Desktop Commander side of the long-command test (first run: 25 Nov 2026, Windows 11).
// Starts the DC MCP server over stdio (as a local MCP client would), runs the shared workload tick.ps1 in three
// scenarios and records every tool call with timings to logs/dc-run.json. DC's home is redirected into this folder;
// telemetry and onboarding are switched off in home/.claude-server-commander/config.json before the first start.
// Usage: node dc-run.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from './dc/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from './dc/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const logs = path.join(here, 'logs');
const home = path.join(here, 'home');
const tmp = path.join(here, 'tmp');
fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync(logs, { recursive: true });
const server = path.join(here, 'dc/node_modules/@wonderwhy-er/desktop-commander/dist/index.js');
const env = {
  ...getDefaultEnvironment(), USERPROFILE: home, HOME: home, HOMEDRIVE: 'D:', HOMEPATH: home.slice(2),
  APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'), TEMP: tmp, TMP: tmp,
};
const workload = (tag) => `powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(here, 'tick.ps1')}" -Tag ${tag}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = { tool: 'Desktop Commander', package: '@wonderwhy-er/desktop-commander@0.3.4', host: process.env.COMPUTERNAME,
  node: process.version, startedAt: new Date(T0).toISOString(), config: JSON.parse(fs.readFileSync(path.join(home, '.claude-server-commander/config.json'), 'utf8')), steps: [] };
const note = (scenario, what, data = {}) => { const e = { t: ((Date.now() - T0) / 1000).toFixed(1), scenario, what, ...data }; log.steps.push(e); console.log(JSON.stringify(e).slice(0, 400)); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const ticks = (tag) => { try { return fs.readFileSync(path.join(logs, `${tag}.ticks`), 'utf8').trim().split(/\r?\n/).filter(Boolean).length; } catch { return 0; } };
const workPid = (tag) => { try { return Number(fs.readFileSync(path.join(logs, `${tag}.pid`), 'utf8').trim()); } catch { return null; } };
const text = (r) => (r?.content ?? []).map((c) => c.text ?? '').join('\n');

async function connect(label) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [server], env, cwd: here, stderr: 'pipe' });
  const client = new Client({ name: 'cmp1-harness', version: '1.0.0' });
  await client.connect(transport);
  note(label, 'connected', { serverPid: transport.pid, serverVersion: client.getServerVersion() });
  return { client, transport };
}
async function call(client, scenario, name, args) {
  const s = Date.now();
  try {
    const r = await client.callTool({ name, arguments: args });
    note(scenario, name, { args, ms: Date.now() - s, isError: !!r.isError, text: text(r).slice(0, 4000) });
    return text(r);
  } catch (e) { note(scenario, name, { args, ms: Date.now() - s, error: String(e.message ?? e) }); return ''; }
}
const pidFrom = (t) => Number((t.match(/PID[:\s]+(\d+)/i) ?? [])[1] ?? NaN);
const tickLines = (t) => (t.match(/^tick \d+/gm) ?? []).length;

// S1: long command, read output while it runs, read the end.
{
  const { client, transport } = await connect('S1');
  const s = Date.now();
  const out = await call(client, 'S1', 'start_process', { command: workload('dc-s1'), timeout_ms: 3000 });
  const pid = pidFrom(out);
  note('S1', 'returned control', { afterMs: Date.now() - s, dcPid: pid, workloadPid: workPid('dc-s1') });
  await sleep(Math.max(0, s + 20000 - Date.now()));
  const mid = await call(client, 'S1', 'read_process_output', { pid, timeout_ms: 1000 });
  note('S1', 'mid-run read', { tickLinesInRead: tickLines(mid), ticksOnDisk: ticks('dc-s1') });
  await sleep(Math.max(0, s + 66000 - Date.now()));
  const end = await call(client, 'S1', 'read_process_output', { pid, timeout_ms: 1000 });
  note('S1', 'end read', { tickLinesInRead: tickLines(end), doneSeen: /done dc-s1/.test(end), ticksOnDisk: ticks('dc-s1'), workloadAlive: alive(workPid('dc-s1')) });
  await transport.close();
}
// S2: cancel after 10 s, check the workload process.
{
  const { client, transport } = await connect('S2');
  const s = Date.now();
  const pid = pidFrom(await call(client, 'S2', 'start_process', { command: workload('dc-s2'), timeout_ms: 3000 }));
  await sleep(Math.max(0, s + 10000 - Date.now()));
  await call(client, 'S2', 'force_terminate', { pid });
  const w = workPid('dc-s2');
  const t1 = ticks('dc-s2');
  await sleep(3000);
  note('S2', '3 s after terminate', { dcPid: pid, dcPidAlive: alive(pid), workloadPid: w, workloadAlive: alive(w), ticksAtTerminate: t1, ticksNow: ticks('dc-s2') });
  await sleep(5000);
  note('S2', '8 s after terminate', { workloadAlive: alive(w), ticksNow: ticks('dc-s2') });
  await call(client, 'S2', 'list_sessions', {});
  await transport.close();
}
// S3: the client goes away mid-run (server process ends), a new client connects and looks for the command.
{
  const a = await connect('S3');
  const s = Date.now();
  const pid = pidFrom(await call(a.client, 'S3', 'start_process', { command: workload('dc-s3'), timeout_ms: 3000 }));
  await sleep(Math.max(0, s + 10000 - Date.now()));
  const serverPid = a.transport.pid;
  await a.transport.close();
  await sleep(2000);
  const w = workPid('dc-s3');
  note('S3', 'client A closed', { serverPid, serverAlive: alive(serverPid), dcPid: pid, dcPidAlive: alive(pid), workloadPid: w, workloadAlive: alive(w), ticksNow: ticks('dc-s3') });
  const b = await connect('S3');
  await call(b.client, 'S3', 'list_sessions', {});
  await call(b.client, 'S3', 'read_process_output', { pid, timeout_ms: 1000 });
  await sleep(Math.max(0, s + 66000 - Date.now()));
  note('S3', 'after 66 s', { workloadAlive: alive(w), ticksOnDisk: ticks('dc-s3') });
  await b.transport.close();
}
log.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(logs, 'dc-run.json'), JSON.stringify(log, null, 2));
console.log('written logs/dc-run.json');
