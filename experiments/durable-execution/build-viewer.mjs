// Disposable read-only viewer builder. Requires actual experiment output; never creates sample data.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const results = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'));
const traces = JSON.parse(await readFile(join(directory, 'traces.json'), 'utf8'));
if (!Array.isArray(results.results) || !Array.isArray(traces)) {
  throw new Error('Expected actual results.results and traces arrays. No viewer was written.');
}
// The data block is inert JSON. Escaping every '<' also prevents '</script>' injection.
const data = JSON.stringify({ results, traces }).replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Durable execution · Recorded failure traces</title>
  <style>
    :root { color-scheme: light; --ink:#202e2b; --muted:#64716d; --paper:#f4f5f1; --card:#fff; --line:#dbe2dc; --accent:#22644f; --soft:#eaf2eb; --warn:#85561d; --bad:#a93737; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { max-width:1180px; margin:auto; padding:44px 28px 64px; }
    .eyebrow { margin:0 0 12px; color:var(--accent); font-size:11px; font-weight:750; letter-spacing:.15em; text-transform:uppercase; }
    h1 { margin:0 0 12px; font-size:clamp(29px,4.3vw,46px); line-height:1.12; letter-spacing:-.045em; font-weight:650; }
    h2 { margin:0 0 16px; font-size:20px; letter-spacing:-.025em; }
    h3 { margin:0; font-size:15px; }
    p { margin:0; }
    .intro { max-width:800px; color:var(--muted); }
    .meta { margin-top:12px; color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
    .metrics { display:flex; flex-wrap:wrap; gap:10px; margin:26px 0; }
    .metric { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 18px; min-width:135px; }
    .metric strong { font-size:24px; margin-right:8px; letter-spacing:-.04em; }
    .metric span { color:var(--muted); font-size:12px; }
    .panel { padding:22px; border:1px solid var(--line); border-radius:14px; background:var(--card); margin-top:18px; }
    .controls { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:end; gap:18px; }
    label { display:block; margin:0 0 6px; font-size:12px; font-weight:700; color:var(--muted); }
    select { width:100%; padding:11px 36px 11px 12px; border:1px solid var(--line); border-radius:7px; font:inherit; background:var(--card); color:var(--ink); }
    button { font:inherit; font-size:13px; font-weight:600; padding:11px 15px; border:1px solid var(--line); border-radius:7px; background:var(--card); color:var(--ink); cursor:pointer; }
    button.primary { color:var(--card); background:var(--accent); border-color:var(--accent); }
    button:hover:not(:disabled) { filter:brightness(.94); }
    button:disabled { opacity:.42; cursor:default; }
    button:focus-visible,select:focus-visible,summary:focus-visible { outline:3px solid #78ad97; outline-offset:3px; }
    .buttons { display:flex; gap:8px; }
    .step-bar { display:flex; align-items:center; justify-content:space-between; gap:15px; margin:18px 0 8px; }
    #step-label { font-size:13px; font-weight:650; }
    .badge { display:inline-block; border-radius:20px; padding:3px 10px; font-size:11px; font-weight:700; background:var(--soft); color:var(--accent); }
    .badge.failed { color:var(--bad); background:#faeceb; }
    .badge.crash { color:var(--warn); background:#fbf1dc; }
    progress { width:100%; height:5px; accent-color:var(--accent); display:block; }
    .quiet { color:var(--muted); font-size:12px; }
    #scenario-note { margin-top:13px; }
    .section-title { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .columns { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    pre { margin:10px 0 0; padding:16px; border:1px solid var(--line); border-radius:8px; background:var(--paper); color:var(--ink); font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace; white-space:pre-wrap; overflow-wrap:anywhere; max-height:420px; overflow:auto; tab-size:2; }
    .run { border-top:1px solid var(--line); padding-top:18px; margin-top:18px; }
    .run:first-child { border:0; padding:0; margin:0; }
    .run-head { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-bottom:15px; }
    .facts { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
    .fact { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:12px; min-width:0; }
    .fact dt { font-size:11px; color:var(--muted); margin-bottom:4px; }
    .fact dd { margin:0; font-size:16px; font-weight:600; overflow-wrap:anywhere; }
    dl { margin:0; }
    .recovery { margin-top:12px; font-size:13px; }
    .recovery strong { font-weight:650; }
    .chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:7px; }
    .chip { border:1px solid var(--line); border-radius:5px; padding:3px 8px; color:var(--muted); font-size:11px; }
    .chip.active { background:#fbf1dc; border-color:#e7d3a7; color:var(--warn); }
    details { margin-top:12px; }
    summary { cursor:pointer; color:var(--accent); font-size:13px; padding:7px 0; font-weight:600; overflow-wrap:anywhere; }
    .context { border-top:1px solid var(--line); padding-top:8px; }
    .empty { padding:22px 0; color:var(--muted); }
    footer { margin-top:24px; color:var(--muted); font-size:12px; }
    [hidden] { display:none !important; }
    @media (max-width:740px) { main { padding:28px 16px 42px; } .panel { padding:17px; } .controls,.columns { grid-template-columns:1fr; } .facts { grid-template-columns:repeat(2,minmax(0,1fr)); } .buttons { justify-content:flex-end; } .metric { min-width:0; flex:1; padding:10px 12px; } }
    @media (prefers-color-scheme:dark) { :root { color-scheme:dark; --ink:#e3e9e3; --muted:#a6b4ab; --paper:#171e1a; --card:#202a24; --line:#38443b; --accent:#a3d7b8; --soft:#2a4133; --warn:#f0cf8c; --bad:#ffc2bb; } button.primary { background:#3c6b50; color:#fff; border-color:#54876a; } .badge.failed { background:#56332f; } .badge.crash,.chip.active { background:#453b28; } .chip.active { border-color:#6c5a3b; } }
  </style>
</head>
<body>
<main>
  <header>
    <p class="eyebrow">Agents Assemble / Architecture experiment 07</p>
    <h1>What survived the failure?</h1>
    <p class="intro">A replay of recorded commands, worker failures and database snapshots from the disposable PostgreSQL experiment. This page reads saved evidence. It does not contact a database, run commands or establish production guarantees.</p>
    <p class="meta" id="metadata"></p>
  </header>
  <div class="metrics" aria-label="Experiment results">
    <div class="metric"><strong id="passed">—</strong><span>passed scenarios</span></div>
    <div class="metric"><strong id="failed">—</strong><span>failed scenarios</span></div>
    <div class="metric"><strong id="assertions">—</strong><span>assertions</span></div>
  </div>
  <section class="panel" aria-label="Recorded trace controls">
    <div class="controls">
      <div><label for="scenario">Recorded scenario</label><select id="scenario"></select></div>
      <div class="buttons"><button id="reset" type="button">Reset</button><button id="previous" type="button">← Previous</button><button id="next" class="primary" type="button">Next →</button></div>
    </div>
    <div class="step-bar"><p id="step-label" aria-live="polite" aria-atomic="true"></p><span class="badge" id="outcome"></span></div>
    <progress id="progress" aria-label="Recorded trace position" max="1" value="0"></progress>
    <p class="quiet" id="scenario-note"></p>
  </section>
  <section class="panel" aria-labelledby="command-heading">
    <h2 id="command-heading">Selected command and recorded result</h2>
    <div class="columns"><div><h3>Command</h3><pre id="command"></pre></div><div><h3>Result</h3><pre id="result"></pre></div></div>
  </section>
  <section class="panel" aria-labelledby="execution-heading">
    <div class="section-title"><h2 id="execution-heading">Execution records</h2><span class="quiet">Captured after this command</span></div>
    <div id="execution"></div>
  </section>
  <section class="panel" aria-labelledby="context-heading">
    <h2 id="context-heading">Complete context snapshots</h2>
    <p class="quiet">Expand a context to inspect all captured records, inbox entries and outbox entries. Snapshots retain the experiment's recorded timing, including pending delivery acknowledgements.</p>
    <div id="contexts"></div>
  </section>
  <details class="panel"><summary>Full experiment report and trace data</summary><p class="quiet">The complete input files embedded in this page, including scenarios without recorded commands.</p><pre id="full-data"></pre></details>
  <footer>Recorded evidence only · Disposable architecture experiment · Elapsed time never grants approval</footer>
</main>
<script type="application/json" id="trace-data">${data}</script>
<script>
  'use strict';
  const data = JSON.parse(document.getElementById('trace-data').textContent);
  const byId = (id) => document.getElementById(id);
  const json = (value) => value === undefined ? 'Not recorded' : JSON.stringify(value, null, 2);
  const write = (id, value) => { byId(id).textContent = String(value); };
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
  const names = [...new Set([...data.results.results.map((r) => r.name), ...data.traces.map((t) => t.scenario)])];
  let step = 0;
  for (const name of names) {
    const report = data.results.results.find((r) => r.name === name);
    const option = node('option', (report ? report.status.toUpperCase() + ' · ' : '') + name);
    option.value = name;
    byId('scenario').append(option);
  }
  for (const key of ['passed', 'failed', 'assertions']) write(key, data.results[key] ?? 'Not recorded');
  write('metadata', [data.results.date, data.results.databaseVersion, data.results.node && 'Node ' + data.results.node].filter(Boolean).join(' · '));
  write('full-data', json(data));
  const details = (title, value) => { const item = node('details'); item.append(node('summary', title), node('pre', json(value))); return item; };
  const human = (value) => value === undefined || value === null ? 'Not recorded' : typeof value === 'object' ? json(value) : String(value);
  function fact(list, title, value) { const item = node('div', undefined, 'fact'); item.append(node('dt', title), node('dd', human(value))); list.append(item); }
  function renderExecution(snapshot) {
    const container = byId('execution'); container.replaceChildren();
    const records = snapshot.execution?.records;
    if (!Array.isArray(records) || !records.length) { container.append(node('p', 'No Execution records in this snapshot.', 'empty')); return; }
    for (const record of records) {
      const state = record.state ?? {};
      const article = node('article', undefined, 'run');
      const heading = node('div', undefined, 'run-head');
      heading.append(node('h3', 'Record ' + record.id), node('span', human(state.status), 'badge'));
      const facts = node('dl', undefined, 'facts');
      fact(facts, 'State version', state.version);
      fact(facts, 'Work consumed / allowance', state.work === undefined ? undefined : state.work + ' / ' + human(state.limit));
      fact(facts, 'Attempts / maximum', state.attempts === undefined ? undefined : state.attempts + ' / ' + human(state.maxAttempts));
      fact(facts, 'Recorded approvals', Array.isArray(state.approvals) ? state.approvals.length : undefined);
      const recovery = node('div', undefined, 'recovery');
      recovery.append(node('strong', 'Recovery obligations'));
      const chips = node('div', undefined, 'chips');
      const labels = { edits: 'Observed edit', workspace: 'Workspace uncertainty', effect: 'Unknown effect', cancel: 'Cancellation pending', gap: 'Event gap' };
      const flags = state.flags && typeof state.flags === 'object' ? Object.entries(state.flags) : [];
      if (!flags.length) chips.append(node('span', 'Flags not recorded', 'quiet'));
      for (const [key, value] of flags) chips.append(node('span', (labels[key] ?? key) + ': ' + human(value), 'chip' + (value === true ? ' active' : '')));
      recovery.append(chips);
      article.append(heading, facts, recovery);
      article.append(details('Approval scopes, wait, writer and retry state', { approvals: state.approvals, wait: state.wait, writer: state.writer, generation: state.generation, retry: state.retry }));
      article.append(details('Complete Execution state · ' + record.id, state));
      container.append(article);
    }
  }
  function render() {
    const name = byId('scenario').value;
    const traces = data.traces.filter((entry) => entry.scenario === name);
    const report = data.results.results.find((entry) => entry.name === name);
    step = Math.max(0, Math.min(step, traces.length - 1));
    const entry = traces[step];
    const outcome = entry?.result;
    write('step-label', entry ? 'Recorded step ' + (step + 1) + ' of ' + traces.length + ' · ' + (entry.command?.context ?? '') + ' / ' + (entry.command?.op ?? '') : 'No command trace recorded for this scenario');
    const label = outcome?.crashed ? 'Worker crash recorded' : outcome?.ok === false ? 'Command rejected' : outcome?.ok === true ? 'Command accepted' : 'Recorded observation';
    write('outcome', entry ? label : report?.status ?? 'No results');
    byId('outcome').className = 'badge' + (outcome?.crashed ? ' crash' : report?.status === 'failed' ? ' failed' : '');
    byId('progress').max = Math.max(traces.length, 1);
    byId('progress').value = entry ? step + 1 : 0;
    byId('previous').disabled = !entry || step === 0;
    byId('next').disabled = !entry || step >= traces.length - 1;
    byId('reset').disabled = !entry || step === 0;
    write('scenario-note', (report ? 'Scenario ' + report.status + (report.assertions !== undefined ? ' · ' + report.assertions + ' assertions' : '') + '. ' : '') + (report?.error ?? (entry ? 'Use the controls to inspect the saved sequence. Rejections and crashes may be expected test outcomes.' : 'The scenario result is preserved; this test emitted no command snapshots.')));
    write('command', entry ? json(entry.command) : 'No command recorded.');
    write('result', entry ? json(entry.result) : json(report));
    const snapshot = entry?.snapshot ?? {};
    renderExecution(snapshot);
    const contexts = byId('contexts'); contexts.replaceChildren();
    for (const [context, value] of Object.entries(snapshot)) {
      const counts = ['records', 'inbox', 'outbox'].map((key) => (Array.isArray(value[key]) ? value[key].length : '?') + ' ' + key).join(' · ');
      const item = details(context + ' · ' + counts, value); item.className = 'context'; contexts.append(item);
    }
    if (!Object.keys(snapshot).length) contexts.append(node('p', 'No context snapshot recorded at this position.', 'empty'));
  }
  byId('scenario').addEventListener('change', () => { step = 0; render(); });
  byId('previous').addEventListener('click', () => { step--; render(); });
  byId('next').addEventListener('click', () => { step++; render(); });
  byId('reset').addEventListener('click', () => { step = 0; render(); });
  render();
</script>
</body>
</html>`;
const destination = join(directory, 'durable-execution.throwaway.html');
await writeFile(destination, html);
console.log(destination);
