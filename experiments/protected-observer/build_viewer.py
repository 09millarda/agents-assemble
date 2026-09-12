"""Build an offline throwaway evidence viewer; controls are illustrative only."""
import base64
from pathlib import Path

root = Path(__file__).resolve().parent
encoded = base64.b64encode((root / "evidence.json").read_bytes()).decode()
html = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Protected observer · Decision 11</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f6f3;color:#1c3029;font:16px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:auto;padding:40px 24px}h1{font-size:34px;line-height:1.15;margin:10px 0}h2{font-size:21px}
.eyebrow{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#456957}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}
section{background:white;border:1px solid #d8e2db;border-radius:14px;padding:24px;margin:22px 0}button,select{font:inherit;padding:9px 12px;border:1px solid #9cb6a4;border-radius:7px;background:#fff;color:inherit;margin:3px;cursor:pointer}
button:hover{background:#e8f0e9}.verdict{font-size:21px;font-weight:650;padding:15px;background:#e7f0e9;border-radius:7px}
.muted{color:#577164}pre{font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:550px;overflow:auto;background:#f3f6f3;padding:15px;border-radius:8px}
dl{display:grid;grid-template-columns:1fr 1fr}dt,dd{margin:0;padding:5px 0;border-bottom:1px solid #e5ebe6}dd{text-align:right}select{max-width:100%;width:100%}@media(max-width:750px){.grid{grid-template-columns:1fr}main{padding:24px 14px}}
</style><main><div class="eyebrow">Agents Assemble · Wayfinder #11 · Throwaway lab</div>
<h1>A stopped scope is a bounded observation</h1><p>Can a restarted reporter recover the original process scope from a surviving protected keeper? The native experiment says yes for this reference path. An outside writer kept running, so automatic takeover remains ineligible.</p>
<div class="grid"><section><h2>Explore the recovery rule</h2><p class="muted">These controls are an illustrative model. They never operate the machine or count as measured tests.</p>
<div id="verdict" class="verdict"></div><dl id="state"></dl><div id="actions"></div>
<h3>Guided cases</h3><div id="guides"></div><p id="guideText" class="muted"></p><button id="next">Next step</button><details><summary>Complete model state</summary><pre id="rawState"></pre></details></section>
<section><h2>Recorded native evidence</h2><p>25 named cases; 14 denial attempts are grouped in one case. The keeper, manager and test service survived the reporter crashes.</p>
<select id="cases" aria-label="Recorded experiment case"></select><p id="caseSummary" class="muted"></p><pre id="payload"></pre>
<details><summary>Complete retained experiment record</summary><pre id="complete"></pre></details></section></div>
<p class="muted">Missing or recreated objects stay unknown. Receipt replay does not grant a replacement. Remote effects, checkpoints and complete writer coverage are separate obligations.</p></main>
<script>
const evidence=JSON.parse(atob("EVIDENCE_BASE64"));
const initial=()=>({keeperAlive:true,originalObject:true,journalIntact:true,launchGateClosed:false,payloadEmpty:false,receiptDurable:false,coverageComplete:false,effectsAccounted:false,checkpointVerified:false,reporterRestarts:0});
function reduce(s,a){s={...s};if(a==='reset')return initial();if(a==='stop'){s.launchGateClosed=true;s.payloadEmpty=true}if(a==='restart')s.reporterRestarts++;if(a==='persist'&&s.keeperAlive&&s.originalObject&&s.journalIntact&&s.launchGateClosed&&s.payloadEmpty)s.receiptDurable=true;if(a==='loseKeeper')s.keeperAlive=false;if(a==='replaceObject')s.originalObject=false;if(a==='loseJournal')s.journalIntact=false;return s}
const labels={keeperAlive:'Protected keeper retained',originalObject:'Original object retained',journalIntact:'Journal continuity',launchGateClosed:'Launch gate closed',payloadEmpty:'Payload observed empty',receiptDurable:'Receipt recorded',coverageComplete:'All writers covered',effectsAccounted:'External effects accounted',checkpointVerified:'Checkpoint verified',reporterRestarts:'Reporter restarts'};
const actions={reset:'Reset',stop:'Stop payload',restart:'Restart reporter',persist:'Record scoped receipt',loseKeeper:'Lose keeper',replaceObject:'Replace scope object',loseJournal:'Lose journal'};
let state=initial(),guide=[],step=0;
function render(){document.querySelector('#state').replaceChildren(...Object.entries(state).flatMap(([k,v])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=labels[k];dd.textContent=typeof v==='boolean'?(v?'Yes':'No'):v;return[dt,dd]}));document.querySelector('#rawState').textContent=JSON.stringify(state,null,2);document.querySelector('#verdict').textContent=state.receiptDurable?'Scoped receipt recorded · takeover paused':(!state.keeperAlive||!state.originalObject||!state.journalIntact?'Scope unknown · takeover paused':state.payloadEmpty?'Payload empty · other obligations remain':'Writer obligation unresolved');document.querySelector('#next').disabled=step>=guide.length;document.querySelector('#next').textContent=step<guide.length?`Next: ${actions[guide[step]]}`:'Walkthrough complete'}
for(const [a,label] of Object.entries(actions)){let b=document.createElement('button');b.textContent=label;b.onclick=()=>{state=reduce(state,a);render()};document.querySelector('#actions').append(b)}
for(const [label,sequence,description] of [['Reporter recovery',['stop','restart','persist'],'The surviving keeper preserves the original handle. The receipt covers that scope only.'],['Replacement object',['stop','replaceObject','restart','persist'],'An empty replacement cannot stand in for the original object.'],['Lost keeper',['stop','loseKeeper','restart','persist'],'Reporter restart cannot recover lost keeper custody by a path name.']]){let b=document.createElement('button');b.textContent=label;b.onclick=()=>{state=initial();guide=sequence;step=0;document.querySelector('#guideText').textContent=description;render()};document.querySelector('#guides').append(b)}
document.querySelector('#next').onclick=()=>{if(step<guide.length)state=reduce(state,guide[step++]);render()};
const select=document.querySelector('#cases');evidence.cases.forEach((c,i)=>{let o=document.createElement('option');o.value=i;o.textContent=c.name.replaceAll('_',' ');select.append(o)});function show(){const c=evidence.cases[+select.value];document.querySelector('#payload').textContent=JSON.stringify(c.result,null,2);document.querySelector('#caseSummary').textContent='Actual retained record: '+c.name.replaceAll('_',' ')}select.onchange=show;document.querySelector('#complete').textContent=JSON.stringify(evidence,null,2);show();render();
</script></html>'''
(root / 'protected-observer-lab.html').write_text(html.replace('EVIDENCE_BASE64', encoded))
print(root / 'protected-observer-lab.html')
