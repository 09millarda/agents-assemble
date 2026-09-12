#!/usr/bin/env python3
"""Build a disposable, self-contained model and recorded-evidence viewer."""
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent
evidence = []
for arg in sys.argv[1:]:
    p = root / arg
    evidence.append({"source": arg, "payload": json.loads(p.read_text())})
data = json.dumps(evidence).replace('<', '\\u003c')
html = r'''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Runner recovery lab</title>
<style>
:root{font-family:system-ui,sans-serif;color:#1d2c39;background:#f3f5f7;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:42px 28px}h1{font-size:36px;letter-spacing:-1.2px;margin:8px 0}h2{font-size:21px;margin-top:0}p{max-width:840px;line-height:1.6}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#506782}.muted{color:#566475;font-size:14px}.tabs,.buttons{display:flex;gap:9px;flex-wrap:wrap;margin:20px 0}button,select{font:inherit;padding:10px 14px;border:1px solid #ccd5de;border-radius:7px;background:white;color:#21364b;cursor:pointer}button.active,button.primary{background:#2558b6;color:white;border-color:#2558b6}button:hover{filter:brightness(.96)}.card{background:white;border:1px solid #dbe1e7;border-radius:12px;padding:23px;margin:20px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.state{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.metric{padding:14px;background:#f3f6fa;border-radius:7px}.metric strong{display:block;font-size:18px;margin:6px 0}.metric span{font-size:12px;color:#576a7b}.notice{border-left:4px solid #d5a23b;padding:10px 15px;background:#fff7df;border-radius:3px;line-height:1.5}pre{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.6;background:#f7f9fb;padding:15px;border-radius:6px;max-height:540px;overflow:auto}label{display:block;font-size:13px;font-weight:600;margin:12px 0 7px}select{max-width:100%;width:100%}.history{max-height:190px;overflow:auto}.history li{font-size:14px;line-height:1.7}.hidden{display:none}a{color:#2558b6}@media(max-width:760px){.grid,.state{grid-template-columns:1fr}main{padding:24px 15px}h1{font-size:30px}}
</style>
<main>
<div class="eyebrow">Agents Assemble · Decision #8 · disposable experiment</div>
<h1>When a runner disappears</h1>
<p>Explore which facts survive a lost connection or process crash, and why reconnecting cannot authorize another launch. The model illustrates the decision; the recorded evidence contains the actual probe observations.</p>
<div class="tabs"><button id="model-tab" class="active">Explore the model</button><button id="evidence-tab">Inspect recorded evidence</button></div>
<section id="model-panel">
<div class="notice">This browser model has no real processes, credentials or persistence. Its checkpoint and stop states are illustrative. Actual Git verification, native behavior and fault results appear in the evidence tab.</div>
<div class="card"><h2>Guided paths</h2><div class="buttons" id="guides"></div><p id="guide-description" class="muted"></p><button id="next" class="primary">Take next step</button></div>
<div class="card"><h2>What is known now</h2><div class="state" id="state"></div><p id="message"></p><details><summary>Complete model state</summary><pre id="payload"></pre></details></div>
<div class="card"><h2>Try a transition</h2><p class="muted">Every action stays available. Rejected actions explain which evidence or authority is missing.</p><div class="buttons" id="actions"></div><ol class="history" id="history"></ol></div>
</section>
<section id="evidence-panel" class="hidden"><div class="notice">The native probe and daemon fault fixture are separate evidence paths. A passing fixture does not certify a production tunnel, native process containment, another machine, or external effects.</div><div class="card"><h2>Recorded experiment</h2><label for="source">Evidence file</label><select id="source"></select><label for="record">Top-level record</label><select id="record"></select><p class="muted" id="source-note"></p><pre id="record-payload"></pre><details><summary>Entire evidence file</summary><pre id="file-payload"></pre></details></div></section>
<p class="muted">A daemon receipt, a harness outcome and Execution's accepted result are separate facts. <a href="https://github.com/09millarda/agents-assemble/issues/8">Decision ticket</a></p>
</main>
<script>
const evidence=__EVIDENCE__;
const initial=()=>({generation:1,grant:'active',admitted:1,launches:0,daemon:'empty',process:'absent',launchPermit:false,result:null,executionVerdict:null,checkpoint:null,history:[]});
const labels={receipt:'Record command receipt',duplicate:'Replay command',intent:'Record launch intent',spawn:'Start native work',finish:'Save result and checkpoint',accept:'Execution accepts result',crash:'Crash daemon',reconnect:'Reconnect and reconcile',expire:'Expire grant',oldStop:'Receive old stop acknowledgment',reset:'Reset'};
function reduce(old,action){let s=structuredClone(old),message='';if(action==='reset')return{state:initial(),message:'Reset to one admitted invocation.'};
switch(action){
case'receipt':if(s.grant!=='active')message='Rejected: no current grant.';else if(s.daemon!=='empty')message='Existing command verdict retained.';else{s.daemon='received';message='Receipt is durable; native work has not started.'}break;
case'duplicate':if(s.daemon==='empty')message='No stored receipt; deliver a valid command first.';else message='Return the stored command verdict. No second invocation is admitted.';break;
case'intent':if(s.daemon!=='received'||s.grant!=='active')message='Rejected: receipt and current grant required.';else{s.daemon='launch intent';s.launchPermit=true;message='Launch uncertainty is durable before the native call.'}break;
case'spawn':if(!s.launchPermit||s.daemon!=='launch intent'||s.grant!=='active')message='Blocked: no unconsumed launch permission. An uncertain start cannot be replayed.';else{s.launchPermit=false;s.launches++;s.daemon='running';s.process='running';message='One native invocation started in this uninterrupted model process.'}break;
case'finish':if(s.daemon!=='running')message='Blocked: no observed running invocation to finish.';else{s.process='exited (model scope)';s.daemon='result saved';s.result={id:'result-1',generation:1,digest:'fixed-result-digest'};s.checkpoint={baseline:'original-failing-commit',working:'recovered-working-commit',artifacts:'pinned-content',verification:'illustrative only'};message='Local result and checkpoint are saved. Execution has not yet accepted them.'}break;
case'accept':if(!s.result)message='Blocked: no durable result.';else if(s.executionVerdict){message='Return the original accepted verdict, even after expiry.';}else if(s.result.generation!==s.generation||s.grant!=='active'){message='Rejected: a newly arriving result has no current authority.';}else{s.executionVerdict={resultId:s.result.id,digest:s.result.digest,verdict:'accepted',generation:s.generation};message='Execution committed acceptance. Losing its reply does not undo this fact.'}break;
case'crash':s.launchPermit=false;if(s.daemon==='launch intent'||s.daemon==='running'){s.daemon='start or outcome unknown';s.process='unknown';}message='Daemon memory is lost. Durable facts remain; a child may still exist.';break;
case'reconnect':if(s.executionVerdict)message='Reconciliation returns the original accepted result verdict.';else if(s.daemon==='start or outcome unknown')message='Recovery paused: prove the exact invocation or account for the old writer before fresh admission.';else if(s.result)message='Replay the exact durable result; do not launch again.';else message='Reconcile the existing command and current grant. Reconnect admits no new work.';break;
case'expire':s.grant='expired';s.launchPermit=false;message='Execution rejects new stale transitions. Expiry does not stop a customer process.';break;
case'oldStop':message='Old-generation evidence cannot stop or clear the current writer. External effects remain a separate obligation.';break;
default:message='Unknown action.';
}s.history.push({action,message});return{state:s,message};}
const guides=[{name:'Lost receipt',description:'Replay after a daemon crash. A durable receipt remains one invocation.',steps:['receipt','crash','duplicate','reconnect','intent','spawn']},{name:'Uncertain launch',description:'Crash after recording launch intent. A new start must remain blocked.',steps:['receipt','intent','crash','reconnect','spawn']},{name:'Lost result reply',description:'Execution accepted the result, then its reply disappeared. Expiry must not erase the old verdict.',steps:['receipt','intent','spawn','finish','accept','crash','expire','reconnect','accept']},{name:'Late result',description:'A result saved locally before expiry is not automatically accepted by Execution afterward.',steps:['receipt','intent','spawn','finish','expire','accept','oldStop']}];
let current=initial(),guide=guides[0],step=0;
const $=id=>document.getElementById(id);
function render(message){$('state').replaceChildren();for(const [title,value]of[['Daemon journal',current.daemon],['Native process',current.process],['Execution verdict',current.executionVerdict?.verdict||'awaiting result'],['Grant',current.grant],['Invocations admitted',current.admitted],['Native launches',current.launches]]){const el=document.createElement('div');el.className='metric';const span=document.createElement('span');span.textContent=title;const strong=document.createElement('strong');strong.textContent=value;el.append(span,strong);$('state').append(el)}$('message').textContent=message;$('payload').textContent=JSON.stringify(current,null,2);$('history').replaceChildren();for(const row of current.history){const li=document.createElement('li');li.textContent=labels[row.action]+': '+row.message;$('history').append(li)}$('next').textContent=step<guide.steps.length?'Next: '+labels[guide.steps[step]]:'Walkthrough complete';$('next').disabled=step>=guide.steps.length;}
function dispatch(a){const next=reduce(current,a);current=next.state;render(next.message);}
for(const [key,label]of Object.entries(labels)){const b=document.createElement('button');b.textContent=label;b.onclick=()=>dispatch(key);$('actions').append(b)}
for(const g of guides){const b=document.createElement('button');b.textContent=g.name;b.onclick=()=>{guide=g;step=0;current=initial();$('guide-description').textContent=g.description;render('Ready to explore '+g.name.toLowerCase()+'.')};$('guides').append(b)}
$('next').onclick=()=>{if(step<guide.steps.length){const action=guide.steps[step++];dispatch(action)}};
$('guide-description').textContent=guide.description;render('One invocation has been admitted by Execution; the daemon has not received it.');
for(const section of ['model','evidence'])$(section+'-tab').onclick=()=>{for(const candidate of ['model','evidence']){$(candidate+'-panel').classList.toggle('hidden',section!==candidate);$(candidate+'-tab').classList.toggle('active',section===candidate)}};
let records=[];
function fileChanged(){const f=evidence[Number($('source').value)];$('record').replaceChildren();if(!f){$('record-payload').textContent='No recorded evidence supplied yet.';return}const payload=f.payload;records=Array.isArray(payload)?payload.map((v,i)=>[String(i),v]):Object.entries(payload);records.forEach(([k,v],i)=>{const o=document.createElement('option');o.value=i;o.textContent=k+(Array.isArray(v)?' ('+v.length+' entries)':'');$('record').append(o)});$('source-note').textContent='Embedded verbatim JSON from '+f.source+'. Full record and trace snapshots remain inspectable below.';$('file-payload').textContent=JSON.stringify(payload,null,2);recordChanged();}
function recordChanged(){$('record-payload').textContent=JSON.stringify(records[Number($('record').value)]?.[1]??null,null,2)}
evidence.forEach((f,i)=>{const o=document.createElement('option');o.value=i;o.textContent=f.source;$('source').append(o)});$('source').onchange=fileChanged;$('record').onchange=recordChanged;fileChanged();
</script></html>'''
(root / 'runner-recovery-lab.html').write_text(html.replace('__EVIDENCE__', data))
print(root / 'runner-recovery-lab.html')
