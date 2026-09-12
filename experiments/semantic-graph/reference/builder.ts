// Disposable local builder. Node 24 strips these type annotations; no source runs in interpreter.
import './authoring.cjs';
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Binding = { literal: Json } | { ref: { source: string; pointer: string } } | { object: Record<string, Binding> } | { array: Binding[] };
type Node = { id: string; type: string; [key: string]: unknown };
const A = (globalThis as typeof globalThis & { Authoring: any }).Authoring;
const lit = (value: Json): Binding => ({literal:value});
const ref = (source: string, pointer = ''): Binding => ({ref:{source,pointer}});
const object = (value: Record<string, Binding>): Binding => ({object:value});
const array = (...values: Binding[]): Binding => ({array:values});
const eq = (a: Binding,b: Binding) => ({eq:[a,b]});
const call = (id: string,action: string,withValues: Record<string, Binding>,runtime?: string): Node => ({id,type:'call',action,with:object(withValues),...(runtime ? {runtime} : {})});
const sequence = (id: string,children: Node[],output?: Record<string, Binding>): Node => ({id,type:'sequence',children,...(output?{output:object(output)}:{})});
const end = (id: string,outcome: string,pullRequest: Binding = lit(null)): Node => ({id,type:'end',result:object({outcome:lit(outcome),pullRequest})});
const gate = (id: string,approvalId: string,rejectedId: string,approvedId: string): Node => ({id,type:'choose',cases:[{when:eq(ref(approvalId,'/approved'),lit(false)),then:end(rejectedId,'rejected')}],otherwise:sequence(approvedId,[])});
const shape = (properties: Record<string,unknown>) => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const nullable = (schema: any) => ({...schema,type:[schema.type,'null']});
const aliases = ['discover','specify','approveSpec','prepare','implement','check','review','approvePublish','publishPR'];
const native = ['native_account','typed_result','checkpoint_recovery'];
const runtimeSlots = Object.fromEntries(['researcher','author','implementer','reviewer'].map(slot=>[slot,{requiredCapabilities:[...native,...(slot==='reviewer'?[]:['durable_human_request'])]}]));
const feature = {
  formatVersion:'agents-assemble.playbook/1',
  package:{id:'example/new-feature',version:'0.1.0'},
  inputs:shape({brief:A.schemas.ArtifactRef,checkpoint:A.schemas.CheckpointRef,suppliedSpec:nullable(A.schemas.ArtifactRef),deliveryKey:A.schemas.DeliveryKey}),
  outputs:shape({outcome:{type:'string',enum:['published','rejected']},pullRequest:nullable(A.schemas.PRRef)}),
  dependencies:{actions:Object.fromEntries(aliases.map(alias=>{const {id,version,digest}=A.actions[alias];return [alias,{id,version,digest}];}))},
  runtimeSlots,
  permissions:['repository.read','workspace.write','artifact.read','artifact.write','pull_request.upsert'],
  policy:{referencedSpecChange:'pause_and_replan',retries:'adapter_certified_only',expressionVersion:'pure-json/1',maxExpressionDepth:16,maxExpressionNodes:256,totalWorkBudget:100,totalConcurrency:3,humanDeadlineMs:86400000},
  body:sequence('feature',[
    call('discovery','discover',{brief:ref('input','/brief'),checkpoint:ref('input','/checkpoint')},'researcher'),
    call('specification','specify',{brief:ref('input','/brief'),findings:ref('discovery','/findings'),suppliedSpec:ref('input','/suppliedSpec')},'author'),
    call('scopeApproval','approveSpec',{spec:ref('specification','/spec')}),
    gate('scopeDecision','scopeApproval','rejectedScope','approvedScope'),
    call('workspace','prepare',{checkpoint:ref('input','/checkpoint')}),
    {id:'delivery',type:'repeat',maxIterations:3,
      initial:object({checkpoint:ref('workspace','/checkpoint'),feedback:array()}),
      body:sequence('repairRound',[
        call('implementation','implement',{spec:ref('specification','/spec'),specApproval:ref('scopeApproval'),checkpoint:ref('carry','/checkpoint'),feedback:ref('carry','/feedback')},'implementer'),
        {id:'verification',type:'parallel',join:'all',maxConcurrency:2,
          branches:[
            call('checks','check',{spec:ref('specification','/spec'),checkpoint:ref('implementation','/checkpoint')}),
            call('review','review',{spec:ref('specification','/spec'),checkpoint:ref('implementation','/checkpoint')},'reviewer')
          ],output:object({checks:ref('checks'),review:ref('review')})
        }
      ],{checkpoint:ref('implementation','/checkpoint'),verification:ref('verification')}),
      until:{all:[eq(ref('body','/verification/checks/passed'),lit(true)),eq(ref('body','/verification/review/accepted'),lit(true))]},
      carry:object({checkpoint:ref('body','/checkpoint'),feedback:array(ref('body','/verification/checks/evidence'),ref('body','/verification/review/findings'))}),
      output:object({checkpoint:ref('body','/checkpoint'),checks:ref('body','/verification/checks'),review:ref('body','/verification/review')})
    },
    call('publicationApproval','approvePublish',{spec:ref('specification','/spec'),checkpoint:ref('delivery','/checkpoint'),checks:ref('delivery','/checks'),review:ref('delivery','/review'),deliveryKey:ref('input','/deliveryKey')}),
    gate('publicationDecision','publicationApproval','rejectedPublication','approvedPublication'),
    call('publication','publishPR',{spec:ref('specification','/spec'),checkpoint:ref('delivery','/checkpoint'),deliveryKey:ref('input','/deliveryKey'),approval:ref('publicationApproval')}),
    end('complete','published',ref('publication','/pullRequest'))
  ])
};
const emittedText=A.canonical(A.normalize(feature));
const emitted=JSON.parse(emittedText);
if(A.canonical(emitted)!==A.canonical(A.normalize(A.definitions.feature)))throw new Error('Independent TypeScript builder differs from YAML-derived feature fixture');
const edited=A.editDocument(emitted,'delivery',{maxIterations:2});
const restored=A.editDocument(edited,'delivery',{maxIterations:3});
if(A.canonical(restored)!==A.canonical(emitted))throw new Error('Builder -> document -> structured edit -> reimport changed semantics');
if(process.argv.includes('--emit'))console.log(emittedText);
else console.log(JSON.stringify({builder:'local TypeScript helper composition',typeAnnotations:'stripped by Node; not a tsc typecheck',fullFeatureEquivalent:true,editorRoundtrip:true,stableNodeIds:true,pinnedDependenciesAndPolicy:true}));

// #16 exposes the original independently composed emitted data to its graph probe.
export default emitted;
