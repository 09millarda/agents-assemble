// THROWAWAY decision #12. Reduced protocol, not production schema or editor.
import * as Y from 'yjs';
import {createHash} from 'node:crypto';
export const canonical = x => JSON.stringify(normal(x));
function normal(x) { return Array.isArray(x) ? x.map(normal) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,normal(x[k])])) : x; }
export const hash = x => createHash('sha256').update(typeof x==='string'?x:canonical(x)).digest('hex');
export const encode = d => Buffer.from(Y.encodeStateAsUpdate(d)).toString('base64');
export function decode(s) {const d=new Y.Doc(); if(s) Y.applyUpdate(d,Buffer.from(s,'base64')); return d;}
export const content = d => ({markdown:d.getText('markdown').toString(),nodes:d.getMap('nodes').toJSON(),order:d.getArray('order').toArray()});
export const initial = () => ({seq:0,head:0,update:null,history:[],snapshots:{},revisions:[],proposals:[],outbox:[]});
// Intentionally only a reduced flat sequence/call publication fixture.
export function errors(c) {
 const e=[]; if(new Set(c.order).size!==c.order.length)e.push('duplicate_node');
 for(const id of c.order){const n=c.nodes[id];if(!n)e.push('dangling_node');else if(n.kind!=='call'||typeof n.action!=='string'||!n.action||Object.keys(n).some(k=>!['kind','action'].includes(k)))e.push('unsupported_or_incomplete_call');}
 if(Object.keys(c.nodes).some(id=>!c.order.includes(id)))e.push('orphan_node');
 return e;
}
export function source(s, op, p, actor) {
 if(op==='read') return {seq:s.seq,head:s.head,update:s.update,content:content(decode(s.update))};
 if(op==='edit'||op==='agent'){
  if(op==='agent'&&(p.baseSeq!==s.seq||p.baseHash!==hash(content(decode(s.update))))){
   const proposal={id:p.id,actor,baseSeq:p.baseSeq,baseHash:p.baseHash,update:p.update,status:'conflict'};s.proposals.push(proposal);return proposal;
  }
  const d=decode(s.update); Y.applyUpdate(d,Buffer.from(p.update,'base64'));
  // Out-of-order Yjs updates may be pending dependencies; durable receipt is not integration.
  const pending=!!(d.store.pendingStructs||d.store.pendingDs); s.update=encode(d);s.seq++;
  const receipt={id:p.id,actor,seq:s.seq,update:p.update,integrated:!pending,hash:hash(content(d))};
  s.history.push(receipt);return receipt;
 }
 if(op==='preview'){
  const d=decode(s.update);if(d.store.pendingStructs||d.store.pendingDs)return {status:'dependencies_missing'};
  const c=content(d), digest=hash(c),token=`${s.seq}:${digest}`;
  const snapshot={token,seq:s.seq,digest,content:c,update:s.update,validation:errors(c)};
  s.snapshots[token]=snapshot;return snapshot;
 }
 if(op==='submit'){
  const snap=s.snapshots[p.token];if(!snap)return {status:'unknown_snapshot'};
  if(snap.validation.length)return {status:'invalid_graph',errors:snap.validation};
  if(p.expectedHead!==s.head)return {status:'head_conflict',head:s.head};
  const rev={revision:`revision-${++s.head}`,sourceVersion:s.head,snapshot:snap.token,digest:snap.digest,content:snap.content,actor};
  s.revisions.push(rev);s.outbox.push({id:`${p.owner}/${p.doc}:${s.head}`,source:`${p.owner}/${p.doc}`,seq:s.head,revision:rev.revision,digest:rev.digest});
  return {status:'submitted',...rev};
 }
 throw Error('unknown source operation');
}
export const newRun = sourceId => ({source:sourceId,version:0,pinned:'baseline',seen:0,events:{},pending:null,gap:false,status:'running',wait:{id:'wait-0',revision:'baseline',valid:true,resolved:false},approvals:[],history:[],successor:null,obligations:{writer:false,effects:false,checkpoint:false},budget:2});
export function execution(s,op,p){
 if(op==='read')return s;
 if(s.status==='superseded')return {status:'superseded'};
 if(op==='observe'){
  const e=p.event;if(e.source!==s.source)return {status:'wrong_source'};
  const prev=s.events[e.seq];if(prev)return {status:canonical(prev)===canonical(e)?'duplicate':'event_conflict'};
  if(Object.values(s.events).some(x=>x.id===e.id))return {status:'event_identity_conflict'};
  s.events[e.seq]=e;s.version++;s.wait.valid=false;s.status='replan_required';
  while(s.events[s.seen+1]){s.seen++;s.pending=s.events[s.seen];s.history.push(s.pending);}
  s.gap=Object.keys(s.events).some(k=>Number(k)>s.seen);return {status:s.gap?'gap':'observed',version:s.version};
 }
 if(op==='approve'){
  if(!s.wait.valid||p.wait!==s.wait.id||p.revision!==s.pinned||p.version!==s.version||s.status!=='running'||s.gap)return {status:'stale_approval'};
  s.approvals.push({wait:p.wait,revision:p.revision});s.wait.valid=false;s.wait.resolved=true;return {status:'approved'};
 }
 if(op==='gates'){s.obligations={...s.obligations,...p.obligations};s.version++;return {status:'recorded_fixture_evidence'};}
 if(op==='retain'||op==='adopt'){
  if(s.gap)return {status:'event_gap'};
  if(p.version!==s.version||!s.pending||p.revision!==s.pending.revision||p.sourceVersion!==s.pending.seq)return {status:'stale_decision'};
  if(Object.values(s.obligations).some(Boolean))return {status:'recovery_blocked'};
  if(op==='adopt'){
   if(!p.admission||p.admission.units<1||p.admission.units>s.budget||!p.admission.checkpoint)return {status:'admission_required'};
   s.successor={id:p.admission.id,pinned:s.pending.revision,start:'entry',approvals:[],consumed:0,grant:p.admission.units,checkpoint:p.admission.checkpoint,delivery:'fixture-delivery'};
   s.status='superseded';s.wait.valid=false;
  }else {s.status='running';if(!s.wait.resolved)s.wait={id:`wait-${s.version+1}`,revision:s.pinned,valid:true,resolved:false};}
  s.pending=null;s.version++;return {status:op==='adopt'?'adopted':'retained',version:s.version,successor:s.successor};
 }
 throw Error('unknown execution operation');
}
