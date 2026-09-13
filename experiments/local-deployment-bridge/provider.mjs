// Trusted local Integrations worker. Credentials stay here; external calls use the scoped role.
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {connect,resources,digest,bytesDigest,wait} from './common.mjs';
const id=process.argv[2];const db=await connect('integrations');
const q=async(s,a=[])=>(await db.query(s,a)).rows;
if(!(await q('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',[id]))[0].acquired)process.exit(3);
let intent=(await q('SELECT * FROM integrations.intents WHERE id=$1',[id]))[0];if(!intent)throw Error('intent missing');
const m=intent.manifest;const r=resources();const detail={...intent.detail};
const AWS='/home/amillard98/.local/bin/aws';
function cli(args,env){return new Promise((resolve,reject)=>{const p=spawn(AWS,[...args,'--region',r.region,'--output','json','--no-cli-pager'],{env});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',c=>c?reject(Error(err.trim())):resolve(out.trim()?JSON.parse(out):{}));});}
const session=await cli(['sts','assume-role','--profile','agents-assemble','--role-arn',r.controller_role,'--role-session-name','local-'+id,'--duration-seconds','900','--policy',JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Action:'*',Resource:'*'},{Effect:'Deny',Action:['cloudformation:CreateChangeSet','cloudformation:ExecuteChangeSet'],Resource:'*',Condition:{DateGreaterThanEquals:{'aws:CurrentTime':detail.permit_expires}}}]})],process.env);
const awsEnv={PATH:process.env.PATH,HOME:process.env.HOME,AWS_EC2_METADATA_DISABLED:'true',AWS_ACCESS_KEY_ID:session.Credentials.AccessKeyId,
 AWS_SECRET_ACCESS_KEY:session.Credentials.SecretAccessKey,AWS_SESSION_TOKEN:session.Credentials.SessionToken};
const aws=(...args)=>cli(args,awsEnv);
const identity=await aws('sts','get-caller-identity');if(!identity.Arn.startsWith(`arn:aws:sts::${r.account}:assumed-role/aa-wf15l-controller/`))throw Error('wrong controller identity');
const changeName='aa-wf15l-'+id;const createToken=changeName+'-create';const executeToken=changeName+'-execute';
async function state(next,extra={}){Object.assign(detail,extra);await db.query('BEGIN');await q('UPDATE integrations.intents SET state=$2,detail=$3 WHERE id=$1',[id,next,detail]);await q('INSERT INTO integrations.journal(command,result) VALUES($1,$2)',[{effect:id,transition:next},{...extra,at:new Date().toISOString()}]);await db.query('COMMIT');intent.state=next;}
const mutationOpen=()=>{if(Date.now()>=Date.parse(detail.permit_expires))throw Error('mutation-permit-expired; reconcile only');};
const templatePath=`dist/${m.environment}-${m.candidate}.json`;const template=readFileSync(templatePath);
if(bytesDigest(template)!==m.template_sha256)throw Error('stored template changed');
async function observe(){
 const alias=await aws('lambda','get-alias','--function-name',m.function,'--name','live');
 const f=(await aws('lambda','get-function','--function-name',m.function,'--qualifier',alias.FunctionVersion)).Configuration;
 return {version:alias.FunctionVersion,artifact:Buffer.from(f.CodeSha256,'base64').toString('hex'),configuration:f.Environment.Variables};
}
async function change(){return aws('cloudformation','describe-change-set','--stack-name',m.stack,'--change-set-name',changeName);}
async function queryOriginal(){
 let c;for(let n=0;n<120;n++){c=await change();if(!['CREATE_PENDING','CREATE_IN_PROGRESS'].includes(c.Status))break;await wait(2000);}
 if(c.Status!=='CREATE_COMPLETE')throw Error('change set not usable: '+c.Status+' '+c.StatusReason);
 const t=(await aws('cloudformation','get-template','--stack-name',m.stack,'--change-set-name',changeName,'--template-stage','Original')).TemplateBody;
 if(digest(typeof t==='string'?JSON.parse(t):t)!==digest(JSON.parse(template)))throw Error('provider template mismatch');
 const expected={Environment:m.environment,ArtifactBucket:m.bucket,ArtifactKey:m.artifact_key,ArtifactVersion:m.artifact_version,ArtifactSha256:m.artifact};
 for(const [k,v]of Object.entries(expected))if(c.Parameters.find(p=>p.ParameterKey===k)?.ParameterValue!==v)throw Error('provider parameter mismatch');
 for(const item of c.Changes){const x=item.ResourceChange;if(!['AWS::Lambda::Function','AWS::Lambda::Version','AWS::Lambda::Alias'].includes(x.ResourceType))throw Error('unexpected resource change');if(x.ResourceType==='AWS::Lambda::Function'&&(x.Action!=='Modify'||x.Replacement!=='False'))throw Error('unexpected function replacement');}
 return c;
}
try{
 if(intent.state==='accepted'){
  mutationOpen();const before=await observe();if(before.artifact!==m.expected_prior||digest(before.configuration)!==digest(m.configuration))throw Error('provider predecessor mismatch');
  const head=await aws('s3api','head-object','--bucket',m.bucket,'--key',m.artifact_key,'--version-id',m.artifact_version,'--checksum-mode','ENABLED');
  if(Buffer.from(head.ChecksumSHA256,'base64').toString('hex')!==m.artifact)throw Error('stored object checksum mismatch');
  await state('create-possible',{change_name:changeName,create_token:createToken,execute_token:executeToken,before,controller_identity:identity});
  const values={Environment:m.environment,ArtifactBucket:m.bucket,ArtifactKey:m.artifact_key,ArtifactVersion:m.artifact_version,ArtifactSha256:m.artifact};
  mutationOpen();
  await aws('cloudformation','create-change-set','--stack-name',m.stack,'--change-set-name',changeName,'--change-set-type','UPDATE',
   '--template-body','file://'+process.cwd()+'/'+templatePath,'--parameters',JSON.stringify(Object.entries(values).map(([ParameterKey,ParameterValue])=>({ParameterKey,ParameterValue}))),
   '--client-token',createToken,'--description','Effect '+id+' manifest '+intent.digest);
  if(m.fault==='create'){console.log('FAULT: accepted CreateChangeSet response discarded; killing provider worker');process.kill(process.pid,'SIGKILL');}
 }
 if(intent.state==='create-possible'){
  const c=await queryOriginal();await state('created',{change_set:c.ChangeSetId,reviewed_changes:c.Changes,create_reconciled:true});
 }
 if(intent.state==='created'){
  mutationOpen();const before=await observe();if(digest(before)!==digest(detail.before))throw Error('provider changed before execution');
  const c=await queryOriginal();if(c.ExecutionStatus!=='AVAILABLE')throw Error('change set unexpectedly consumed');
  await state('execute-possible');
  mutationOpen();
  await aws('cloudformation','execute-change-set','--stack-name',m.stack,'--change-set-name',changeName,'--client-request-token',executeToken);
  if(m.fault==='execute'){console.log('FAULT: accepted ExecuteChangeSet response discarded; killing provider worker');process.kill(process.pid,'SIGKILL');}
 }
 if(intent.state==='execute-possible'){
  const c=await change();if(!['EXECUTE_IN_PROGRESS','EXECUTE_COMPLETE'].includes(c.ExecutionStatus))throw Error('execute outcome unknown; no retry');
  await state('executing',{execute_reconciled:true,execution_status:c.ExecutionStatus});
 }
 if(intent.state==='executing'){
  let stack;for(let n=0;n<180;n++){stack=(await aws('cloudformation','describe-stacks','--stack-name',m.stack)).Stacks[0];if(!['UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(stack.StackStatus))break;await wait(2000);}
  if(stack.StackStatus!=='UPDATE_COMPLETE')throw Error('provider outcome not successful: '+stack.StackStatus);
  const after=await observe();if(after.artifact!==m.artifact||digest(after.configuration)!==digest(m.configuration))throw Error('provider result mismatch');
  const response=await fetch(m.health_url,{signal:AbortSignal.timeout(15000)});const health={status:response.status,body:await response.json(),observed_at:new Date().toISOString()};
  if(![200,503].includes(health.status)||health.body.release!==m.artifact_source||health.body.environment!==m.environment||health.body.healthy!==(health.status===200))throw Error('unexpected health evidence');
  const events=(await aws('cloudformation','describe-stack-events','--stack-name',m.stack)).StackEvents.filter(e=>e.ClientRequestToken===executeToken);
  if(!events.some(e=>e.ResourceType==='AWS::CloudFormation::Stack'&&e.ResourceStatus==='UPDATE_COMPLETE'))throw Error('missing operation-token completion');
  const receipt={id:'provider:'+id,effect:id,env:m.environment,digest:intent.digest,run:detail.run,attempt:detail.attempt,generation:m.environment_generation+1,
   observed_artifact:after.artifact,outcome:health.status===200?'healthy':'failed-health',provider:{change_set:detail.change_set,create_token:createToken,execute_token:executeToken,after,health,events}};
  await db.query('BEGIN');await q('INSERT INTO integrations.receipts VALUES($1,$2)',[receipt.id,receipt]);await q('INSERT INTO integrations.outbox(id,payload) VALUES($1,$2)',[receipt.id,receipt]);
  await q("UPDATE integrations.intents SET state='receipted',detail=$2 WHERE id=$1",[id,{...detail,receipt:receipt.id}]);await db.query('COMMIT');
  console.log(JSON.stringify({effect:id,outcome:receipt.outcome,artifact:after.artifact,version:after.version}));
 }
}catch(error){await state('paused',{recovery_from:intent.state,error:error.message});console.error(error.message);process.exitCode=2;}
await db.end();
