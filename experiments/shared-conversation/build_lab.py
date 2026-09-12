#!/usr/bin/env python3
"""Build a single offline, throwaway logic lab with complete recorded snapshots."""
from pathlib import Path
import json
R=Path(__file__).resolve().parent
html='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shared conversation · Decision lab</title>
<style>body{max-width:1100px;margin:40px auto;padding:0 24px;background:#f6f7fa;color:#182334;font:16px/1.55 system-ui}h1{font-size:36px;letter-spacing:-1px;margin-bottom:4px}h2{font-size:22px}p{max-width:850px}small,.muted{color:#536071}button,select{font:inherit;border:1px solid #c3cada;border-radius:8px;padding:9px 14px;background:white;color:#182334;margin:4px;cursor:pointer}button:hover{border-color:#325cdf}button:disabled{opacity:.5}section{background:white;border:1px solid #dfe3ec;border-radius:14px;padding:22px;margin:22px 0}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{background:#eef2fd;padding:15px;border-radius:10px}.value{display:block;font-weight:700;font-size:21px}pre{max-height:480px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#152135;color:#e0e8fa;border-radius:10px;padding:18px;font-size:12px}#notice{padding:14px;background:#eef2fd;border-left:4px solid #325cdf}label{font-weight:600}summary{cursor:pointer}.tag{letter-spacing:2px;font-size:12px;color:#325cdf;font-weight:700}#steps{padding-top:12px} @media(max-width:750px){.cards{grid-template-columns:repeat(2,1fr)}h1{font-size:29px}}</style>
<p class="tag">AGENTS ASSEMBLE / WAYFINDER #13</p><h1>Did Codex receive the instruction?</h1><p>Explore the difference between queued input, known delivery and an uncertain send. Interruption has its own path; it never proves every writer stopped. This is a disposable decision lab, not the application.</p>
<section><h2>Explore delivery</h2><div class="cards"><div class="card">Input<span class="value" id="input"></span></div><div class="card">Native calls<span class="value" id="calls"></span></div><div class="card">Interrupt<span class="value" id="stop"></span></div><div class="card">Recovery<span class="value">Needs evidence</span></div></div><p id="notice"></p><div id="actions"></div><details><summary>Complete current state and transition history</summary><pre id="state"></pre></details></section>
<section><h2>Guided walkthroughs</h2><div id="walks"></div><p id="description"></p><div id="steps"></div></section>
<section><h2>Recorded evidence</h2><p>Native observations and durable fixture results are separate. Select a record to inspect the complete retained payload. The fixture has modeled authorization and native behavior; the actual Codex runs used the existing local login.</p><label for="records">Evidence record</label><select id="records"></select><pre id="record"></pre></section>
<p class="muted">Contract: one fresh dispatch claim, exact turn binding, no blind resend. Output gaps and approval/recovery obligations remain explicit.</p>
<script>
const evidence=__EVIDENCE__;
const init=()=>({input:'absent',calls:0,interrupt:'absent',continuation:true,writerStopped:false,effectsSettled:false,newAdmission:false,history:[]});
function transition(old,a){const s=structuredClone(old);let note='';
if(a==='Queue input'){if(s.input==='absent'){s.input='queued';note='Service accepted one immutable input.'}else note='Same input identity returns its existing status.'}
if(a==='Receive on daemon'){if(s.input==='queued'){s.input='received';note='Daemon journal persisted the input.'}else note='No new receipt transition.'}
if(a==='Send once'){if(s.input==='received'&&s.continuation){s.input='sending';s.calls++;note='Fresh exclusive dispatch claim used once; response not yet durable.'}else note='No fresh dispatch claim; nothing was sent.'}
if(a==='Record native success'){if(s.input==='sending'){s.input='delivered';note='Native acceptance retained; instruction completion is still unknown.'}else note='No correlated response to retain.'}
if(a==='Crash and recover'){if(s.input==='sending')s.input='unknown';note='Unfinished sends stay unknown. A restart grants no permission to resend.'}
if(a==='Retry input')note=s.input==='unknown'?'Delivery is uncertain. Retry returns that state and sends nothing.':'Existing identity returns its current state and sends nothing.';
if(a==='Request interrupt'){s.interrupt='queued';s.continuation=false;note='Reserved control path accepted stop; ordinary input is now gated.'}
if(a==='Observe interrupt acknowledgment'){if(s.interrupt==='queued')s.interrupt='acknowledged';note='Native acknowledgment does not establish stopped writers or settled effects.'}
if(a==='Try successor'){note='New work remains gated on writer/effect evidence and fresh admission.'}
s.history.push({action:a,note,input:s.input,calls:s.calls});return s;}
let state=init();const actions=['Queue input','Receive on daemon','Send once','Record native success','Crash and recover','Retry input','Request interrupt','Observe interrupt acknowledgment','Try successor'];
function render(){document.querySelector('#input').textContent=state.input;document.querySelector('#calls').textContent=state.calls;document.querySelector('#stop').textContent=state.interrupt;document.querySelector('#notice').textContent=state.history.at(-1)?.note||'Begin by queuing an instruction.';document.querySelector('#state').textContent=JSON.stringify(state,null,2)}
function act(a){state=transition(state,a);render()}
for(const a of ['Reset',...actions]){let b=document.createElement('button');b.textContent=a;b.onclick=()=>{if(a==='Reset'){state=init();render()}else act(a)};document.querySelector('#actions').append(b)}
const walks=[{title:'Known delivery',text:'The durable native receipt lets retry return the prior outcome.',steps:['Queue input','Receive on daemon','Send once','Record native success','Retry input']},{title:'Lost acknowledgment',text:'The native call may have happened. Restart preserves uncertainty and retry never adds a second call.',steps:['Queue input','Receive on daemon','Send once','Crash and recover','Retry input']},{title:'Interrupt uncertain work',text:'Stop remains available while input is uncertain. Its acknowledgment never grants a successor.',steps:['Queue input','Receive on daemon','Send once','Crash and recover','Request interrupt','Observe interrupt acknowledgment','Try successor']}];
function walk(w){state=init();render();document.querySelector('#description').textContent=w.text;const box=document.querySelector('#steps');box.replaceChildren();w.steps.forEach((a,i)=>{let b=document.createElement('button');b.textContent=(i+1)+'. '+a;b.disabled=i!==0;b.onclick=()=>{act(a);b.disabled=true;if(b.nextElementSibling)b.nextElementSibling.disabled=false};box.append(b)})}
for(const w of walks){let b=document.createElement('button');b.textContent=w.title;b.onclick=()=>walk(w);document.querySelector('#walks').append(b)}
const records=document.querySelector('#records');evidence.forEach((r,i)=>{const o=document.createElement('option');o.value=i;o.textContent=r.name;records.append(o)});records.onchange=()=>{document.querySelector('#record').textContent=JSON.stringify(evidence[Number(records.value)].value,null,2)};records.onchange();walk(walks[0]);
</script></html>'''
records=[]
for file,name in [('evidence.json','Durable fixture'),('independent-final-results.json','Independent repaired review'),('native/results.json','Native ephemeral probe'),('native/persistent-results.json','Native persistent probe'),('native/audit-results.json','Native archive audit')]:
 r=json.loads((R/file).read_text());records.append({'name':name,'value':r})
 if file=='evidence.json':
  records.extend({'name':'Scenario: '+x['name'],'value':x} for x in r['results'])
(R/'conversation-lab.html').write_text(html.replace('__EVIDENCE__',json.dumps(records).replace('</','<\\/')))
print('Built offline conversation-lab.html')
