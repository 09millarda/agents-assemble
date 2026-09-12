/* THROWAWAY executable experiment cases. Assertions record decision evidence, not a production test suite. */
globalThis.Experiment = (()=>{
  const C=globalThis.Conformance;
  const inputs=(bug=false)=>({...bug?{report:C.artifact('report'),baselineCheckpoint:C.checkpoint(),priorFindings:null}:{brief:C.artifact('brief')},checkpoint:C.checkpoint(),suppliedSpec:null,deliveryKey:'delivery-1'});
  const createDemo=()=>({state:C.start(Authoring.definitions.feature,inputs()),world:C.world()});
  function runAll(){
    const results=[];
    function scenario(name,fn){
      const result={name,passed:false,assertions:[],trace:[]};
      const assert=(ok,label)=>{result.assertions.push({label,passed:!!ok});if(!ok)throw new Error(label);};
      const log=(label,s,w)=>result.trace.push({label,state:C.copy(s),world:C.copy(w)});
      const pump=(s,w,stop=()=>false,auto=true)=>{
        for(let i=0;i<250;i++){
          if(stop(s))return s;
          if(s.status==='completed'||s.status==='limit_reached'||s.status==='blocked'||s.status==='capability_blocked')return s;
          if(auto)for(const q of Object.values(s.requests))if(q.status==='waiting'){
            C.answer(s,q,q.action==='unreproduced'?{decision:'investigate_again',evidence:C.artifact('more-evidence')}:{approved:true});log('Human response accepted',s,w);
          }
          C.step(s,w);log('Advance execution',s,w);
          if(auto && Object.values(s.effects).some(e=>e.status==='unknown')){C.reconcile(s,w);log('Reconcile provider receipt',s,w);}
          if(s.status!=='running'&&s.status!=='recovery_required')return s;
        }
        throw new Error('experiment step bound reached');
      };
      try{fn({assert,log,pump});result.passed=true;}catch(e){result.error=e.stack??e.message;}
      results.push(result);
    }
    for(const [key,options] of [['feature',{repairOnce:true}],['bug',{reproduceOnce:true,repairOnce:true}]])scenario(key+' journey: bounded decisions and parallel verification',({assert,log,pump})=>{
      const s=C.start(Authoring.definitions[key],inputs(key==='bug'),'run-'+key,options),w=C.world();log('Admitted frozen definition',s,w);pump(s,w);
      assert(s.status==='completed', 'Starter journey completes');assert(s.output.outcome==='published','Typed outcome is published');assert(w.creates===1,'Exactly one mock PR created');
      const impl=Object.values(s.records).filter(r=>r.action==='implement');assert(impl.length===2,'Review change creates a second bounded occurrence');assert(new Set(impl.map(r=>r.id)).size===2,'Repair occurrence IDs differ');
      const branches=Object.values(s.records).filter(r=>r.type==='parallel');assert(branches.every(r=>r.membership.length===2&&r.status==='done'),'All declared verification branches join');
      if(key==='bug')assert(Object.values(s.records).filter(r=>r.action==='reproduce').length===2,'Reproduction follows human evidence into next round');
    });
    scenario('Restart at a human wait preserves request and attempts',({assert,log,pump})=>{
      let {state:s,world:w}=createDemo();pump(s,w,x=>Object.values(x.requests).some(q=>q.status==='waiting'),false);
      const before=C.copy(s),ids=Object.keys(s.requests);s=C.copy(s);log('JSON snapshot restored without a worker',s,w);
      assert(C.eq(s,before),'Entire execution snapshot survives round trip');pump(s,w);assert(s.status==='completed','Restored run resumes');assert(Object.keys(s.requests).includes(ids[0]),'Original durable human request reused');
      assert(s.records[s.requests[ids[0]].occurrence].attempts.length===1,'Wait restart does not repeat invocation');
    });
    scenario('Restart after membership acceptance preserves task identity and order',({assert,log,pump})=>{
      const tasks=[{id:'a/b',title:'First'},{id:'a~b',title:'Second'},{id:'a',title:'Third'}];let s=C.start(Authoring.definitions.fanout,{tasks,checkpoint:C.checkpoint()}),w=C.world();
      pump(s,w,x=>Object.values(x.records).some(r=>r.type==='forEach'&&r.membership));
      const membership=Object.values(s.records).find(r=>r.type==='forEach').membership;s=C.copy(s);tasks.reverse();log('Restart; caller changes its source array order',s,w);pump(s,w);
      const each=Object.values(s.records).find(r=>r.type==='forEach');assert(C.eq(each.membership,membership),'Accepted membership stays frozen');assert(each.output.length===3,'Exactly original three tasks complete');
      assert(new Set(Object.values(s.records).filter(r=>r.action==='inspectTask').map(r=>r.id)).size===3,'Delimiter-like item keys remain distinct');assert(each.output[0].finding.id==='task-a/b','Output preserves original snapshot order');
    });
    for(const [label,tasks] of [['duplicate',[{id:'same',title:'First'},{id:'same',title:'Second'}]],['oversized',Array.from({length:13},(_,i)=>({id:String(i),title:'Task '+i}))]])scenario('Fan-out rejects '+label+' membership before item dispatch',({assert,log,pump})=>{
      const s=C.start(Authoring.definitions.fanout,{tasks,checkpoint:C.checkpoint()}),w=C.world();pump(s,w);assert(s.status==='blocked','Invalid fan-out is blocked');assert(!Object.values(s.records).some(r=>r.action==='inspectTask'),'No item invocation created');log('Rejected fan-out',s,w);
    });
    scenario('Global work budget survives restart and retry',({assert,log,pump})=>{
      let s=C.start(Authoring.definitions.feature,inputs(),'budget',{maxWork:1,failOnce:'discover'}),w=C.world();pump(s,w,x=>Object.values(x.records).some(r=>r.status==='retry_wait'));
      const r=Object.values(s.records).find(r=>r.status==='retry_wait');s=C.copy(s);C.retry(s,r.id);C.step(s,w);log('Retry requires another admitted work unit',s,w);assert(s.status==='limit_reached','Exhausted budget blocks retry after restart');assert(s.work===1,'Restart does not replenish budget');assert(s.records[r.id].attempts.length===1,'Unfunded retry never dispatches');
    });
    scenario('Safe invocation retry preserves occurrence and frozen input',({assert,log,pump})=>{
      const s=C.start(Authoring.definitions.feature,inputs(),'retry',{failOnce:'discover'}),w=C.world();pump(s,w,x=>Object.values(x.records).some(r=>r.status==='retry_wait'));
      const r=Object.values(s.records).find(r=>r.status==='retry_wait'),id=r.id,before=C.copy(r.inputs);C.retry(s,id);pump(s,w);log('Retry complete',s,w);
      assert(s.status==='completed','Safe read retry completes');assert(r.attempts.length===2,'Two invocation attempts, one occurrence');assert(r.attempts[0].id!==r.attempts[1].id,'Attempt identities are distinct');assert(C.eq(before,r.attempts[1].inputs),'Retry inputs remain frozen');
    });
    scenario('Provider success before receipt: restart reconciles one PR',({assert,log,pump})=>{
      let {state:s,world:w}=createDemo();pump(s,w,x=>Object.values(x.effects).some(e=>e.status==='intent'));
      C.step(s,w);log('Provider created PR; receipt not accepted',s,w);const effect=C.copy(Object.values(s.effects)[0]);assert(w.creates===1&&effect.status==='unknown','Provider and Execution disagree visibly');
      s=C.copy(s);C.step(s,w);assert(s.status==='recovery_required','Uncertain publication blocks continuation');C.reconcile(s,w);log('Existing PR found by effect identity',s,w);pump(s,w);
      assert(s.status==='completed'&&w.creates===1,'Restart never creates a duplicate PR');assert(Object.keys(s.effects)[0]===effect.key,'Effect identity survives restart');assert(s.records[effect.occurrence].attempts.length===1,'Reconciliation is not a new publication attempt');
    });
    scenario('Competing replies and altered duplicate commands conflict',({assert,log,pump})=>{
      const {state:s,world:w}=createDemo();pump(s,w,x=>Object.values(x.requests).some(q=>q.status==='waiting'),false);const q=Object.values(s.requests)[0],v=q.version,ev=s.version,m=C.copy(q.manifest);
      assert(C.reply(s,q.id,{approved:true},'same',v,ev,m)==='accepted','First authorized response wins');assert(C.reply(s,q.id,{approved:true},'same',v,ev,m)==='accepted','Identical command redelivery is idempotent');
      assert(C.reply(s,q.id,{approved:false},'same',v,ev,m)==='command_payload_conflict','Same ID with changed answer conflicts');assert(C.reply(s,q.id,{approved:false},'other',v,ev,m)==='reply_conflict','Competing answer cannot overwrite');log('Conflicting replies retained in experiment assertions',s,w);
    });
    scenario('Knowledge save precedes approval before Execution observes it',({assert,log,pump})=>{
      const {state:s,world:w}=createDemo();pump(s,w,x=>Object.values(x.requests).some(q=>q.action==='approvePublish'&&q.status==='waiting'));const q=Object.values(s.requests).find(q=>q.action==='approvePublish');
      C.save(s,'2');log('Knowledge saved revision 2; Execution has not observed it',s,w);assert(C.answer(s,q,{approved:true})==='accepted','Old exact-manifest approval can still be accepted before observation');
      C.observe(s,'2');C.step(s,w);log('Execution observes edit and blocks new dispatch',s,w);assert(s.status==='replan_required'&&w.creates===0,'Observed edit stops publication dispatch');assert(q.manifest.spec.revision==='1','Accepted approval still names revision 1');
    });
    scenario('Observed edit rejects old approval; retain is version bound',({assert,log,pump})=>{
      const {state:s,world:w}=createDemo();pump(s,w,x=>Object.values(x.requests).some(q=>q.status==='waiting'),false);const q=Object.values(s.requests)[0],v=q.version,ev=s.version,m=C.copy(q.manifest);
      C.save(s,'2');C.observe(s,'2');assert(C.reply(s,q.id,{approved:true},'late',v,ev,m)==='reply_conflict','Reply after observation is stale');assert(C.retain(s,'2',ev)==='retain_conflict','Stale retain command rejected');assert(C.retain(s,'2',s.version)==='retained','Exact observed revision may be retained');
      C.save(s,'3');C.observe(s,'3');assert(s.status==='replan_required','Retaining revision 2 does not acknowledge revision 3');log('A later edit requires another explicit decision',s,w);
    });
    scenario('Approval binds exact reviewed spec and commit',({assert,log,pump})=>{
      const {state:s,world:w}=createDemo();pump(s,w,x=>Object.values(x.requests).some(q=>q.action==='approvePublish'&&q.status==='waiting'));const q=Object.values(s.requests).find(q=>q.action==='approvePublish');C.answer(s,q,{approved:true});
      const r=s.records[q.occurrence],input={...r.inputs,approval:q.answer};let rejected=false;try{C.validateGate(s,{...input,checkpoint:C.checkpoint('different')});}catch(e){rejected=e.code==='approval_binding_mismatch';}assert(rejected,'Different commit cannot consume approval');
      rejected=false;try{C.validateGate(s,{...input,spec:C.artifact('spec','2')});}catch(e){rejected=e.code==='approval_binding_mismatch';}assert(rejected,'Different spec cannot consume approval');log('Exact gate bindings remain inspectable',s,w);
    });
    scenario('Adopted bug revision starts fresh with recovered work and original baseline',({assert,log,pump})=>{
      const s=C.start(Authoring.definitions.bug,inputs(true),'bug-old'),w=C.world();pump(s,w,x=>Object.values(x.requests).some(q=>q.action==='approvePublish'&&q.status==='waiting'));
      const q=Object.values(s.requests).find(q=>q.action==='approvePublish'),cp=q.manifest.commit;const working={id:'recovered',commit:cp};C.save(s,'2');C.observe(s,'2');C.quiesce(s);
      const next=C.successor(s,w,{revision:'2',checkpoint:working,id:'bug-next',version:s.version,admission:{id:'new-bug-budget',maxWork:100,maxConcurrency:4}});log('Successor admitted at entry with no inherited actions',next,w);
      assert(!Object.keys(next.records).length&&!Object.keys(next.requests).length,'No completed action or approval copied');assert(next.inputs.baselineCheckpoint.commit==='commit-base','Original failing baseline retained');assert(next.inputs.checkpoint.commit===cp,'Recovered working checkpoint retained');assert(next.inputs.deliveryKey===s.inputs.deliveryKey,'Logical delivery mapping inherited');
      pump(next,w);assert(next.status==='completed','Successor revalidates full journey');assert(Object.values(next.records).find(r=>r.action==='reproduce').inputs.checkpoint.commit==='commit-base','Reproduction uses failing baseline');assert(Object.values(next.records).find(r=>r.action==='prepare').inputs.checkpoint.commit===cp,'Preparation uses recovered code');
    });
    scenario('Unknown old publication blocks adoption; successor updates inherited PR',({assert,log,pump})=>{
      const {state:s,world:w}=createDemo();pump(s,w,x=>Object.values(x.effects).some(e=>e.status==='intent'));C.step(s,w);C.save(s,'2');C.observe(s,'2');C.quiesce(s);
      const cp=Object.values(s.records).find(r=>r.action==='implement').output.checkpoint;let blocked=false;try{C.successor(s,w,{revision:'2',checkpoint:cp,id:'next',version:s.version,admission:{id:'new-feature-budget',maxWork:100,maxConcurrency:4}});}catch(e){blocked=e.code==='continuation_blocked';}assert(blocked,'Unknown predecessor effect blocks successor');
      C.reconcile(s,w);C.quiesce(s);const next=C.successor(s,w,{revision:'2',checkpoint:cp,id:'next',version:s.version,admission:{id:'new-feature-budget',maxWork:100,maxConcurrency:4}});pump(next,w);log('Successor updates mapped PR with a new effect',next,w);assert(w.creates===1&&w.updates===1,'Lineage updates one logical PR');assert(Object.keys(s.effects)[0]!==Object.keys(next.effects)[0],'New run has a new operation identity');
    });
    scenario('Cancellation preserves uncertain effects until reconciliation',({assert,log,pump})=>{
      const {state:s,world:w}=createDemo();pump(s,w,x=>Object.values(x.effects).some(e=>e.status==='intent'));C.step(s,w);C.cancel(s);C.quiesce(s);C.step(s,w);log('Cancellation requested while publication is uncertain',s,w);
      assert(s.status==='cancel_requested','Cancellation is not falsely clean');assert(Object.values(s.effects)[0].status==='unknown','Uncertain effect remains visible');C.reconcile(s,w);C.quiesce(s);assert(s.status==='cancelled','Clean cancellation follows effect accounting');assert(w.creates===1,'Cancellation did not erase published PR');
    });
    scenario('Loop exhaustion needs attention and survives restart',({assert,log,pump})=>{
      let s=C.start(Authoring.definitions.feature,inputs(),'exhaustion',{alwaysFailChecks:true}),w=C.world();pump(s,w);assert(s.status==='limit_reached','Repair exhaustion pauses');assert(!Object.values(s.requests).some(q=>q.action==='approvePublish'),'No publication approval after failed checks');s=C.copy(s);C.step(s,w);log('Restart cannot reset exhausted iterations',s,w);assert(s.status==='limit_reached'&&w.creates===0,'Exhaustion remains blocked after restart');
    });
    scenario('Unsupported runtime settings block without substitution',({assert,log,pump})=>{
      const s=C.start(Authoring.definitions.feature,inputs(),'unsupported',{unsupportedRuntime:'effort=imaginary'}),w=C.world();pump(s,w);assert(s.status==='capability_blocked','Specific capability blocks dispatch');assert(s.work===0,'No attempt ran under substituted settings');log('Unsupported capability is visible',s,w);
    });
    scenario('Out-of-order edit delivery and duplicate observation preserve the newest decision',({assert,log,pump})=>{
      const {state:s,world:w}=createDemo();pump(s,w,x=>Object.values(x.requests).some(q=>q.status==='waiting'),false);C.save(s,'2');C.save(s,'3');C.observe(s,'3');
      assert(C.observe(s,'2')==='stale_or_duplicate','Older source event cannot roll back revision 3');assert(C.retain(s,'2',s.version)==='retain_conflict','Older retain cannot acknowledge newer edit');assert(C.retain(s,'3',s.version)==='retained','Newest proposal can be explicitly retained');
      assert(C.observe(s,'3')==='stale_or_duplicate'&&s.status==='running','Redelivered retained edit does not pause again');log('Monotone source version survives retain',s,w);
    });
    scenario('Retain after writer stop requires verified workspace reconstruction',({assert,log,pump})=>{
      const {state:s,world:w}=createDemo();pump(s,w,x=>Object.values(x.records).some(r=>r.action==='implement'&&r.status==='running'));const r=Object.values(s.records).find(r=>r.action==='implement');C.save(s,'2');C.observe(s,'2');C.quiesce(s);C.retain(s,'2',s.version);
      assert(s.status==='recovery_required','Stopped writer cannot silently resume');C.reconcile(s,w);assert(s.status==='recovery_required','Effect reconciliation cannot bypass workspace recovery');C.recoverWorkspace(s,w,r.id);pump(s,w);log('Verified original workspace input reconstructed before reattempt',s,w);assert(s.status==='completed','Retained run can recover and finish');assert(r.attempts.length===2&&r.recovery.verifiedOriginalInput.commit==='commit-base','Recovery is explicit and consumes another attempt');
    });
    scenario('Package budget cannot be widened by admission options',({assert,log,pump})=>{
      const def=C.copy(Authoring.definitions.feature);def.policy.totalWorkBudget=1;const s=C.start(def,inputs(),'package-budget',{maxWork:100}),w=C.world();pump(s,w);assert(s.maxWork===1&&s.work===1,'Declared stricter budget caps admission');assert(s.status==='limit_reached','Budget blocks next action');log('Package limit enforced',s,w);
    });
    scenario('Failure in parallel verification requests sibling cancellation and prevents publication',({assert,log,pump})=>{
      const s=C.start(Authoring.definitions.feature,inputs(),'parallel-failure',{permanentFailure:'check'}),w=C.world();pump(s,w);assert(s.status==='failure_recovery_required','Branch failure is explicit');const sibling=Object.values(s.records).find(r=>r.action==='review');assert(sibling.stopRequested&&sibling.status==='running','Active sibling receives stop request');C.quiesce(s);log('Controllable sibling cancellation accounted for',s,w);assert(sibling.status==='cancelled','Sibling confirms cancellation');assert(!Object.values(s.records).find(r=>r.type==='parallel'&&r.status==='done')&&w.creates===0,'Failed join never authorizes publication');
    });
    scenario('Successor identity and budget require explicit new admission',({assert,log,pump})=>{
      const {state:s,world:w}=createDemo();pump(s,w,x=>Object.values(x.requests).some(q=>q.status==='waiting'),false);C.save(s,'2');C.observe(s,'2');const args={revision:'2',checkpoint:C.checkpoint(),version:s.version};let code;
      try{C.successor(s,w,{...args,id:s.id,admission:{id:'new',maxWork:100,maxConcurrency:3}});}catch(e){code=e.code;}assert(code==='invalid_run_identity','Predecessor identity cannot be reused');
      try{C.successor(s,w,{...args,id:'new-run'});}catch(e){code=e.code;}assert(code==='new_admission_required','Adoption alone does not replenish work allowance');log('Successor guards reject incomplete admission',s,w);
    });
    scenario('Mismatched verification spec is rejected before asking for publication approval',({assert,log,pump})=>{
      const {state:s,world:w}=createDemo();pump(s,w,x=>Object.values(x.records).some(r=>r.action==='review'&&r.status==='running'));const review=Object.values(s.records).find(r=>r.action==='review');review.inputs.spec=C.artifact('spec','other');pump(s,w);assert(s.status==='blocked'&&s.events.at(-1).type==='verification_binding_mismatch','Injected adapter mismatch rejected');assert(!Object.values(s.requests).some(q=>q.action==='approvePublish'),'No approval requested for unrelated spec evidence');log('Exact evidence mismatch blocks gate',s,w);
    });
    scenario('Implementation cannot consume a scope approval for another specification',({assert,log,pump})=>{
      const def=C.copy(Authoring.definitions.feature);def.body.children.find(n=>n.id==='delivery').body.children[0].with.object.spec={literal:C.artifact('different')};Authoring.validate(def);
      const s=C.start(def,inputs(),'scope-mismatch'),w=C.world();pump(s,w);assert(s.status==='blocked'&&s.events.at(-1).type==='scope_approval_binding_mismatch','Accepted scope receipt must match exact implementation spec');assert(!Object.values(s.records).some(r=>r.action==='implement'&&r.attempts.length),'No workspace invocation begins outside approved scope');log('Scope gate rejects mismatched specification',s,w);
    });
    return results;
  }
  return {runAll,createDemo,inputs};
})();
