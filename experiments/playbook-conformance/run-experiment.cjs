// THROWAWAY executable evidence for decision #6. Node 24, no packages.
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
require('./authoring.js');require('./runtime.js');require('./scenarios.js');
const authoring=Authoring.testAuthoring();
const runtime=Experiment.runAll();
const builder=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'builder.ts')],{encoding:'utf8'}));
const results={generatedAt:new Date().toISOString(),node:process.version,authoring,builder,runtime:runtime.map(({trace,...rest})=>({...rest,snapshots:trace.length,finalStatus:trace.at(-1)?.state.status}))};
fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(results,null,2)+'\n');
let html=fs.readFileSync(path.join(__dirname,'shell.html'),'utf8');
for(const [placeholder,file] of [['AUTHORING_MODULE','authoring.js'],['RUNTIME_MODULE','runtime.js'],['SCENARIOS_MODULE','scenarios.js']])html=html.replace('/* '+placeholder+' */',()=>fs.readFileSync(path.join(__dirname,file),'utf8'));
fs.writeFileSync(path.join(__dirname,'playbook-conformance.throwaway.html'),html);
if(process.argv.includes('--traces'))fs.writeFileSync(path.join(__dirname,'traces.json'),JSON.stringify(runtime));
const failed=[...authoring,...runtime].filter(r=>!r.passed);
console.log(JSON.stringify({authoring:authoring.length,runtime:runtime.length,assertions:runtime.reduce((n,r)=>n+r.assertions.length,0),builder,failures:failed.map(r=>({name:r.name,error:r.error}))},null,2));
if(failed.length)process.exitCode=1;
