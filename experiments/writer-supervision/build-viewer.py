#!/usr/bin/env python3
"""Generate a self-contained, throwaway viewer; no network or dependencies."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
paths = sorted((ROOT / 'native').glob('*/results.json'))
paths += sorted((ROOT / 'native').glob('*/scoped-receipt.json'))
fixture = ROOT / 'fixtures/run-20260912-final/evidence.json'
if fixture.exists():
    paths.append(fixture)
paths += sorted((ROOT / 'protocol').rglob('*.json')) if (ROOT / 'protocol').exists() else []
paths += sorted(ROOT.glob('*protocol*.json'))
evidence = []
for path in dict.fromkeys(paths):
    evidence.append({'source': str(path.relative_to(ROOT)), 'payload': json.loads(path.read_text())})
data = json.dumps(evidence, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')

HTML = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Writer supervision · decision lab</title>
<style>
:root{color-scheme:light;--ink:#1c2a31;--muted:#5b6b74;--line:#d7e0e4;--paper:#fff;--accent:#116b64;--pale:#e8f3f0;--warning:#865819}
*{box-sizing:border-box}body{margin:0;background:#f4f6f5;color:var(--ink);font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1180px;margin:auto;padding:40px 28px 72px}h1{font-size:clamp(28px,4vw,40px);line-height:1.16;letter-spacing:-.035em;margin:8px 0 14px;max-width:780px}h2{font-size:19px;margin:0 0 14px}h3{font-size:15px;margin:0 0 8px}p{margin:0 0 14px}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:700}.intro{max-width:820px;color:var(--muted);font-size:16px}.notice{border-left:3px solid var(--accent);padding:10px 14px;background:var(--pale);font-size:13px;margin:22px 0}.grid{display:grid;grid-template-columns:1.14fr 1fr;gap:20px;align-items:start}.card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:22px;margin-bottom:20px}.status{font-size:21px;font-weight:650;margin:0 0 4px}.explanation{color:var(--muted);font-size:14px;min-height:42px}.state{display:grid;grid-template-columns:1fr 1fr;gap:0 20px;margin:16px 0 0}.state>div{padding:11px 0;border-top:1px solid var(--line)}dt{font-size:12px;color:var(--muted)}dd{margin:3px 0 0;font-weight:600;overflow-wrap:anywhere}.pill{display:inline-block;font-size:12px;color:var(--accent);background:var(--pale);padding:3px 8px;border-radius:20px}.actions{display:flex;flex-wrap:wrap;gap:8px}button,select{font:inherit}button{cursor:pointer;background:white;border:1px solid #b9c9cc;border-radius:7px;padding:9px 12px;color:var(--ink);text-align:left}button:hover{border-color:var(--accent);background:#f1f8f6}button:focus-visible,select:focus-visible{outline:3px solid #82b7ad;outline-offset:2px}.primary{background:var(--accent);border-color:var(--accent);color:white}.primary:hover{background:#0a5b55;color:white}.small{font-size:12px;color:var(--muted)}.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}.tabs button{font-size:13px;padding:8px 10px}.tabs button[aria-selected=true]{color:var(--accent);background:var(--pale);border-color:var(--accent)}.steps{display:grid;gap:8px;margin:12px 0 0}.steps button{font-size:13px;display:flex;gap:12px;align-items:center}.steps button:disabled{cursor:default;opacity:.52}.steps button.current{border-color:var(--accent);background:var(--pale)}.stepnum{font-size:11px;min-width:20px;color:var(--muted)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;background:#f3f6f6;border:1px solid var(--line);padding:14px;border-radius:7px;max-height:460px;overflow:auto;margin:12px 0 0}summary{cursor:pointer;font-size:13px;color:var(--accent);font-weight:600}select{max-width:100%;width:100%;padding:10px;border:1px solid var(--line);border-radius:7px;background:white;color:var(--ink)}.sectionhead{display:flex;align-items:center;justify-content:space-between;gap:16px}.sectionhead button{font-size:12px;padding:6px 10px}.log{padding-left:20px;font-size:13px;color:var(--muted);max-height:130px;overflow:auto}.log li{padding:3px 0}.metrics{display:flex;gap:22px;flex-wrap:wrap;margin:12px 0 18px}.metric strong{display:block;font-size:24px;line-height:1.2}.metric span{font-size:12px;color:var(--muted)}.foot{margin-top:16px;color:var(--muted);font-size:12px}#last-event{padding:10px 12px;border-radius:7px;background:#f4f6f5;margin:12px 0;font-size:13px;min-height:60px}@media(max-width:780px){main{padding:26px 16px 50px}.grid{grid-template-columns:1fr}.card{padding:18px}.state{gap:0 12px}}
</style></head><body><main>
<div class="eyebrow">Decision #9 · throwaway prototype</div>
<h1>When can a stopped scope authorize takeover?</h1>
<p class="intro">Explore the conditions for admitting a replacement writer. Parent exit, an accepted interrupt, local emptiness, and a safe checkpoint answer different questions.</p>
<div class="notice"><strong>Two kinds of evidence.</strong> The controls below run a pure, in-memory illustration. The recorded evidence at the bottom comes from actual local probes and separately labeled protocol examples. Clicking never controls a process or changes a repository.</div>
<div class="grid"><div>
<section class="card" aria-labelledby="state-title"><div class="sectionhead"><h2 id="state-title">Current state</h2><span class="pill">Illustrative model</span></div>
<div id="status" class="status" aria-live="polite"></div><p id="explanation" class="explanation"></p><dl id="state" class="state"></dl>
<p id="last-event" aria-live="polite"></p><details><summary>Complete model payload</summary><pre id="raw-state"></pre></details></section>
<section class="card"><div class="sectionhead"><h2>Free play</h2><button id="reset">Reset model</button></div><p class="small">Actions are always available. A rejected action explains which condition is missing. The initial coverage assumption is trusted, cooperative local tools.</p><div id="actions" class="actions"></div><ol id="history" class="log"></ol></section>
</div><div>
<section class="card"><h2>Guided walkthroughs</h2><div id="tabs" class="tabs" role="tablist" aria-label="Walkthroughs"></div><h3 id="scenario-title"></h3><p id="scenario-description" class="small"></p><div id="steps" class="steps"></div><p class="foot">Selecting a walkthrough resets the model. Free play ends the guided step sequence.</p></section>
<section class="card"><h2>What the model asks for</h2><p class="small">A replacement needs a receipt for the exact current invocation, closed admission, observed empty payload, complete writer coverage, a verified checkpoint, and reconciled effects.</p><p class="small">An empty local scope does not settle a remote action or contain a writer created outside that scope. A receipt from an older invocation cannot authorize stopping a replacement.</p></section>
</div></div>
<section class="card"><div class="sectionhead"><h2>Recorded evidence</h2><span class="pill">Embedded snapshots</span></div><p class="small">Inspect the full source payload. Native observations, synthetic fixtures, and modeled assertions remain separate. These are snapshots from one environment, not a production guarantee.</p><div id="metrics" class="metrics"></div><label for="evidence-choice" class="small">Evidence file</label><select id="evidence-choice"></select><p id="evidence-note" class="foot"></p><pre id="evidence-json" tabindex="0"></pre></section>
<p class="foot">Self-contained HTML · no dependencies · no persistence · generated by build-viewer.py</p>
</main><script id="embedded-evidence" type="application/json">__EVIDENCE__</script>
<script>
// Pure illustrative reducer. It neither reads empirical evidence nor performs IO.
const Model = (() => {
 const initial=()=>({generation:1,invocation:'invocation-1',parentAlive:true,interruptAccepted:false,admissionClosed:false,payloadEmpty:false,completeCoverage:true,checkpointVerified:false,effectsReconciled:false,receipt:null,previousReceipt:null,lastEvent:'Explore a walkthrough, or apply actions in any order.',history:[]});
 const blockers=s=>{const b=[];if(!s.admissionClosed)b.push('admission is still open');if(!s.payloadEmpty)b.push('payload emptiness is unproved');if(!s.completeCoverage)b.push('writer coverage is incomplete');if(!s.receipt||s.receipt.invocation!==s.invocation)b.push('no receipt for this exact invocation');if(!s.checkpointVerified)b.push('checkpoint is not verified');if(!s.effectsReconciled)b.push('effects remain unknown');return b};
 const reduce=(old,action)=>{const s=structuredClone(old);let msg='';switch(action){
 case 'parent':s.parentAlive=false;msg='Parent exited. Descendant writers may still be running.';break;
 case 'interrupt':s.interruptAccepted=true;msg='Interrupt accepted. Acknowledgment supplies no emptiness proof.';break;
 case 'close':s.admissionClosed=true;msg='Admission closed for the current invocation in this model.';break;
 case 'empty':s.payloadEmpty=true;s.parentAlive=false;s.receipt={invocation:s.invocation,payloadPopulated:0,observation:'illustrative',coverage:s.completeCoverage?'complete-assumption':'incomplete'};msg='Payload empty observation recorded for '+s.invocation+'. Coverage and remote effects are separate.';break;
 case 'coverage':s.completeCoverage=false;msg='A writer may exist outside this scope. Local emptiness cannot authorize takeover.';break;
 case 'checkpoint':s.checkpointVerified=true;msg='Checkpoint verified in the model. It does not resolve unknown effects.';break;
 case 'effects':s.effectsReconciled=true;msg='Effects reconciled in the model. Other admission conditions still apply.';break;
 case 'admit':{const missing=blockers(s);if(missing.length){msg='Fresh admission rejected: '+missing.join('; ')+'.';break;}const receipt=s.receipt;const generation=s.generation+1;Object.assign(s,initial(),{generation,invocation:'invocation-'+generation,previousReceipt:receipt});msg='Replacement admitted as '+s.invocation+'. Its writers need their own future receipt.';break;}
 case 'old':{const receipt=s.previousReceipt;if(!receipt){msg='No previous receipt exists. Complete a replacement first.';break;}if(receipt.invocation!==s.invocation){msg='Old receipt rejected: '+receipt.invocation+' cannot stop '+s.invocation+'. Replacement remains active.';break;}msg='No stale identity was present.';break;}
 default:msg='Unknown action rejected.';
 }s.lastEvent=msg;s.history=[...old.history,{action,message:msg,invocation:s.invocation}];return s;};
 const describe=s=>{if(!s.completeCoverage)return ['Blocked · incomplete writer coverage','An empty local payload cannot account for writers outside the owned scope.'];if(!s.payloadEmpty)return ['Writer may still be active','Parent state and interrupt acknowledgment cannot prove that every local writer stopped.'];if(!s.admissionClosed)return ['Blocked · admission still open','A stable empty observation needs closure of further admission.'];if(!s.effectsReconciled)return ['Paused · external effects unknown','Local writers stopped, but an in-flight effect still needs reconciliation before takeover.'];if(!s.checkpointVerified)return ['Paused · checkpoint not verified','Verify the checkpoint before admitting fresh work.'];if(blockers(s).length)return ['Blocked · receipt identity','The receipt must name the exact current invocation.'];return ['Ready for fresh admission','All conditions in this illustrative model are satisfied.'];};
 return {initial,reduce,describe,blockers};
})();

const actionList=[['parent','Parent dies'],['interrupt','Interrupt accepted'],['close','Close admission'],['empty','Observe payload empty'],['coverage','Mark coverage incomplete'],['checkpoint','Verify checkpoint'],['effects','Reconcile effects'],['admit','Request fresh admission'],['old','Apply old receipt']];
const scenarios=[
 {title:'Parent exit',heading:'Parent exit is insufficient',description:'The parent disappears and interruption is acknowledged. Try admitting a replacement while descendant emptiness remains unknown.',steps:['parent','interrupt','admit']},
 {title:'Unknown effect',heading:'Stopped payload, unknown effect',description:'Close admission and observe local emptiness. A verified checkpoint still cannot settle an in-flight effect. Reconcile it before admitting fresh work.',steps:['close','empty','checkpoint','admit','effects','admit']},
 {title:'Old receipt',heading:'An old receipt cannot stop a replacement',description:'Reach a valid modeled checkpoint and admit a new invocation. Applying the previous receipt must leave the replacement running.',steps:['close','empty','checkpoint','effects','admit','old']}
];
let state=Model.initial(), activeScenario=0, step=0;
const $=id=>document.getElementById(id);
const label=id=>actionList.find(a=>a[0]===id)[1];
function dispatch(action,guided=false){state=Model.reduce(state,action);if(guided)step++;else activeScenario=null;render();}
function render(){
 const [title,explanation]=Model.describe(state);$('status').textContent=title;$('explanation').textContent=explanation;$('last-event').textContent=state.lastEvent;
 const fields=[['Current invocation',state.invocation],['Parent',state.parentAlive?'Alive':'Exited'],['Interrupt',state.interruptAccepted?'Accepted':'Not acknowledged'],['Admission',state.admissionClosed?'Closed':'Open'],['Payload',state.payloadEmpty?'Observed empty':'Emptiness unknown'],['Writer coverage',state.completeCoverage?'Complete · assumed':'Incomplete'],['Checkpoint',state.checkpointVerified?'Verified':'Unverified'],['Effects',state.effectsReconciled?'Reconciled':'Unknown'],['Receipt identity',state.receipt?.invocation||'None'],['Previous receipt',state.previousReceipt?.invocation||'None']];
 $('state').replaceChildren(...fields.map(([name,value])=>{const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;row.append(dt,dd);return row}));
 $('raw-state').textContent=JSON.stringify(state,null,2);$('history').replaceChildren(...state.history.slice(-6).map(event=>{const li=document.createElement('li');li.textContent=event.message;return li}));
 [...$('tabs').children].forEach((button,index)=>button.setAttribute('aria-selected',String(index===activeScenario)));
 if(activeScenario!==null){const scenario=scenarios[activeScenario];$('scenario-title').textContent=scenario.heading;$('scenario-description').textContent=scenario.description;$('steps').replaceChildren(...scenario.steps.map((action,index)=>{const button=document.createElement('button'),number=document.createElement('span');number.className='stepnum';number.textContent=index<step?'✓':String(index+1).padStart(2,'0');button.append(number,document.createTextNode(label(action)));button.disabled=index!==step;button.classList.toggle('current',index===step);button.addEventListener('click',()=>dispatch(action,true));return button}));if(step===scenario.steps.length){const p=document.createElement('p');p.className='small';p.textContent='Walkthrough complete. Inspect the state or choose another tab.';$('steps').append(p)}}
 else{$('scenario-title').textContent='Free play';$('scenario-description').textContent='Choose a walkthrough tab to reset to a known starting state.';$('steps').replaceChildren()}
}
actionList.forEach(([action,title])=>{const button=document.createElement('button');button.textContent=title;if(action==='admit')button.className='primary';button.addEventListener('click',()=>dispatch(action));$('actions').append(button)});
scenarios.forEach((scenario,index)=>{const button=document.createElement('button');button.textContent=scenario.title;button.setAttribute('role','tab');button.addEventListener('click',()=>{activeScenario=index;step=0;state=Model.initial();render()});$('tabs').append(button)});
$('reset').addEventListener('click',()=>{state=Model.initial();activeScenario=null;step=0;render()});
const evidence=JSON.parse($('embedded-evidence').textContent);
evidence.forEach((entry,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=entry.source;$('evidence-choice').append(option)});
const native=evidence.filter(e=>e.source.startsWith('native/')&&e.source.endsWith('/results.json'));
const fixture=evidence.find(e=>e.source==='fixtures/run-20260912-final/evidence.json');
const metrics=[[''+native.length,'native probe records'],[fixture?`${fixture.payload.empirical_pass_count}/${fixture.payload.empirical_case_count}`:'—','empirical fixture cases'],[fixture?''+fixture.payload.modeled_guard_count:'—','modeled fixture guards']];
$('metrics').replaceChildren(...metrics.map(([value,name])=>{const d=document.createElement('div'),n=document.createElement('strong'),l=document.createElement('span');d.className='metric';n.textContent=value;l.textContent=name;d.append(n,l);return d}));
function showEvidence(){const item=evidence[Number($('evidence-choice').value)];if(!item){$('evidence-json').textContent='No evidence files present when generated.';return}$('evidence-json').textContent=JSON.stringify(item.payload,null,2);$('evidence-note').textContent=item.source.startsWith('native/')?'Native local observation. Read claimScope and raw stop evidence before interpreting the status.':item.source.startsWith('fixtures/')?'Fixture observations and modeled guard examples are labeled separately in this payload.':'Protocol model evidence. It is not an empirical process-containment result.';}
$('evidence-choice').addEventListener('change',showEvidence);showEvidence();render();
</script></body></html>'''

target = ROOT / 'writer-supervision-lab.html'
target.write_text(HTML.replace('__EVIDENCE__', data))
print(f'{target}: embedded {len(evidence)} evidence files ({target.stat().st_size} bytes)')
