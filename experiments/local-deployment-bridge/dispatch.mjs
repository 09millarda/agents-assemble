import {connect,command} from './common.mjs';
import {readFileSync,appendFileSync} from 'node:fs';
const effect=process.argv[2];const url=readFileSync('dist/tunnel-url.txt','utf8').trim();
const db=await connect('execution');const e=(await db.query('SELECT * FROM execution.effects WHERE id=$1',[effect])).rows[0];if(!e)throw Error('unknown effect');
const request={ref:'main',return_run_details:true,inputs:{bridge_url:url,effect_id:e.id,manifest_digest:e.digest,expect_denied:String(['revoked','expired','wrong-workflow'].includes(effect))}};
// Persist possible dispatch separately from the provider intent; no blind repeat after uncertainty.
appendFileSync('dist/dispatches.jsonl',JSON.stringify({effect,phase:'may-have-dispatched',request,at:new Date().toISOString()})+'\n');
const r=await new Promise((resolve,reject)=>{
 import('node:child_process').then(({spawn})=>{const p=spawn('gh',['api','-H','X-GitHub-Api-Version: 2022-11-28','repos/09millarda/agents-assemble/actions/workflows/local-deployment-bridge.yml/dispatches','--method','POST','--input','-']);let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('close',c=>c?reject(Error(err)):resolve(JSON.parse(out)));p.stdin.end(JSON.stringify(request));});
});
const policy=JSON.parse(readFileSync('dist/policy.json'));
await db.query('INSERT INTO execution.dispatches VALUES($1,$2,$3,$4)',[String(r.workflow_run_id),effect,e.digest,policy.workflowSha]);
appendFileSync('dist/dispatches.jsonl',JSON.stringify({effect,phase:'registered',...r})+'\n');await db.end();console.log(JSON.stringify(r));
