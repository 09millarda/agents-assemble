/* THROWAWAY decision #6 model. JSON snapshots are a simulated durable boundary, not a database. */
globalThis.Conformance = (() => {
  const copy = x => JSON.parse(JSON.stringify(x));
  const canonical = x => JSON.stringify(x, (_,v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
  const fail = (code, details='') => { throw Object.assign(new Error(code+': '+details), {code}); };
  const eq = (a,b) => canonical(a) === canonical(b);
  const artifact = (id,revision='1') => ({id,revision,mediaType:'text/markdown',digest:'mock:'+id+':'+revision});
  const checkpoint = (id='base') => ({id,commit:'commit-'+id});
  function binding(b, env) {
    if ('literal' in b) return copy(b.literal);
    if ('object' in b) return Object.fromEntries(Object.entries(b.object).map(([k,v])=>[k,binding(v,env)]));
    if ('array' in b) return b.array.map(v=>binding(v,env));
    if ('ref' in b) {
      const {source,pointer}=b.ref;
      if (!Object.hasOwn(env,source)) fail('binding_error',source);
      let value=env[source];
      if (pointer !== '') for (const part of pointer.slice(1).split('/')) {
        const key=part.replace(/~1/g,'/').replace(/~0/g,'~');
        if (value===null || typeof value!=='object' || !Object.hasOwn(value,key)) fail('binding_error',pointer);
        value=value[key];
      }
      return copy(value);
    }
    fail('binding_error','unknown binding');
  }
  function condition(c,env,depth=0) {
    if(depth>32) fail('expression_limit');
    if(c.eq) return eq(binding(c.eq[0],env),binding(c.eq[1],env));
    if(c.not) return !condition(c.not,env,depth+1);
    if(c.all) return c.all.every(x=>condition(x,env,depth+1));
    if(c.any) return c.any.some(x=>condition(x,env,depth+1));
    if(c.exists) {try {binding(c.exists,env);return true;} catch(e){if(e.code==='binding_error') return false;throw e;}}
    fail('condition_error');
  }
  function start(def, inputs, id='run-1', options={}) {
    if(!id)fail('invalid_run_identity');
    if(globalThis.Authoring)Authoring.validateValue(inputs,def.inputs);
    const maxWork=Math.min(options.maxWork??100,def.policy.totalWorkBudget??100),maxConcurrency=Math.min(options.maxConcurrency??4,def.policy.totalConcurrency??4);
    return {id,definition:copy(def),inputs:copy(inputs),options:copy(options),status:'running',version:1,tick:0,
      records:{},requests:{},commands:{},effects:{},events:[],work:0,maxWork,maxConcurrency,
      pinnedSpec:inputs.suppliedSpec??null,observedEdit:null,knowledgeHead:inputs.suppliedSpec??artifact('spec'),knowledgeVersion:1,observedSourceVersion:1,
      revisions:[{version:1,ref:inputs.suppliedSpec??artifact('spec')}],admission:{id:'admission-'+id,maxWork,maxConcurrency},lineage:null,output:null};
  }
  const world = () => ({deliveries:{},receipts:{},creates:0,updates:0,verifiedCommits:['commit-base'],artifacts:[]});
  const emit=(s,type,data={})=>s.events.push({seq:s.events.length+1,tick:s.tick,type,...copy(data)});
  function rec(s,node,path) {
    const id=JSON.stringify([s.id,...path,node.id]);
    return s.records[id] ??= {id,node:node.id,type:node.type,path:[...path,node.id],status:'ready',attempts:[],output:null};
  }
  function gateManifest(s,action,input) {
    return {run:s.id,definition:s.definition.package,spec:input.spec,commit:input.checkpoint?.commit??null,
      operation:action==='approvePublish'?'pull_request.upsert':'implement',deliveryKey:input.deliveryKey??null,policy:s.definition.policy};
  }
  function validateGate(s,input) {
    const a=input.approval, request=s.requests[a?.requestId];
    if(!request || !request.answer?.approved || !eq(a,request.answer)) fail('approval_binding_mismatch');
    const expected=gateManifest(s,'approvePublish',input);
    if(!eq(request.manifest,expected)) fail('approval_binding_mismatch');
    if(s.status!=='running' || s.observedEdit) fail('publication_blocked');
  }
  function validateScope(s,input) {
    const a=input.specApproval,q=s.requests[a?.requestId];
    if(!q||!q.answer?.approved||!eq(a,q.answer)||!eq(q.manifest,gateManifest(s,'approveSpec',{spec:input.spec})))fail('scope_approval_binding_mismatch');
  }
  function mockResult(s,r,w) {
    const x=r.inputs, index=r.attempts.length;
    switch(r.action) {
      case 'discover': return {findings:artifact('discovery')};
      case 'investigate': return {findings:artifact('investigation')};
      case 'specify': {const spec=x.suppliedSpec??artifact('spec');s.pinnedSpec=spec;s.knowledgeHead=spec;return {spec};}
      case 'prepare': return {checkpoint:x.checkpoint};
      case 'implement': {const n=Object.values(s.records).filter(v=>v.action==='implement'&&v.status==='done').length+1;const cp=checkpoint('work-'+s.id+'-'+n);w.verifiedCommits.push(cp.commit);return {checkpoint:cp};}
      case 'check': return {passed:!s.options.alwaysFailChecks,spec:x.spec,checkpoint:x.checkpoint,evidence:artifact('checks-'+r.id)};
      case 'review': {const n=Object.values(s.records).filter(v=>v.action==='review'&&v.status==='done').length;return {accepted:!(s.options.repairOnce&&n===0),spec:x.spec,checkpoint:x.checkpoint,findings:artifact('review-'+r.id)};}
      case 'reproduce': {const n=Object.values(s.records).filter(v=>v.action==='reproduce'&&v.status==='done').length;return {reproduced:!s.options.neverReproduce&&!(s.options.reproduceOnce&&n===0),checkpoint:x.checkpoint,evidence:artifact('reproduction-'+r.id)};}
      case 'planTasks': return {tasks:x.tasks};
      case 'inspectTask': return {finding:artifact('task-'+x.task.id)};
      default: fail('unsupported_mock_action',r.action+' '+index);
    }
  }
  function call(s,node,r,env,w) {
    if(r.status==='ready') {
      if(s.status!=='running') return;
      if(s.work>=s.maxWork) {s.status='limit_reached';emit(s,'total_work_exhausted');return;}
      if(Object.values(s.records).filter(v=>v.status==='running').length>=s.maxConcurrency) return;
      r.inputs ??= binding(node.with,env);r.action=node.action;
      if(globalThis.Authoring)Authoring.validateValue(r.inputs,Authoring.actions[node.action].inputs);
      if(r.attempts.length>=(globalThis.Authoring?Authoring.actions[node.action].maxAttempts:1))fail('attempt_limit');
      if(node.runtime && s.options.unsupportedRuntime) {s.status='capability_blocked';emit(s,'unsupported_capability',{setting:s.options.unsupportedRuntime});return;}
      if(node.action==='approvePublish') {
        if(!r.inputs.checks.passed || !r.inputs.review.accepted || !eq(r.inputs.spec,r.inputs.checks.spec) || !eq(r.inputs.spec,r.inputs.review.spec) || !eq(r.inputs.checkpoint,r.inputs.checks.checkpoint) || !eq(r.inputs.checkpoint,r.inputs.review.checkpoint)) fail('verification_binding_mismatch');
      }
      if(node.action==='publishPR') validateGate(s,r.inputs);
      if(node.action==='implement') validateScope(s,r.inputs);
      s.work++;
      const attempt={id:JSON.stringify([r.id,r.attempts.length+1]),number:r.attempts.length+1,started:s.tick,inputs:copy(r.inputs),status:'running'};
      r.attempts.push(attempt);r.status='running';emit(s,'dispatch',{occurrence:r.id,attempt:attempt.id,action:node.action});
      if(['approveSpec','approvePublish','unreproduced'].includes(node.action)) {
        const requestId=JSON.stringify([r.id,'human']);
        s.requests[requestId]={id:requestId,occurrence:r.id,version:1,executionVersion:s.version,manifest:gateManifest(s,node.action,r.inputs),action:node.action,status:'waiting',answer:null};
        r.status='waiting';emit(s,'human_wait',{requestId});
      }
      if(node.action==='publishPR') {
        const key=JSON.stringify([s.id,r.path,'publication']);
        const payload={spec:r.inputs.spec,commit:r.inputs.checkpoint.commit,deliveryKey:r.inputs.deliveryKey};
        if(s.effects[key]&&!eq(s.effects[key].payload,payload)) fail('idempotency_payload_conflict');
        s.effects[key] ??= {key,occurrence:r.id,payload,status:'intent',receipt:null};r.effectKey=key;
        emit(s,'effect_intent',{key});
      }
      return;
    }
    if(r.status==='waiting') {
      const q=Object.values(s.requests).find(q=>q.occurrence===r.id);
      if(q.status==='answered'){if(globalThis.Authoring)Authoring.validateValue(q.answer,Authoring.actions[node.action].outputs);r.output=copy(q.answer);r.status='done';r.attempts.at(-1).status='done';emit(s,'accept_output',{occurrence:r.id});}
      return;
    }
    if(r.status!=='running') return;
    if(s.status!=='running') return;
    if(r.action==='publishPR') {
      const effect=s.effects[r.effectKey];
      if(effect.status==='unknown'){s.status='recovery_required';return;}
      validateGate(s,r.inputs);
      if(effect.status==='intent') {
        const delivery=effect.payload.deliveryKey;
        let receipt=w.receipts[effect.key];
        if(!receipt) {
          if(!w.deliveries[delivery]) {w.creates++;w.deliveries[delivery]={url:'https://example.invalid/pr/'+w.creates,commit:effect.payload.commit};}
          else {w.updates++;w.deliveries[delivery].commit=effect.payload.commit;}
          receipt={pullRequest:{url:w.deliveries[delivery].url}};w.receipts[effect.key]=copy(receipt);
        }
        effect.status='unknown';emit(s,'provider_success_receipt_missing',{key:effect.key});return;
      }
      if(effect.status==='confirmed') {if(globalThis.Authoring)Authoring.validateValue(effect.receipt,Authoring.actions[node.action].outputs);r.output=effect.receipt;r.status='done';r.attempts.at(-1).status='done';}
      return;
    }
    if(s.options.failOnce===r.action&&!s.options.failed) {
      s.options.failed=true;r.attempts.at(-1).status='retryable_failure';r.status='retry_wait';emit(s,'retry_wait',{occurrence:r.id});return;
    }
    if(s.options.permanentFailure===r.action){r.status='failed';r.attempts.at(-1).status='failed';s.status='failure_recovery_required';emit(s,'branch_failed',{occurrence:r.id});for(const sibling of Object.values(s.records))if(sibling.status==='running'){sibling.stopRequested=true;emit(s,'sibling_cancel_requested',{occurrence:sibling.id});}return;}
    r.output=mockResult(s,r,w);if(globalThis.Authoring)Authoring.validateValue(r.output,Authoring.actions[node.action].outputs);r.status='done';r.attempts.at(-1).status='done';emit(s,'accept_output',{occurrence:r.id});
  }
  function visit(s,node,path,env,w) {
    const r=rec(s,node,path);if(r.status==='done')return r;
    if(node.type==='call'){call(s,node,r,env,w);return r;}
    r.status='active';const inner={...env};
    const child=(n,e=inner,suffix=[])=>visit(s,n,[...r.path,...suffix],e,w);
    const done=out=>{r.output=copy(out);r.status='done';};
    switch(node.type) {
      case 'sequence': {
        for(const n of node.children) {const c=child(n);if(c.status!=='done'||s.status!=='running')return r;inner[n.id]=c.output;}
        done(node.output?binding(node.output,inner):{});break;
      }
      case 'choose': {
        if(r.selected===undefined) {r.selected=node.cases.findIndex(c=>condition(c.when,inner));emit(s,'branch_selected',{occurrence:r.id,selected:r.selected});return r;}
        const n=r.selected<0?node.otherwise:node.cases[r.selected].then;const c=child(n);if(c.status==='done')done(c.output);break;
      }
      case 'parallel': {
        if(!r.membership) {r.membership=node.branches.map(n=>n.id);emit(s,'membership_accepted',{occurrence:r.id,members:r.membership});return r;}
        let active=0,complete=true;
        for(const id of r.membership) {
          const n=node.branches.find(n=>n.id===id);const existing=rec(s,n,r.path);
          if(existing.status!=='done' && active>=node.maxConcurrency) {complete=false;continue;}
          const c=child(n,{...env});if(c.status!=='done'){active++;complete=false;}else inner[id]=c.output;
        }
        if(complete)done(node.output?binding(node.output,inner):Object.fromEntries(r.membership.map(id=>[id,inner[id]])));break;
      }
      case 'forEach': {
        if(!r.membership) {
          const items=binding(node.items,env);if(!Array.isArray(items)||items.length>node.maxItems)fail('fanout_oversized');
          const keys=items.map(item=>binding({ref:{source:'item',pointer:node.key}},{item}));
          if(keys.some(k=>typeof k!=='string'||!k.length)||new Set(keys).size!==keys.length)fail('fanout_duplicate_or_invalid_key');
          r.membership=items.map((item,i)=>({key:keys[i],item:copy(item)}));emit(s,'membership_accepted',{occurrence:r.id,members:r.membership});return r;
        }
        let active=0,complete=true;const outputs=[];
        for(const {key,item} of r.membership) {
          const suffix=[['item',key]],existing=rec(s,node.body,[...r.path,...suffix]);
          if(existing.status!=='done'&&active>=node.maxConcurrency) {complete=false;continue;}
          const e={...env,item},c=child(node.body,e,suffix);
          if(c.status!=='done'){active++;complete=false;}else outputs.push(binding(node.output,{...e,[node.body.id]:c.output}));
        }
        if(complete)done(outputs);break;
      }
      case 'repeat': {
        if(r.iteration===undefined){r.iteration=1;r.carry=binding(node.initial,env);}
        const c=child(node.body,{...env,carry:r.carry},[['iteration',r.iteration]]);
        if(c.status!=='done'||s.status!=='running')return r;
        const e={...env,carry:r.carry,body:c.output};
        if(condition(node.until,e))done(binding(node.output,e));
        else if(r.iteration===node.maxIterations){s.status='limit_reached';emit(s,'loop_exhausted',{occurrence:r.id,iteration:r.iteration});}
        else {r.carry=binding(node.carry,e);r.iteration++;emit(s,'next_iteration',{occurrence:r.id,iteration:r.iteration});}
        break;
      }
      case 'end': done(binding(node.result,env));if(globalThis.Authoring)Authoring.validateValue(r.output,s.definition.outputs);s.output=r.output;s.status='completed';emit(s,'run_ended',{output:s.output});break;
      default:fail('unsupported_node',node.type);
    }
    return r;
  }
  function step(s,w) {
    s.tick++;
    if(s.status!=='running'){emit(s,'dispatch_blocked',{status:s.status});return s;}
    try{const r=visit(s,s.definition.body,[],{input:s.inputs},w);if(r.status==='done'&&s.status==='running'){if(globalThis.Authoring)Authoring.validateValue(r.output,s.definition.outputs);s.output=r.output;s.status='completed';}}
    catch(e){s.status='blocked';emit(s,e.code??'model_error',{message:e.message});}
    return s;
  }
  function reply(s,requestId,value,commandId,version,executionVersion,manifest,responder='member') {
    const payload={requestId,value,version,executionVersion,manifest,responder};
    if(s.commands[commandId]) {if(!eq(s.commands[commandId].payload,payload))return 'command_payload_conflict';return s.commands[commandId].result;}
    const q=s.requests[requestId];let result='accepted';
    if(responder!=='member')result='unauthorized';
    else if(!q||q.status!=='waiting'||version!==q.version||executionVersion!==s.version||q.executionVersion!==s.version||!eq(manifest,q.manifest)||s.status!=='running')result='reply_conflict';
    else if(q.action==='unreproduced'?!['stop','investigate_again'].includes(value.decision):typeof value.approved!=='boolean')result='invalid_result';
    else {
      const output={...copy(value),requestId:q.id,manifest:copy(q.manifest),version:q.version,responder};
      try{if(globalThis.Authoring)Authoring.validateValue(output,Authoring.actions[q.action].outputs);q.answer=output;q.status='answered';q.version++;}
      catch(e){result='invalid_result';}
    }
    s.commands[commandId]={payload:copy(payload),result};emit(s,'human_reply',{requestId,result,commandId});return result;
  }
  function answer(s,q,value,id='reply-'+Object.keys(s.commands).length){return reply(s,q.id,value,id,q.version,s.version,copy(q.manifest));}
  function reconcile(s,w) {
    for(const e of Object.values(s.effects)) if(e.status==='unknown') {
      const receipt=w.receipts[e.key];if(receipt){e.status='confirmed';e.receipt=copy(receipt);emit(s,'effect_reconciled',{key:e.key,receipt});}
      else emit(s,'reconciliation_unresolved',{key:e.key});
    }
    if(s.status==='recovery_required'&&!Object.values(s.effects).some(e=>e.status==='unknown')&&!Object.values(s.records).some(r=>r.status==='paused'))s.status='running';
  }
  function retry(s,occurrence) {
    const r=s.records[occurrence],contract=r&&Authoring.actions[r.action];if(!r||r.status!=='retry_wait'||!contract.retryableErrors.includes('mock_read_transport')||r.attempts.length>=contract.maxAttempts)fail('unsafe_retry');
    r.status='ready';emit(s,'retry_authorized',{occurrence});
  }
  function save(s,revision,base=s.knowledgeHead.revision) {
    if(base!==s.knowledgeHead.revision)return 'save_conflict';
    if(s.revisions.some(r=>r.ref.revision===revision))return 'revision_conflict';
    s.knowledgeHead=artifact('spec',revision);s.knowledgeVersion++;s.revisions.push({version:s.knowledgeVersion,ref:copy(s.knowledgeHead)});emit(s,'knowledge_saved',{revision,sourceVersion:s.knowledgeVersion,executionObserved:false});return 'saved';
  }
  function observe(s,revision) {
    if(['completed','superseded','cancelled'].includes(s.status))return 'terminal';
    const saved=s.revisions.find(r=>r.ref.revision===revision);if(!saved)return 'unknown_revision';
    if(saved.version<=s.observedSourceVersion)return 'stale_or_duplicate';
    s.observedSourceVersion=saved.version;s.version++;s.observedEdit=copy(saved.ref);s.status='replan_required';emit(s,'edit_observed',{revision,sourceVersion:saved.version,version:s.version});return 'observed';
  }
  function retain(s,revision,version) {
    if(s.status!=='replan_required'||s.version!==version||s.observedEdit?.revision!==revision)return 'retain_conflict';
    s.observedEdit=null;s.status=Object.values(s.records).some(r=>r.status==='paused')?'recovery_required':'running';
    for(const q of Object.values(s.requests))if(q.status==='waiting'){q.executionVersion=s.version;q.version++;}
    emit(s,'revision_retained',{revision,pinned:s.pinnedSpec});return 'retained';
  }
  function cancel(s){s.status='cancel_requested';s.version++;emit(s,'cancel_requested');}
  function quiesce(s) {
    for(const r of Object.values(s.records)) if(['running','retry_wait'].includes(r.status)) {
      if(r.effectKey&&s.effects[r.effectKey].status==='unknown')continue;
      if(r.effectKey&&s.effects[r.effectKey].status==='intent')s.effects[r.effectKey].status='cancelled_unsent';
      r.status=s.status==='replan_required'&&!r.effectKey?'paused':'cancelled';if(r.attempts.length)r.attempts.at(-1).status='cancelled';
    }
    if(s.status==='cancel_requested'&&!Object.values(s.effects).some(e=>e.status==='unknown'))s.status='cancelled';
    emit(s,'controllable_work_quiesced');
  }
  function recoverWorkspace(s,w,occurrence) {
    const r=s.records[occurrence];
    if(s.status!=='recovery_required'||r?.status!=='paused'||!w.verifiedCommits.includes(r.inputs.checkpoint?.commit))fail('workspace_recovery_required');
    const contract=Authoring.actions[r.action];if(!contract.retryableErrors.includes('mock_verified_reconstruction')||r.attempts.length>=contract.maxAttempts)fail('unsafe_retry');
    r.recovery={verifiedOriginalInput:copy(r.inputs.checkpoint)};r.status='ready';emit(s,'workspace_reconstructed',{occurrence,checkpoint:r.inputs.checkpoint});
    if(!Object.values(s.records).some(r=>r.status==='paused')&&!Object.values(s.effects).some(e=>e.status==='unknown'))s.status='running';
  }
  function successor(s,w,{revision,checkpoint:cp,id,version,admission}) {
    if(!id||id===s.id)fail('invalid_run_identity');
    if(!admission||!admission.id||admission.id===s.admission.id||!Number.isSafeInteger(admission.maxWork)||admission.maxWork<1||!Number.isSafeInteger(admission.maxConcurrency)||admission.maxConcurrency<1)fail('new_admission_required');
    if(s.status!=='replan_required'||s.version!==version||s.observedEdit?.revision!==revision)fail('adoption_conflict');
    if(Object.values(s.records).some(r=>r.status==='running')||Object.values(s.effects).some(e=>e.status==='unknown'||e.status==='intent'))fail('continuation_blocked');
    if(!w.verifiedCommits.includes(cp.commit))fail('unverified_checkpoint');
    const next=start(s.definition,{...s.inputs,checkpoint:cp,suppliedSpec:s.observedEdit},id,{...s.options,maxWork:admission.maxWork,maxConcurrency:admission.maxConcurrency});next.admission=copy(admission);
    next.lineage={predecessor:s.id,deliveryKey:s.inputs.deliveryKey};s.status='superseded';s.version++;emit(s,'successor_created',{id,revision});return next;
  }
  return {copy,canonical,eq,artifact,checkpoint,binding,condition,start,world,step,reply,answer,reconcile,retry,save,observe,retain,cancel,quiesce,recoverWorkspace,successor,validateGate,validateScope};
})();
