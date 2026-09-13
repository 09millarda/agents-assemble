// Local gateway: no credentials returned, no arbitrary AWS/file/shell operation accepted.
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {createServer} from 'node:http';
import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
import {connect,owner} from './common.mjs';
const policy=JSON.parse(readFileSync('dist/policy.json'));const db=await connect('execution');
const issuer='https://token.actions.githubusercontent.com';const keys=createRemoteJWKSet(new URL(issuer+'/.well-known/jwks'),{timeoutDuration:5000});
const record=x=>appendFileSync('dist/gateway.jsonl',JSON.stringify({at:new Date().toISOString(),...x})+'\n');
const server=createServer(async(req,res)=>{
 const reply=(code,body)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(body));};
 if(req.method!=='POST'||!['/claim','/status'].includes(req.url))return reply(404,{error:'not-found'});
 let p;
 try{
  const token=req.headers.authorization?.replace(/^Bearer /,'');if(!token||token.length>16384)throw Error();
  ({payload:p}=await jwtVerify(token,keys,{issuer,audience:policy.audience,algorithms:['RS256'],clockTolerance:0,maxTokenAge:'10m',
   requiredClaims:['exp','nbf','iat','repository_id','repository_owner_id','sub','ref','event_name','workflow_sha','workflow_ref','sha','run_id','run_attempt']}));
  const expected={aud:policy.audience,repository_id:'1366483946',repository_owner_id:'11366827',ref:'refs/heads/main',event_name:'workflow_dispatch',
   sub:'repo:09millarda@11366827/agents-assemble@1366483946:ref:refs/heads/main',workflow_sha:policy.workflowSha,sha:policy.workflowSha,
   workflow_ref:'09millarda/agents-assemble/.github/workflows/local-deployment-bridge.yml@refs/heads/main'};
  for(const [k,v]of Object.entries(expected))if(p[k]!==v)throw Error();
 }catch{record({stage:'authentication',result:'denied'});return reply(401,{error:'unauthorized'});}
 let input;
 try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw Error();}input=JSON.parse(raw);
  if(Object.keys(input).sort().join(',')!=='digest,effect'||!/^[a-z0-9-]{1,80}$/.test(input.effect)||!/^[a-f0-9]{64}$/.test(input.digest))throw Error();
 }catch{return reply(400,{error:'invalid-input'});}
 const effect=(await db.query('SELECT * FROM execution.effects WHERE id=$1',[input.effect])).rows[0];
 const binding=(await db.query('SELECT * FROM execution.dispatches WHERE run_id=$1 AND effect=$2',[p.run_id,input.effect])).rows[0];
 if(!effect||!binding||binding.digest!==input.digest||effect.digest!==input.digest||binding.workflow_sha!==p.workflow_sha||effect.manifest.workflow_revision!==p.workflow_sha||p.run_attempt!=='1'){
  record({stage:'effect-binding',run:p.run_id,effect:input.effect,result:'denied'});return reply(403,{error:'effect-binding'});}
 if(req.url==='/status'){
  const child=(await db.query('SELECT id,state,receipt FROM execution.effects WHERE parent=$1',[effect.id])).rows[0];
  return reply(200,{effect:effect.id,state:effect.state,receipt:effect.receipt,restoration:child??null});
 }
 try{
  const result=await owner({context:'execution',op:'claim',id:effect.id,env:effect.env,manifest:effect.manifest,run:p.run_id,attempt:1,authentication_expiry:p.exp});
  record({stage:'claim',effect:effect.id,run:p.run_id,attempt:p.run_attempt,workflow:p.workflow_sha,result});
  reply(result.verdict==='claim-admitted'?202:409,result);
 }catch{record({stage:'claim',effect:effect.id,result:'outcome-unknown'});reply(503,{error:'claim-outcome-unknown',effect:effect.id});}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));writeFileSync('dist/gateway-port.txt',String(server.address().port));
console.log('Authenticated local gateway on loopback port '+server.address().port);
