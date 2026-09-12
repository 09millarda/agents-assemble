// THROWAWAY loopback transport. Actor headers are trusted fixtures, not authentication.
import http from 'node:http';
import pg from 'pg';
import {hash,initial,source,newRun,execution} from './model.mjs';
const pools=Object.fromEntries(['knowledge','catalog','execution'].map(role=>[role,new pg.Pool({user:role})]));
const server=http.createServer(async(req,res)=>{
 let client;
 try {
  let raw='';for await(const chunk of req)raw+=chunk;
  const {ctx,doc,op,id,...args}=JSON.parse(raw),actor=req.headers['x-actor'];
  if(!['alice','bob','agent','carol','dave','eve'].includes(actor)){res.writeHead(403);res.end('{}');return;}
  if(!pools[ctx])throw Error('unknown context');
  client=await pools[ctx].connect();await client.query('BEGIN');
  await client.query('INSERT INTO state(id,body) VALUES($1,$2) ON CONFLICT DO NOTHING',[doc,ctx==='execution'?newRun(args.source??'knowledge/spec'):initial()]);
  const row=(await client.query('SELECT body FROM state WHERE id=$1 FOR UPDATE',[doc])).rows[0];
  const payload={doc,op,id,...args,owner:ctx},digest=hash({actor,...payload});
  const previous=(await client.query('SELECT digest,verdict FROM inbox WHERE scope=$1 AND id=$2',[doc,id])).rows[0];
  let verdict;
  if(previous)verdict=previous.digest===digest?previous.verdict:{status:'identity_conflict'};
  else {
   verdict=ctx==='execution'?execution(row.body,op,args):source(row.body,op,payload,actor);
   await client.query('UPDATE state SET body=$2 WHERE id=$1',[doc,row.body]);
   await client.query('INSERT INTO inbox(scope,id,digest,verdict) VALUES($1,$2,$3,$4)',[doc,id,digest,verdict]);
  }
  // Actual process death at transaction boundaries, requested by fixture controller.
  if(req.headers['x-fault']==='before-commit')process.kill(process.pid,'SIGKILL');
  await client.query('COMMIT');
  if(req.headers['x-fault']==='after-commit')process.kill(process.pid,'SIGKILL');
  res.setHeader('content-type','application/json');res.end(JSON.stringify(verdict));
 }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});res.writeHead(500);res.end(JSON.stringify({error:e.message}));}
 finally{client?.release();}
});
server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
