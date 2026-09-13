// Operator-authorized test grants, not an implementation of the product's human approval UI.
import {readFileSync,writeFileSync} from 'node:fs';
import {connect,resources,digest,bytesDigest} from './common.mjs';
const db=await connect();const r=resources();
const workflowSha=process.argv[2];if(!/^[a-f0-9]{40}$/.test(workflowSha))throw Error('pinned workflow required');
await db.query(readFileSync('schema.sql','utf8'));
const templates={};for(const env of ['staging','prod'])for(const candidate of ['baseline','healthy','unhealthy'])templates[env+'-'+candidate]=bytesDigest(readFileSync(`dist/${env}-${candidate}.json`));
for(const env of ['staging','prod'])await db.query('INSERT INTO execution.environments(id,current_release) VALUES($1,$2)',[env,r.artifacts.baseline.sha256]);
function target(env,candidate){const a=r.artifacts[candidate];return {artifact:a.sha256,artifact_version:a.version,artifact_key:a.key,artifact_source:a.source,template_sha256:templates[env+'-'+candidate],configuration:{PROBE_ENVIRONMENT:env},candidate};}
function manifest(env,candidate,prior,generation,fault){return {account:r.account,region:r.region,environment:env,environment_generation:generation,
 stack:r.stacks[env].StackId,function:r.stacks[env].outputs.FunctionName,health_url:r.stacks[env].outputs.HealthUrl,
 workflow_revision:workflowSha,controller_revision:process.argv[3],...target(env,candidate),bucket:r.bucket,expected_prior:r.artifacts[prior].sha256,
 rollback_target:target(env,prior),health_policy:'one-bounded-health-sample-v1',rollback_policy:'restore-retained-on-failed-health-v1',fault};}
const cases=[['staging-release','staging','healthy','baseline',0,'create'],['prod-release','prod','healthy','baseline',0,'execute'],
 ['staging-failure','staging','unhealthy','healthy',1,'none'],['prod-failure','prod','unhealthy','healthy',1,'none'],
 ['revoked','staging','healthy','baseline',0,'none'],['expired','staging','healthy','baseline',0,'none'],
 ['wrong-workflow','staging','healthy','baseline',0,'none']];
const registrations={};
for(const [id,env,candidate,prior,generation,fault] of cases){
 const m=manifest(env,candidate,prior,generation,fault);if(id==='prod-release')m.staging_effect='staging-release';if(id==='wrong-workflow')m.workflow_revision='0'.repeat(40);
 await db.query(`INSERT INTO execution.effects(id,env,manifest,digest,expected_prior,kind,expires_at,rollback_until,revoked)
 VALUES($1,$2,$3,$4,$5,'deploy',clock_timestamp()+$6::interval,clock_timestamp()+interval '3 hours',$7)`,
 [id,env,m,digest(m),m.expected_prior,id==='expired'?'-1 second':'3 hours',id==='revoked']);
 registrations[id]={effect:id,digest:digest(m)};
}
writeFileSync('dist/registrations.json',JSON.stringify(registrations,null,2)+'\n');
writeFileSync('dist/policy.json',JSON.stringify({workflowSha,audience:'urn:agents-assemble:local-bridge:aa-wf15l',expectedRepository:'1366483946'},null,2)+'\n');
await db.end();console.log('Persisted bounded test manifests and authority; no deployment claimed');
