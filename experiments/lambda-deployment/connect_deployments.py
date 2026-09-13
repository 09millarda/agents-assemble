"""Create two finite GitHub grants only after verifying narrowed CF executors."""
import datetime,json
from bootstrap import ROOT,STATE,ACCOUNT,REGION,BUCKET,aws,allow,policy,executor
from connect_identity import trust

state=json.loads(STATE.read_text())
assert aws('sts','get-caller-identity')['Account']==ACCOUNT
expires=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ')
for env,target in state['stacks'].items():
 assert target.get('narrowed')
 cf_name=f'aa-wf15-{env}-cloudformation'
 assert aws('iam','get-role-policy','--role-name',cf_name,'--policy-name','FixtureOnly')['PolicyDocument']==executor(env,False,target['outputs']['ApiId'])
 assert not aws('iam','list-attached-role-policies','--role-name',cf_name)['AttachedPolicies']
 name=f'aa-wf15-{env}-github'
 try:aws('iam','get-role','--role-name',name)
 except RuntimeError as e:
  if '(NoSuchEntity)' not in str(e):raise
 else:raise RuntimeError('Role exists; reconcile before continuing')
 stack_actions=['cloudformation:'+a for a in ['CreateChangeSet','DescribeChangeSet','ExecuteChangeSet','DeleteChangeSet',
  'DescribeStacks','DescribeStackEvents','DescribeStackResources','ListStackResources','ListChangeSets','GetTemplate']]
 function=f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:aa-wf15-{env}'
 doc=policy([allow(stack_actions,[target['StackId'],f'arn:aws:cloudformation:{REGION}:{ACCOUNT}:changeSet/aa-wf15-*-{env}/*']),
  allow(['s3:GetObject','s3:GetObjectVersion'],f'arn:aws:s3:::{BUCKET}/releases/*'),
  allow(['lambda:GetAlias','lambda:GetFunction'],[function,function+':*'])])
 aws('iam','create-role','--role-name',name,'--assume-role-policy-document',json.dumps(trust('2000-01-01T00:00:00Z')),
  '--max-session-duration','3600','--tags','Key=Experiment,Value=aa-wf15')
 state['roles'].append(name);STATE.write_text(json.dumps(state,indent=2)+'\n')
 aws('iam','put-role-policy','--role-name',name,'--policy-name','FixtureOnly','--policy-document',json.dumps(doc))
 assert aws('iam','get-role-policy','--role-name',name,'--policy-name','FixtureOnly')['PolicyDocument']==doc
 assert not aws('iam','list-attached-role-policies','--role-name',name)['AttachedPolicies']
 aws('iam','update-assume-role-policy','--role-name',name,'--policy-document',json.dumps(trust(expires)))
 state['stacks'][env]['github_trust_expires']=expires;STATE.write_text(json.dumps(state,indent=2)+'\n')
 print(json.dumps({'enabled':name,'expires':expires,'stack':target['StackId']}),flush=True)
