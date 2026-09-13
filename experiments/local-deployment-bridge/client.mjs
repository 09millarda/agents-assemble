// Trusted GitHub client: only a signed identity and registered effect/digest cross the gateway.
const base=process.env.BRIDGE_URL;const input={effect:process.env.EFFECT_ID,digest:process.env.MANIFEST_DIGEST};
if(!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(base)||!/^[a-f0-9]{64}$/.test(input.digest))throw Error('invalid dispatch');
let token,expires=0;
async function bearer(){if(Date.now()<expires)return token;const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);url.searchParams.set('audience','urn:agents-assemble:local-bridge:aa-wf15l');
 const r=await fetch(url,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});if(!r.ok)throw Error('issuer unavailable');token=(await r.json()).value;expires=Date.now()+60000;return token;}
async function call(path,body=input,auth=true){const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(auth?{Authorization:'Bearer '+await bearer()}:{})},body:JSON.stringify(body)});let b;try{b=await response.json();}catch{b={error:'non-json-response'};}return {status:response.status,body:b};}
// Registration is completed locally from the dispatch response before this initial bounded wait ends.
await new Promise(r=>setTimeout(r,10000));
const unauth=await call('/claim',input,false);if(unauth.status!==401)throw Error('unauthenticated request not rejected');
const changed=await call('/claim',{...input,digest:'0'.repeat(64)});if(changed.status!==403)throw Error('changed digest not rejected');
const result=await call('/claim');console.log('AA_LOCAL_CLAIM='+JSON.stringify({effect:input.effect,...result}));
if(process.env.EXPECT_DENIED==='true'){
 if(![403,409].includes(result.status))throw Error('expected denial');
 console.log('AA_LOCAL_RESULT='+JSON.stringify({effect:input.effect,denied:true,result}));
}else{
 if(![202,409,503].includes(result.status))throw Error('claim failed');
 for(let i=0;i<180;i++){
  const status=await call('/status');if(status.status!==200)throw Error('status denied');
  const x=status.body;
  if(x.state==='succeeded'||(x.state==='failed'&&x.restoration?.state==='succeeded')){
   console.log('AA_LOCAL_RESULT='+JSON.stringify(x));process.exit(0);
  }
  await new Promise(r=>setTimeout(r,3000));
 }
 throw Error('outcome still unresolved; do not redispatch');
}
