"""Delete only the receipted disposable fixture after all workflow runs finish."""
import json,time
from bootstrap import *
from connect_identity import trust

state=json.loads(STATE.read_text());assert aws('sts','get-caller-identity')['Account']==ACCOUNT
# Revoke CI's identity permissions before permitting destructive stack cleanup.
for env in ['staging','prod']:
 name=f'aa-wf15-{env}-github';deny=policy([{'Effect':'Deny','Action':'*','Resource':'*'}])
 aws('iam','put-role-policy','--role-name',name,'--policy-name','FixtureOnly','--policy-document',json.dumps(deny))
 aws('iam','update-assume-role-policy','--role-name',name,'--policy-document',json.dumps(trust('2000-01-01T00:00:00Z')))
 assert aws('iam','get-role-policy','--role-name',name,'--policy-name','FixtureOnly')['PolicyDocument']==deny
 print('Revoked test deployment grant '+env,flush=True)

for env,t in state['stacks'].items():
 fn=f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:aa-wf15-{env}'
 log=f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/aa-wf15-{env}'
 api=t['outputs']['ApiId'];doc=policy([
  allow(READS+['lambda:DeleteFunction','lambda:DeleteAlias','lambda:RemovePermission'],[fn,fn+':*']),
  allow(['apigateway:GET','apigateway:DELETE'],[f'arn:aws:apigateway:{REGION}::/apis/{api}',f'arn:aws:apigateway:{REGION}::/apis/{api}/*',f'arn:aws:apigateway:{REGION}::/tags/arn%3Aaws%3Aapigateway%3A{REGION}%3A%3A%2Fv2%2Fapis%2F{api}*']),
  allow(['logs:DescribeLogGroups','logs:DescribeResourcePolicies'],'*'),
  allow(['logs:DeleteLogGroup','logs:ListTagsForResource','logs:GetDataProtectionPolicy','logs:DescribeIndexPolicies'],[log,log+':*'])])
 name=f'aa-wf15-{env}-cloudformation'
 aws('iam','put-role-policy','--role-name',name,'--policy-name','FixtureOnly','--policy-document',json.dumps(doc))
 assert aws('iam','get-role-policy','--role-name',name,'--policy-name','FixtureOnly')['PolicyDocument']==doc
 aws('cloudformation','delete-stack','--stack-name',t['StackId'],'--client-request-token',f'aa-wf15-final-cleanup-{env}')
 print('Requested stack cleanup '+env,flush=True)

for env,t in state['stacks'].items():
 for _ in range(90):
  try:stack=aws('cloudformation','describe-stacks','--stack-name',t['StackId'])['Stacks'][0]
  except RuntimeError as e:
   if 'does not exist' not in str(e):raise
   break
  if stack['StackStatus']=='DELETE_COMPLETE':break
  if stack['StackStatus']!='DELETE_IN_PROGRESS':raise RuntimeError(stack['StackStatus'])
  time.sleep(3)
 else:raise RuntimeError('Stack cleanup still pending')
 # Lambda function deletion removes its versions; verify the base is gone.
 try:aws('lambda','get-function','--function-name',f'aa-wf15-{env}')
 except RuntimeError as e:
  if '(ResourceNotFoundException)' not in str(e):raise
 else:raise RuntimeError('Function still exists')
 print('Verified stack/function removed '+env,flush=True)

versions=aws('s3api','list-object-versions','--bucket',BUCKET)
objects=[{'Key':v['Key'],'VersionId':v['VersionId']} for key in ['Versions','DeleteMarkers'] for v in versions.get(key,[])]
expected={(a['key'],a['version']) for group in ['artifacts','release_artifacts'] for a in state[group].values()}
assert all((v['Key'],v['VersionId']) in expected for v in objects),'Unexpected object: stop for reconciliation'
if objects:
 response=aws('s3api','delete-objects','--bucket',BUCKET,'--delete',json.dumps({'Objects':objects,'Quiet':False}))
 assert not response.get('Errors'),response
remaining=aws('s3api','list-object-versions','--bucket',BUCKET)
assert not remaining.get('Versions') and not remaining.get('DeleteMarkers')
aws('s3api','delete-bucket','--bucket',BUCKET)
for name in state['roles']:
 assert name.startswith('aa-wf15-')
 assert aws('iam','list-role-policies','--role-name',name)['PolicyNames']==['FixtureOnly']
 assert not aws('iam','list-attached-role-policies','--role-name',name)['AttachedPolicies']
 aws('iam','delete-role-policy','--role-name',name,'--policy-name','FixtureOnly')
 aws('iam','delete-role','--role-name',name)
print('Removed artifact bucket/all versions and six fixture roles; existing OIDC provider/identity probe retained',flush=True)
state['cleanup_completed_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();persist(state)
