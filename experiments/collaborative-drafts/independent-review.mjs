import * as Y from 'yjs';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {initial,source,newRun,execution,encode,content,decode,hash,errors} from './model.mjs';
const results={modelHash:hash(readFileSync(new URL('./model.mjs',import.meta.url),'utf8')),at:new Date().toISOString(),probes:{}};
function event(seq){return {id:`spec:${seq}`,source:'spec',seq,revision:`revision-${seq}`,digest:`digest-${seq}`};}
function decision(s,op){return execution(s,op,{version:s.version,revision:s.pending?.revision,sourceVersion:s.pending?.seq,admission:{id:`successor-${s.version}`,units:1,checkpoint:'verified'}});}
{
 const s=newRun('spec');execution(s,'observe',{event:event(1)});const first=decision(s,'adopt');const afterFirst=structuredClone(s);const secondObservation=execution(s,'observe',{event:event(2)});const second=decision(s,'retain');
 results.probes.supersededReopen={first,afterFirstStatus:afterFirst.status,secondObservation,second,finalStatus:s.status,violation:afterFirst.status==='superseded'&&s.status==='running'};
}
{
 const s=newRun('spec');execution(s,'observe',{event:event(1)});decision(s,'adopt');const first=structuredClone(s.successor);execution(s,'observe',{event:event(2)});const second=decision(s,'adopt');
 results.probes.successorOverwrite={first,second,final:s.successor,violation:JSON.stringify(first)!==JSON.stringify(s.successor)};
}
{
 const d=new Y.Doc();let updates=[];d.on('update',u=>updates.push(u));d.getText('markdown').insert(0,'abc');const insertion=Buffer.from(updates.at(-1)).toString('base64');d.getText('markdown').delete(0,3);const deletion=Buffer.from(updates.at(-1)).toString('base64');
 let s=initial();const receipt=source(s,'edit',{id:'delete-first',update:deletion},'alice');const before=source(s,'preview',{},'alice');s=JSON.parse(JSON.stringify(s));const restart=source(s,'preview',{},'alice');source(s,'edit',{id:'insert-later',update:insertion},'alice');const after=source(s,'preview',{},'alice');
 results.probes.pendingDeletion={receipt,before,restart,after,pass:receipt.integrated===false&&before.status==='dependencies_missing'&&restart.status==='dependencies_missing'&&after.content?.markdown===''};
}
{
 const cases=[{markdown:'',nodes:{a:{kind:'call',action:{unresolved:'alias'}}},order:['a']},{markdown:'',nodes:{a:{kind:'call',action:'test',unknownBehavior:'execute-shell'}},order:['a']},{markdown:'',nodes:{a:{kind:'call',action:'test'},b:{kind:'call',action:'build'}},order:['a','a']}];
 results.probes.graphValidation=cases.map(c=>({content:c,errors:errors(c)}));
}
{
 function make(owner){const s=initial();const p=source(s,'preview',{},'alice');source(s,'submit',{owner,doc:'same-id',token:p.token,expectedHead:0},'alice');return {owner,event:s.outbox[0]};}
 const knowledge=make('knowledge'),catalog=make('catalog');
 results.probes.ownerIdentity={knowledge,catalog,collision:JSON.stringify(knowledge.event)===JSON.stringify(catalog.event)};
}
{
 const s=newRun('spec');const approval=execution(s,'approve',{wait:s.wait.id,revision:s.pinned,version:s.version});execution(s,'observe',{event:event(1)});const retained=decision(s,'retain');
 results.probes.retainAcceptedGate={approval,retained,wait:s.wait,approvals:s.approvals,potentialExtraApproval:s.wait.valid===true&&s.approvals.length===1};
}
const checks={
 supersededCannotReopen:results.probes.supersededReopen.violation===false,
 successorCannotBeOverwritten:results.probes.successorOverwrite.violation===false,
 pendingDeletionSurvives:results.probes.pendingDeletion.pass===true,
 nonStringActionRejected:results.probes.graphValidation[0].errors.length>0,
 unknownBehaviorRejected:results.probes.graphValidation[1].errors.length>0,
 duplicateAndOrphanRejected:results.probes.graphValidation[2].errors.includes('duplicate_node')&&results.probes.graphValidation[2].errors.includes('orphan_node'),
 ownerIdentityDistinct:results.probes.ownerIdentity.collision===false,
 retainKeepsResolvedGate:results.probes.retainAcceptedGate.potentialExtraApproval===false&&results.probes.retainAcceptedGate.wait.resolved===true
};
for(const [name,passed] of Object.entries(checks))assert.equal(passed,true,name);
results.checks=checks;results.finalModelHash=hash(readFileSync(new URL('./model.mjs',import.meta.url),'utf8'));assert.equal(results.finalModelHash,results.modelHash,'model stable during independent probe');
writeFileSync(new URL('./independent-review-results.json',import.meta.url),JSON.stringify(results,null,2));process.stdout.write(JSON.stringify(results,null,2)+'\n');
