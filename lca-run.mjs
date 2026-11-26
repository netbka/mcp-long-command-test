// Local Commander self-hosted edition (local-commander-mcp-agent, MIT) side of the long-command test.
// Same structure as dc-run.mjs: starts the server over stdio, runs tick.ps1 in S1-S3 and writes logs/lca-run.json.
// The server's home is redirected into this folder; lca-config.json sets the command allowlist to powershell only
// (the default list has no shell). Usage: node lca-run.mjs
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
const pkg = path.join(here, 'lca/node_modules/local-commander-mcp-agent');
const server = path.join(pkg, 'dist/index.js');
const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
const configFile = path.join(here, 'lca-config.json');
const env = {
  ...getDefaultEnvironment(), USERPROFILE: home, HOME: home, HOMEDRIVE: here.slice(0, 2), HOMEPATH: home.slice(2),
  APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'), TEMP: tmp, TMP: tmp,
  LCMCP_CONFIG: configFile,
};
const tickArgs = (tag) => ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'tick.ps1'), '-Tag', tag];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = { tool: 'Local Commander (self-hosted edition)', package: `local-commander-mcp-agent@${version}`, host: process.env.COMPUTERNAME,
  node: process.version, startedAt: new Date(T0).toISOString(), config: JSON.parse(fs.readFileSync(configFile, 'utf8')), steps: [] };
const note = (scenario, what, data = {}) => { const e = { t: ((Date.now() - T0) / 1000).toFixed(1), scenario, what, ...data }; log.steps.push(e); console.log(JSON.stringify(e).slice(0, 400)); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const ticks = (tag) => { try { return fs.readFileSync(path.join(logs, `${tag}.ticks`), 'utf8').trim().split(/\r?\n/).filter(Boolean).length; } catch { return 0; } };
const workPid = (tag) => { try { return Number(fs.readFileSync(path.join(logs, `${tag}.pid`), 'utf8').trim()); } catch { return null; } };
const text = (r) => (r?.content ?? []).map((c) => c.text ?? '').join('\n');
const json = (t) => { try { return JSON.parse(t); } catch { return null; } };

async function connect(label) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [server, '--stdio', here], env, cwd: here, stderr: 'pipe' });
  const client = new Client({ name: 'long-command-harness', version: '1.0.0' });
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
const idFrom = (t) => { const j = json(t); return j?.id ?? j?.process?.id ?? null; };
const tickLines = (t) => (t.match(/^tick \d+/gm) ?? []).length;
const outputOf = (t) => { const j = json(t); return typeof j?.output === 'string' ? j.output : t; };
const start = (client, scenario, tag) => call(client, scenario, 'process_start', { command: 'powershell', args: tickArgs(tag), cwd: here });

// S1: long command, read output while it runs, read the end.
{
  const { client, transport } = await connect('S1');
  const s = Date.now();
  const id = idFrom(await start(client, 'S1', 'lca-s1'));
  note('S1', 'returned control', { afterMs: Date.now() - s, processId: id, workloadPid: workPid('lca-s1') });
  await sleep(Math.max(0, s + 20000 - Date.now()));
  const mid = outputOf(await call(client, 'S1', 'process_output', { id }));
  note('S1', 'mid-run read', { tickLinesInRead: tickLines(mid), ticksOnDisk: ticks('lca-s1') });
  await sleep(Math.max(0, s + 66000 - Date.now()));
  const end = outputOf(await call(client, 'S1', 'process_output', { id }));
  note('S1', 'end read', { tickLinesInRead: tickLines(end), doneSeen: /done lca-s1/.test(end), ticksOnDisk: ticks('lca-s1'), workloadAlive: alive(workPid('lca-s1')) });
  await transport.close();
}
// S2: cancel after 10 s, check the workload process.
{
  const { client, transport } = await connect('S2');
  const s = Date.now();
  const id = idFrom(await start(client, 'S2', 'lca-s2'));
  await sleep(Math.max(0, s + 10000 - Date.now()));
  await call(client, 'S2', 'process_kill', { id });
  const w = workPid('lca-s2');
  const t1 = ticks('lca-s2');
  await sleep(3000);
  note('S2', '3 s after kill', { processId: id, workloadPid: w, workloadAlive: alive(w), ticksAtKill: t1, ticksNow: ticks('lca-s2') });
  await sleep(5000);
  note('S2', '8 s after kill', { workloadAlive: alive(w), ticksNow: ticks('lca-s2') });
  await call(client, 'S2', 'process_list', {});
  await transport.close();
}
// S3: the client goes away mid-run (server process ends), a new client connects and looks for the command.
{
  const a = await connect('S3');
  const s = Date.now();
  const id = idFrom(await start(a.client, 'S3', 'lca-s3'));
  await sleep(Math.max(0, s + 10000 - Date.now()));
  const serverPid = a.transport.pid;
  await a.transport.close();
  await sleep(2000);
  const w = workPid('lca-s3');
  note('S3', 'client A closed', { serverPid, serverAlive: alive(serverPid), processId: id, workloadPid: w, workloadAlive: alive(w), ticksNow: ticks('lca-s3') });
  const b = await connect('S3');
  await sleep(1000);
  note('S3', '1 s after new server', { workloadAlive: alive(w), ticksNow: ticks('lca-s3') });
  await call(b.client, 'S3', 'process_list', {});
  await call(b.client, 'S3', 'process_output', { id });
  await sleep(Math.max(0, s + 66000 - Date.now()));
  note('S3', 'after 66 s', { workloadAlive: alive(w), ticksOnDisk: ticks('lca-s3') });
  await b.transport.close();
}
log.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(logs, 'lca-run.json'), JSON.stringify(log, null, 2));
console.log('written logs/lca-run.json');
