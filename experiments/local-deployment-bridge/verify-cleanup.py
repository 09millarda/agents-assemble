from permissions import *
s=json.loads((ROOT/'dist/resources.json').read_text());assert s.get('cleanup_completed_at'); assert aws('sts','get-caller-identity')['Account']==ACCOUNT
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'account':ACCOUNT,'checks':{}}
def absent(name,args,error):
 try:aws(*args)
 except RuntimeError as e:
  assert error in str(e),str(e)
  result['checks'][name]='absent'
 else:raise AssertionError(name+' remains')
for env,t in s['stacks'].items():
 st=aws('cloudformation','describe-stacks','--stack-name',t['StackId'])['Stacks'][0]['StackStatus'];assert st=='DELETE_COMPLETE';result['checks'][env+'-stack']=st
 absent(env+'-function',['lambda','get-function','--function-name','aa-wf15l-'+env],'ResourceNotFoundException')
 absent(env+'-api',['apigatewayv2','get-api','--api-id',t['outputs']['ApiId']],'NotFoundException')
 groups=aws('logs','describe-log-groups','--log-group-name-prefix','/aws/lambda/aa-wf15l-'+env)['logGroups'];assert not groups;result['checks'][env+'-logs']='absent'
absent('bucket',['s3api','list-object-versions','--bucket',s['bucket']],'NoSuchBucket')
for role in s['roles']:absent(role,['iam','get-role','--role-name',role],'NoSuchEntity')
# Retire the separately inventoried identity-only probe; preserve account-wide OIDC provider.
role='aa-wf15-identity-check'
info=aws('iam','get-role','--role-name',role)['Role']
policies=aws('iam','list-role-policies','--role-name',role)['PolicyNames'];assert policies==['IdentityOnly']
assert not aws('iam','list-attached-role-policies','--role-name',role)['AttachedPolicies']
doc=aws('iam','get-role-policy','--role-name',role,'--policy-name','IdentityOnly')['PolicyDocument']
assert doc['Statement']==[{'Effect':'Deny','NotAction':'sts:GetCallerIdentity','Resource':'*'}],doc
result['identity_probe_before_removal']={'arn':info['Arn'],'trust':info['AssumeRolePolicyDocument'],'policy':doc}
aws('iam','delete-role-policy','--role-name',role,'--policy-name','IdentityOnly');aws('iam','delete-role','--role-name',role)
absent(role,['iam','get-role','--role-name',role],'NoSuchEntity')
result['retained']='Account-wide GitHub OIDC provider and existing local AWS sign-in/profile; no experiment workloads remain.'
(ROOT/'evidence/cleanup-verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result['checks']),flush=True)
