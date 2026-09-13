"""One-time reconciliation of recorded pre-stack IAM-propagation failure."""
import json,time
from bootstrap import *
assert aws('sts','get-caller-identity')['Account']==ACCOUNT
state=json.loads(STATE.read_text())
for env in ['staging','prod']:
 for kind,service in [('runtime','lambda.amazonaws.com'),('cloudformation','cloudformation.amazonaws.com')]:
  name=f'aa-wf15-{env}-{kind}'
  doc=executor(env) if kind=='cloudformation' else policy([allow(['logs:CreateLogStream','logs:PutLogEvents'],f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/aa-wf15-{env}:*')])
  if name in state['roles']:
   role=aws('iam','get-role','--role-name',name)['Role'];assert role['AssumeRolePolicyDocument']==trust(service)
   assert aws('iam','get-role-policy','--role-name',name,'--policy-name','FixtureOnly')['PolicyDocument']==doc
   print('Reconciled existing '+name,flush=True)
  else:
   try:aws('iam','get-role','--role-name',name)
   except RuntimeError as e:
    if '(NoSuchEntity)' not in str(e):raise
   else:raise RuntimeError('Unrecorded role exists')
   aws('iam','create-role','--role-name',name,'--assume-role-policy-document',json.dumps(trust(service)),'--tags','Key=Experiment,Value=aa-wf15')
   state['roles'].append(name);persist(state)
   aws('iam','put-role-policy','--role-name',name,'--policy-name','FixtureOnly','--policy-document',json.dumps(doc))
   assert aws('iam','get-role-policy','--role-name',name,'--policy-name','FixtureOnly')['PolicyDocument']==doc
   print('Created and verified '+name,flush=True)
   time.sleep(10)
 if env in state['stacks']:raise RuntimeError('Already recorded change set; reconcile separately')
 try:aws('cloudformation','describe-stacks','--stack-name',f'aa-wf15-{env}')
 except RuntimeError as e:
  if 'does not exist' not in str(e):raise
 else:raise RuntimeError('Stack exists; reconcile separately')
 artifact=state['artifacts']['healthy'];values={'Environment':env,'ArtifactBucket':BUCKET,'ArtifactKey':artifact['key'],'ArtifactVersion':artifact['version'],'ArtifactSha256':artifact['sha256']}
 result=aws('cloudformation','create-change-set','--stack-name',f'aa-wf15-{env}','--change-set-name','aa-wf15-bootstrap','--change-set-type','CREATE','--role-arn',arn(env,'cloudformation'),'--template-body','file://'+str(ROOT/'template.json'),'--parameters',json.dumps([{'ParameterKey':k,'ParameterValue':v} for k,v in values.items()]),'--tags','Key=Experiment,Value=aa-wf15','--capabilities','CAPABILITY_AUTO_EXPAND','--client-token',f'aa-wf15-bootstrap-{env}')
 state['stacks'][env]=result;persist(state);print(json.dumps(result),flush=True)
