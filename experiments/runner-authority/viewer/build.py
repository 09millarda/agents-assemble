#!/usr/bin/env python3
"""THROWAWAY: bundle measured evidence and an explicitly illustrative model."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
evidence = {}
for relative in ['evidence.json', 'review/boundary-results.json']:
    path = root / relative
    if path.exists():
        evidence[relative] = json.loads(path.read_text())
template = r'''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Who may clear a stopped writer?</title>
<style>
:root{font-family:system-ui,sans-serif;color:#153337;background:#f4f7f6}*{box-sizing:border-box}body{margin:0}main{max-width:1220px;margin:0 auto;padding:40px 24px}h1{font-size:36px;letter-spacing:-1px;margin:9px 0 14px}h2{font-size:21px;margin-top:0}p{line-height:1.65;max-width:890px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#28726b}.note{border-left:3px solid #448f83;padding-left:16px;color:#416167}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:24px 0}.card{background:white;border:1px solid #d4e1dd;border-radius:12px;padding:23px}.wide{grid-column:1/-1}button,select{font:inherit;border:1px solid #a3c7be;color:#163b37;background:#f8fcfa;padding:9px 12px;border-radius:6px;cursor:pointer}button:hover{background:#e3f0ea}button[aria-selected=true]{background:#1b6459;color:white}.controls{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.status{font-weight:650;font-size:19px;color:#195f52}dl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}dt{color:#496b66}dd{margin:0;font-weight:550}pre{background:#f3f7f5;padding:14px;overflow:auto;font-size:12px;line-height:1.6;max-height:480px;border-radius:5px}details{margin-top:15px}summary{cursor:pointer}#event{min-height:56px}.tabs{display:flex;flex-wrap:wrap;gap:7px}.steps{color:#48665e;font-size:14px}.badge{display:inline-block;padding:5px 9px;background:#e1eee9;border-radius:30px;font-size:12px;margin-right:7px}@media(max-width:740px){.grid{grid-template-columns:1fr}h1{font-size:29px}main{padding:25px 14px}dl{grid-template-columns:1.1fr 1fr}}
</style><main>
<div class="eyebrow">Agents Assemble · Decision #10 · Disposable lab</div>
<h1>Who may clear a stopped writer?</h1>
<p>Explore how an enrolled observer's receipt becomes an accepted fact, and why that fact still needs separate writer coverage, effect accounting and a verified checkpoint before recovery may start.</p>
<p class="note">The controls below are an illustrative state model. They do not perform TLS, stop real processes, or certify isolation. The recorded experiment section contains the actual local TLS fixture evidence, including its full sanitized state.</p>
<div class="grid"><section class="card">
<h2>Recovery state</h2><div id="status" class="status"></div><dl id="fields"></dl>
<details><summary>Complete model state</summary><pre id="state"></pre></details>
</section><section class="card"><h2>Try the boundaries</h2>
<div id="controls" class="controls"></div><p id="event" aria-live="polite"></p>
<p class="note">History stays readable after routine rotation. Revoked credentials cannot write or query it. Compromised evidence can be quarantined without rewriting the old verdict.</p>
</section><section class="card wide"><h2>Guided walkthroughs</h2><div class="tabs" id="tabs"></div><p id="guide"></p><div class="controls"><button id="next">Next step</button><button id="reset">Reset model</button></div><div id="steps" class="steps"></div></section>
<section class="card wide"><h2>Recorded authenticated experiment</h2><p>These are archived observations, separate from the model above. Select an evidence file to inspect every recorded scenario and state payload.</p><select id="file"></select><div class="controls"><input id="filter" aria-label="Filter evidence" placeholder="Search scenario names" style="font:inherit;padding:8px;min-width:250px"><select id="scenario" aria-label="Evidence scenario"></select></div><div id="count"></div><p id="recordSummary"></p><details><summary>Selected record: complete state and response</summary><pre id="record"></pre></details><details><summary>Complete evidence document</summary><pre id="all"></pre></details></section></div>
<p class="note">No production daemon or protected observer is implemented here. Service credentials and model-account credentials are separate. Root/operator compromise, remote effects, full native supervision recovery and Fleet-to-Execution revocation propagation remain outside this fixture.</p>
</main><script>
'use strict';
const evidence=__EVIDENCE__;
const initial=()=>({credential:'active',profile:'unrestricted same user',receipt:null,writer:'unresolved',effects:'unknown',checkpoint:'unverified',evidence:'usable',generation:1,budget:1,admissions:0,event:'No accepted stop observation yet.'});
const canRecover=s=>s.credential==='active'&&s.profile==='trusted fixture only'&&s.writer==='settled'&&s.effects==='accounted'&&s.checkpoint==='verified exact scope'&&s.evidence==='usable'&&s.budget>0;
function reduce(previous,action){const s=structuredClone(previous);switch(action){
case 'Trust fixture observer':s.profile='trusted fixture only';s.event='Selected a controlled fixture assumption. This does not validate a protected deployment.';break;
case 'Submit exact stop receipt':if(s.credential!=='active'){s.event='Rejected before replay lookup: credential revoked.';break}if(s.receipt){s.event='Returned the immutable old verdict. No new writer transition.';break}s.receipt={id:'stop-1',generation:s.generation,verdict:s.profile==='trusted fixture only'?'writer cleared':'partial observation only'};if(s.profile==='trusted fixture only')s.writer='settled';s.event='Receipt recorded. Coverage depends on the approved observer profile.';break;
case 'Account for effects':s.effects='accounted';s.event='External-effect accounting completed independently.';break;
case 'Verify checkpoint':s.checkpoint='verified exact scope';s.event='Checkpoint verified against the pinned input and exact artifact bytes.';break;
case 'Revoke credential':s.credential='revoked';s.event='Further operations fail authentication/authorization. Running work is not remotely canceled.';break;
case 'Rotate to active key':s.credential='active';s.event='New authorized key; stable observer and accepted history preserved.';break;
case 'Quarantine evidence':s.evidence='quarantined';s.event='Accepted history remains, but disputed evidence cannot support fresh recovery.';break;
case 'Lose journal':s.writer='unresolved';s.event='Journal continuity is unknown. A new name or sequence cannot prove the old writer stopped.';break;
case 'Admit fresh recovery':if(canRecover(s)){s.generation++;s.writer='active replacement';s.budget--;s.admissions++;s.event='Fresh bounded invocation admitted once; the replacement has its own writer obligation.'}else s.event='Paused: current authority, writer, effects, checkpoint, evidence and allowance must all permit recovery.';break;
default:throw Error('unknown action');}return s;}
const actions=['Trust fixture observer','Submit exact stop receipt','Account for effects','Verify checkpoint','Revoke credential','Rotate to active key','Quarantine evidence','Lose journal','Admit fresh recovery'];
const guides=[{name:'Complete bounded recovery',description:'The positive path uses an explicitly trusted test observer; it does not certify local tool isolation.',steps:[actions[0],actions[1],actions[2],actions[3],actions[8],actions[1],actions[8]]},{name:'Authentic but incomplete',description:'A real credential can carry an observation from an ineligible same-user profile.',steps:[actions[1],actions[2],actions[3],actions[8]]},{name:'Rotation and replay',description:'Revocation blocks even replay; a newly authorized key can recover the unchanged historical verdict.',steps:[actions[0],actions[1],actions[4],actions[1],actions[5],actions[1]]},{name:'Compromise and continuity',description:'Neither an immutable acceptance nor a replacement journal is enough to authorize new work.',steps:[actions[0],actions[1],actions[2],actions[3],actions[6],actions[8],actions[7],actions[8]]}];
let state=initial(),guide=0,step=0;
const $=id=>document.getElementById(id);
function render(){ $('status').textContent=canRecover(state)?'Ready for one bounded admission':state.admissions?'Replacement writer needs its own accounting':'Recovery remains paused';$('fields').replaceChildren();for(const [key,value] of Object.entries({Credential:state.credential,'Observer profile':state.profile,'Receipt verdict':state.receipt?.verdict??'none','Local writer':state.writer,'External effects':state.effects,Checkpoint:state.checkpoint,'Evidence status':state.evidence,Generation:state.generation,'Remaining allowance':state.budget})){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;$('fields').append(dt,dd)}$('state').textContent=JSON.stringify(state,null,2);$('event').textContent=state.event;$('guide').textContent=guides[guide].description;$('steps').textContent=guides[guide].steps.map((v,i)=>(i<step?'✓ ':i===step?'→ ':'')+v).join('  ·  ');$('next').disabled=step>=guides[guide].steps.length;[...$('tabs').children].forEach((button,i)=>button.setAttribute('aria-selected',String(i===guide)));}
for(const action of actions){const b=document.createElement('button');b.textContent=action;b.onclick=()=>{state=reduce(state,action);render()};$('controls').append(b)}
guides.forEach((g,i)=>{const b=document.createElement('button');b.textContent=g.name;b.onclick=()=>{guide=i;step=0;state=initial();render()};$('tabs').append(b)});
$('next').onclick=()=>{state=reduce(state,guides[guide].steps[step++]);render()};$('reset').onclick=()=>{state=initial();step=0;render()};render();
for(const file of Object.keys(evidence)){const o=document.createElement('option');o.value=file;o.textContent=file;$('file').append(o)}
function scenarios(doc){if(Array.isArray(doc))return doc;for(const key of ['scenarios','results','checks','cases'])if(Array.isArray(doc[key]))return doc[key];return [doc]}
let rows=[];function updateRows(){const doc=evidence[$('file').value]??{};$('all').textContent=JSON.stringify(doc,null,2);rows=scenarios(doc).filter(x=>JSON.stringify(x.name??x.case??x.scenario??x.id??x).toLowerCase().includes($('filter').value.toLowerCase()));$('scenario').replaceChildren();rows.forEach((r,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=r.name??r.case??r.scenario??r.id??('Record '+(i+1));$('scenario').append(o)});$('count').textContent=rows.length+' displayed records. Recorded values are not results of the illustrative controls.';updateRecord()}
function updateRecord(){const r=rows[Number($('scenario').value)]??{};$('record').textContent=JSON.stringify(r,null,2);$('recordSummary').textContent=(r.passed?'PASS · ':'')+(r.name??r.case??'')+' · '+JSON.stringify(r.result??r.actual??{});}$('file').onchange=updateRows;$('filter').oninput=updateRows;$('scenario').onchange=updateRecord;updateRows();
</script></html>'''
encoded = json.dumps(evidence, ensure_ascii=True).replace('<', '\\u003c')
(root / 'runner-authority-lab.html').write_text(template.replace('__EVIDENCE__', encoded))
print('Bundled', ', '.join(evidence), 'into runner-authority-lab.html')
