import pg from 'pg';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
export const runtime=JSON.parse(readFileSync(new URL('./dist/runtime.json',import.meta.url)));
export const resources=()=>JSON.parse(readFileSync(new URL('./dist/resources.json',import.meta.url)));
export const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
export const bytesDigest=x=>createHash('sha256').update(x).digest('hex');
export async function connect(owner='postgres') {const c=new pg.Client({host:runtime.PGHOST,port:Number(runtime.PGPORT),database:runtime.PGDATABASE,user:owner==='postgres'?owner:'aa_'+owner,password:'throwaway'});await c.connect();return c;}
export function command(file,args=[],extraEnv={}) {return new Promise((resolve,reject)=>{
 const c=spawn(file,args,{env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',...runtime,...extraEnv}});let out='',err='';
 c.stdout.on('data',x=>out+=x);c.stderr.on('data',x=>err+=x);c.on('error',reject);c.on('close',(code,signal)=>resolve({code,signal,out,err}));
});}
export async function owner(c){const r=await command(process.execPath,['owner.mjs',JSON.stringify(c)]);if(r.code!==0)throw Error('owner-outcome-unknown');return JSON.parse(r.out);}
export const wait=ms=>new Promise(r=>setTimeout(r,ms));
