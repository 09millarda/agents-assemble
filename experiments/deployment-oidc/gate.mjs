// THROWAWAY: real GitHub OIDC verification; seeded authority and local process boundary.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import pg from 'pg';
const issuer = 'https://token.actions.githubusercontent.com';
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`), {timeoutDuration:5000});
const allowlist = ['iss','aud','sub','repository_id','repository_owner_id','ref','sha','event_name','workflow_ref','workflow_sha','run_id','run_attempt','iat','nbf','exp'];
export async function verify(token, policy) {
  if (typeof token !== 'string' || token.length > 16384) throw Error('invalid-token');
  const {payload,protectedHeader} = await jwtVerify(token,jwks,{issuer,audience:policy.audience,algorithms:['RS256'],
    requiredClaims:allowlist,clockTolerance:0,maxTokenAge:'10m'});
  if (typeof protectedHeader.kid !== 'string') throw Error('missing-key-id');
  if (payload.aud !== policy.audience) throw Error('audience-must-be-exact-scalar');
  const expected = {repository_id:'1366483946',repository_owner_id:'11366827',ref:'refs/heads/main',event_name:'workflow_dispatch',
    sub:'repo:09millarda@11366827/agents-assemble@1366483946:ref:refs/heads/main',
    workflow_ref:'09millarda/agents-assemble/.github/workflows/deployment-oidc-claim-probe.yml@refs/heads/main',
    workflow_sha:policy.workflowSha,sha:policy.workflowSha,run_id:policy.runId,run_attempt:policy.attempt,...policy.override};
  for (const [key,value] of Object.entries(expected)) if (payload[key] !== value) throw Error('execution-policy-mismatch');
  return Object.fromEntries(allowlist.map(key => [key,payload[key]]));
}
export async function worker(command) {
  return new Promise((resolve,reject) => {
    const child = spawn(process.execPath,['../deployment-authority/worker.mjs',JSON.stringify(command)],{
      // Worker receives database connection only, never the OIDC request credential/JWT.
      env:Object.fromEntries(['PATH','PGHOST','PGPORT','PGDATABASE'].map(k=>[k,process.env[k]]))});
    let output='',error='';
    child.stdout.on('data',x=>output+=x);
    child.stderr.on('data',x=>error+=x);
    child.on('error',reject);
    child.on('close',code=>code===0 && !error ? resolve(JSON.parse(output)) : reject(Error('worker-failed')));
  });
}
export async function startGate(policy) {
  const db = new pg.Client({user:'aa_execution',password:'throwaway'});
  await db.connect();
  const observations=[];
  const server=createServer(async (req,res)=>{
    const respond=(status,result)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));};
    if(req.method!=='POST'||req.url!=='/claim') return respond(404,{error:'not-found'});
    let claims;
    try {claims=await verify(req.headers.authorization?.replace(/^Bearer /,''),policy);}
    catch {observations.push({stage:'authentication',verdict:'rejected'});return respond(401,{error:'unauthorized'});}
    let body='';
    try {
      for await(const chunk of req){body+=chunk; if(Buffer.byteLength(body)>4096) throw Error('too-large');}
      const input=JSON.parse(body);
      if(Object.keys(input).sort().join(',')!=='digest,effect' || !/^[a-z0-9-]{1,80}$/.test(input.effect)
        || !/^[a-f0-9]{64}$/.test(input.digest)) throw Error('invalid-input');
      const effect=(await db.query('SELECT * FROM execution.effects WHERE id=$1',[input.effect])).rows[0];
      if(!effect || input.digest!==effect.digest){observations.push({stage:'binding',verdict:'rejected'});return respond(409,{error:'manifest-mismatch'});}
      if(effect.manifest.workflow_revision!==claims.workflow_sha){observations.push({stage:'effect-workflow-binding',verdict:'rejected'});return respond(409,{error:'effect-workflow-mismatch'});}
      // Complete manifest/environment come from the accepted owner record, not caller fields.
      const result=await worker({context:'execution',op:'claim',id:effect.id,env:effect.env,manifest:effect.manifest,
        run:claims.run_id,attempt:Number(claims.run_attempt)});
      observations.push({stage:'claim',effect:effect.id,claims,result});
      return respond(result.verdict==='claim-admitted'?201:409,result);
    } catch {observations.push({stage:'input',verdict:'rejected'});return respond(400,{error:'invalid-request'});}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}/claim`,observations,
    close:async()=>{await new Promise(resolve=>server.close(resolve));await db.end();}};
}
