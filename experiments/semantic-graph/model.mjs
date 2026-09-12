// THROWAWAY #16. Real Yjs replicas; controlled in-memory intent/acceptance records.
import * as Y from 'yjs';
import './reference/authoring.cjs';
export const A = globalThis.Authoring;
function jsonData(v,seen=new Set()) {
  if(v===null||['string','boolean'].includes(typeof v))return;
  if(typeof v==='number'&&Number.isFinite(v))return;
  if(typeof v!=='object'||seen.has(v))throw Error('non_json_data');
  if(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error('non_json_data');
  if(Array.isArray(v)&&Object.keys(v).length!==v.length)throw Error('non_json_data');
  const next=new Set(seen);next.add(v);for(const x of Object.values(v))jsonData(x,next);
}
export const copy = v => {jsonData(v);return JSON.parse(JSON.stringify(v));};
export const canonical = A.canonical;
const structural = new Set(['children','branches','body','cases','otherwise']);
const shared = v => v && typeof v === 'object' && !Array.isArray(v)
  ? new Y.Map(Object.entries(v).map(([k,x])=>[k,shared(x)])) : copy(v);
const raw = v => v instanceof Y.Map ? Object.fromEntries([...v].map(([k,x])=>[k,raw(x)])) : v instanceof Y.Array ? v.toArray().map(raw) : copy(v);
const overlap = (a,b) => a===b || a.startsWith(b+'/') || b.startsWith(a+'/');
export function tables(d) { return Object.fromEntries(['meta','nodes','slots','dead','ops','placements'].map(k=>[k,d.getMap(k)])); }
export function create(definition, profile='arrays') {
  const d = new Y.Doc(); const t=tables(d); let n=0;
  d.transact(()=>{
    const {body,...header}=copy(definition); t.meta.set('header',shared(header));t.meta.set('profile',profile);
    function visit(node,kind='node',parent=null,index=0) {
      const eid='e'+(++n), fields=copy(node);
      if(kind==='case')delete fields.then; else for(const k of structural)delete fields[k];
      t.nodes.set(eid,new Y.Map([['kind',kind],['fields',shared(fields)]]));
      if(profile==='parent' && parent)t.placements.set(eid,{slot:parent,rank:index});
      function slot(k,items,childKind='node'){
        const sk=eid+'|'+k, ids=items.map((x,i)=>visit(x,childKind,sk,i));
        t.slots.set(sk,Y.Array.from(profile==='arrays'?ids:[]));
      }
      if(kind==='case')slot('then',[node.then]);
      else {
        for(const k of ['children','branches'])if(Object.hasOwn(node,k))slot(k,node[k]);
        for(const k of ['body','otherwise'])if(Object.hasOwn(node,k))slot(k,[node[k]]);
        if(Object.hasOwn(node,'cases'))slot('cases',node.cases,'case');
      }
      return eid;
    }
    t.meta.set('root',visit(body));
  });
  return d;
}
export function fork(d){const r=new Y.Doc();Y.applyUpdate(r,Y.encodeStateAsUpdate(d));return r;}
export function merge(a,b){const ua=Y.encodeStateAsUpdate(a),ub=Y.encodeStateAsUpdate(b);Y.applyUpdate(a,ub);Y.applyUpdate(b,ua);}
export function slotIds(d,key){const t=tables(d);return t.meta.get('profile')==='arrays' ? t.slots.get(key)?.toArray()||[] : [...t.placements].filter(([,p])=>p.slot===key).sort((a,b)=>a[1].rank-b[1].rank||a[0].localeCompare(b[0])).map(([id])=>id);}
export function locate(d,authorId){return [...tables(d).nodes].filter(([,v])=>v.get('fields').get('id')===authorId).map(([id])=>id);}
export function state(d){const t=tables(d);return Object.fromEntries(Object.entries(t).map(([k,v])=>[k,raw(v)]));}
function descendants(d,id,seen=new Set()){if(seen.has(id))return seen;seen.add(id);for(const k of tables(d).slots.keys())if(k.startsWith(id+'|'))for(const child of slotIds(d,k))descendants(d,child,seen);return seen;}
function currentLocations(d,id){return [...tables(d).slots.keys()].filter(k=>slotIds(d,k).includes(id));}
function live(d,id){const t=tables(d);if(!t.nodes.has(id)||t.dead.get(id))throw Error('unknown_or_deleted_entity');}
function destination(d,slot,index,omit){const t=tables(d);if(!t.slots.has(slot))throw Error('unknown_target_slot');live(d,slot.split('|')[0]);const ids=slotIds(d,slot).filter(id=>id!==omit);if(!Number.isSafeInteger(index)||index<0||index>ids.length)throw Error('invalid_target_index');}
function detach(d,id){const t=tables(d);if(t.meta.get('profile')==='parent'){t.placements.delete(id);return;}for(const arr of t.slots.values())for(let i=arr.length-1;i>=0;i--)if(arr.get(i)===id)arr.delete(i,1);}
function place(d,id,slot,index){const t=tables(d);if(!t.slots.has(slot))throw Error('unknown target slot');if(t.meta.get('profile')==='arrays'){const arr=t.slots.get(slot);arr.insert(Math.min(index,arr.length),[id]);}else{
  const ids=slotIds(d,slot),prev=index? t.placements.get(ids[index-1])?.rank:undefined,next=t.placements.get(ids[index])?.rank;
  const rank=prev===undefined?(next===undefined?0:next-1):next===undefined?prev+1:(prev+next)/2;
  t.placements.set(id,{slot,rank});
}}
function fieldSet(fields,path,value){let at=fields;for(const key of path.slice(0,-1)){if(!(at.get(key) instanceof Y.Map))throw Error('field parent missing or atomic array; use structured replacement');at=at.get(key);}at.set(path.at(-1),shared(value));}
function intent(d,kind,targets,paths,details,fn){const t=tables(d);const seen=[...t.ops.keys()],id=`${d.clientID}:${seen.filter(x=>x.startsWith(d.clientID+':')).length+1}`;d.transact(()=>{fn();t.ops.set(id,{id,kind,targets,paths,details,seen});});return id;}
function editable(d){const v=inspect(d);if(v.diagnostics.some(x=>x.code.startsWith('unsupported_')||x.code==='unknown_behavioral_field'))throw Error('unsupported_edit_read_only');}
export function edit(d,eid,path,value){editable(d);if(!path.length||eid==='header'&&path[0]==='body'||eid!=='header'&&(structural.has(path[0])||path[0]==='then'))throw Error('structural_command_required');const fields=eid==='header'?tables(d).meta.get('header'):tables(d).nodes.get(eid).get('fields');return intent(d,'field',[eid],[eid+'/'+path.map(k=>k.replace(/~/g,'~0').replace(/\//g,'~1')).join('/')],{path,value:copy(value)},()=>fieldSet(fields,path,value));}
export function move(d,eid,slot,index){editable(d);live(d,eid);destination(d,slot,index,eid);const ids=slotIds(d,slot).filter(id=>id!==eid);const gap=`gap:${slot}:${ids[index-1]||'^'}:${ids[index]||'$'}`;return intent(d,'move',[eid,slot.split('|')[0]],[`placement:${eid}`,gap],{from:currentLocations(d,eid),slot,index},()=>{detach(d,eid);place(d,eid,slot,index);});}
export function duplicate(d,eid,slot,index){editable(d);live(d,eid);destination(d,slot,index);if(tables(d).meta.get('profile')==='parent')throw Error('unsupported_duplicate_placement');return intent(d,'duplicate',[eid],[`placement:${eid}`],{slot,index},()=>place(d,eid,slot,index));}
export function remove(d,eid){editable(d);live(d,eid);const ids=[...descendants(d,eid)];return intent(d,'delete',ids,ids.map(id=>'delete:'+id),{locations:currentLocations(d,eid)},()=>{detach(d,eid);for(const id of ids)tables(d).dead.set(id,true);});}
export function insert(d,slot,index,node){const t=tables(d),eid=`new-${d.clientID}-${t.ops.size+1}`;const ids=slotIds(d,slot),gap=`gap:${slot}:${ids[index-1]||'^'}:${ids[index]||'$'}`;if([...structural].some(k=>Object.hasOwn(node,k)))throw Error('probe insert supports leaf nodes; import preserves all nested kinds');
  editable(d);destination(d,slot,index);copy(node);
  intent(d,'insert',[eid,slot.split('|')[0]],[gap],{eid,slot,index,node},()=>{t.nodes.set(eid,new Y.Map([['kind','node'],['fields',shared(node)]]));place(d,eid,slot,index);});return eid;
}
export function conflicts(d){const ops=[...tables(d).ops.values()],out=[];for(let i=0;i<ops.length;i++)for(let j=i+1;j<ops.length;j++){
  const a=ops[i],b=ops[j];if(a.seen.includes(b.id)||b.seen.includes(a.id))continue;
  const same=a.paths.some(x=>b.paths.some(y=>overlap(x,y))),deleted=(a.kind==='delete'||b.kind==='delete')&&a.targets.some(x=>b.targets.includes(x));
  if(same||deleted){const resolved=ops.some(r=>r.kind==='resolve'&&r.seen.includes(a.id)&&r.seen.includes(b.id)&&r.details.pairs.some(p=>canonical([...p].sort())===canonical([a.id,b.id].sort())));if(!resolved)out.push({code:'unresolved_intent',operations:[a.id,b.id].sort(),a,b});}
}return out.sort((a,b)=>canonical(a.operations).localeCompare(canonical(b.operations)));}
// A resolution acknowledges exact observed conflicting operations, never future ones.
// The caller first applies deliberate repairs against the converged draft.
export function resolve(d){const pairs=conflicts(d).map(x=>x.operations);return intent(d,'resolve',[],[],{pairs},()=>{});}
export function materialize(d){const t=tables(d),issues=[],visits=new Map(),active=new Set();
  function visit(id,path){
    if(active.has(id)){issues.push({code:'cycle',id,path});return null;}
    visits.set(id,(visits.get(id)||0)+1);if(visits.get(id)>1){issues.push({code:'duplicate_placement',id,path});return null;}
    const rec=t.nodes.get(id);if(!rec||t.dead.get(id)){issues.push({code:'deleted_or_missing_node',id,path});return null;}
    active.add(id);const result=raw(rec.get('fields'));
    for(const k of Object.keys(result))if(structural.has(k)||k==='then')issues.push({code:'structural_field_collision',id,field:k});
    for(const key of [...t.slots.keys()].filter(k=>k.startsWith(id+'|'))){const k=key.split('|')[1],ids=slotIds(d,key);if(['body','otherwise','then'].includes(k)){if(ids.length!==1)issues.push({code:'single_slot_arity',id,slot:k,count:ids.length});result[k]=ids.length?visit(ids[0],path+'/'+k):null;}else result[k]=ids.map((child,i)=>visit(child,path+'/'+k+'/'+i));}
    active.delete(id);return result;
  }
  const header=raw(t.meta.get('header'));if(Object.hasOwn(header,'body'))issues.push({code:'structural_field_collision',id:'header',field:'body'});
  const definition={...header,body:visit(t.meta.get('root'),'body')};
  for(const id of t.nodes.keys())if(!t.dead.get(id)&&!visits.has(id))issues.push({code:'unplaced_node',id});
  for(const id of t.placements.keys())if(!t.nodes.has(id))issues.push({code:'unknown_placement',id});
  return {definition,issues};
}
export function inspect(d){const {definition,issues}=materialize(d);const diagnostics=[...issues,...conflicts(d)];let normalized=null;
  if(!issues.length)try{normalized=A.normalize(definition);constantBoundaries(normalized);}catch(e){diagnostics.push({code:e.code||'invalid_definition',message:e.message});}
  return {definition,normalized,diagnostics,publishable:diagnostics.length===0};
}
// Conservative addition to the inherited authoring fixture: check wholly known
// binding values against boundary schemas. Dynamic values still require runtime
// validation; this does not claim general JSON Schema subtyping.
function constantBoundaries(definition){
  function constant(b){if(!b)return false;if(Object.hasOwn(b,'literal'))return true;if(b.ref)return false;if(b.array)return b.array.every(constant);if(b.object)return Object.values(b.object).every(constant);return false;}
  function walk(n){if(n.type==='call'&&constant(n.with))A.validateValue(A.evaluateBinding(n.with,{}),A.actions[n.action].inputs);if(n.type==='end'&&constant(n.result))A.validateValue(A.evaluateBinding(n.result,{}),definition.outputs);for(const k of ['children','branches'])for(const x of n[k]||[])walk(x);for(const k of ['body','otherwise'])if(n[k])walk(n[k]);for(const c of n.cases||[])walk(c.then);}
  walk(definition.body);
}
export function freeze(d,store){const view=inspect(d);if(!view.publishable)throw Error('publication_blocked: '+view.diagnostics.map(x=>x.code).join(','));const candidate={profile:'semantic-graph-probe/1',normalization:'authoring-probe/1',bytes:canonical(view.normalized),operations:[...tables(d).ops.keys()].sort()};if(store){store.candidates??={};candidate.id='candidate-'+(Object.keys(store.candidates).length+1);store.candidates[candidate.id]=copy(candidate);}return candidate;}
export function publish(store,candidate,expectedHead,operation){const prior=store.verdicts[operation];const request=canonical({candidate,expectedHead});if(prior){if(prior.request!==request)throw Error('operation_conflict');return copy(prior.result);}let result;if(!store.candidates?.[candidate.id]||canonical(store.candidates[candidate.id])!==canonical(candidate))result={status:'candidate_conflict'};else if(expectedHead!==store.head)result={status:'head_conflict'};else{store.head++;store.revisions[store.head]=copy(store.candidates[candidate.id]);result={status:'published',revision:store.head};}store.verdicts[operation]={request,result};return copy(result);}
export function propose(run,store,revision,target){if(target!==run.lineage||!store.revisions[revision])throw Error('proposal_target');run.pending=copy(store.revisions[revision]);return run;}
export function generatedTS(definition){return `// Generated locally; emitted JSON is authoritative.\ntype JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };\nconst playbook: JSONValue = JSON.parse(${JSON.stringify(canonical(definition))});\nexport default playbook;\n`;}
export {Y};
