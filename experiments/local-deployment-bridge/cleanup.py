"""Delete only this fresh receipted fixture after preserving provider/owner evidence."""
from permissions import *
STATE=ROOT/'dist/resources.json';PREFIX='aa-wf15l'
s=json.loads(STATE.read_text());assert aws('sts','get-caller-identity')['Account']==ACCOUNT
controller=PREFIX+'-controller'
if controller in s['roles']:
    aws('iam','put-role-policy','--role-name',controller,'--policy-name','FixtureOnly','--policy-document',json.dumps(policy([{'Effect':'Deny','Action':'*','Resource':'*'}])))
for env,t in s['stacks'].items():
    api=t.get('outputs',{}).get('ApiId')
    if api and '--resume' not in os.sys.argv:
        fn=f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:{PREFIX}-{env}';log=f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/{PREFIX}-{env}'
        doc=policy([allow(READS+['lambda:DeleteFunction','lambda:DeleteAlias','lambda:RemovePermission'],[fn,fn+':*']),
          allow(['apigateway:GET','apigateway:DELETE'],[f'arn:aws:apigateway:{REGION}::/apis/{api}',f'arn:aws:apigateway:{REGION}::/apis/{api}/*',f'arn:aws:apigateway:{REGION}::/tags/arn%3Aaws%3Aapigateway%3A{REGION}%3A%3A%2Fv2%2Fapis%2F{api}*']),
          allow(['logs:DescribeLogGroups','logs:DescribeResourcePolicies'],'*'),allow(['logs:DeleteLogGroup','logs:ListTagsForResource','logs:GetDataProtectionPolicy','logs:DescribeIndexPolicies'],[log,log+':*'])])
        aws('iam','put-role-policy','--role-name',f'{PREFIX}-{env}-cloudformation','--policy-name','FixtureOnly','--policy-document',json.dumps(doc))
    aws('cloudformation','delete-stack','--stack-name',t['StackId'],'--client-request-token',f'{PREFIX}-cleanup-resume-{env}' if '--resume' in os.sys.argv else f'{PREFIX}-cleanup-{env}')
    print('Cleanup requested '+env,flush=True)
for env,t in s['stacks'].items():
    for _ in range(90):
        try:x=aws('cloudformation','describe-stacks','--stack-name',t['StackId'])['Stacks'][0]
        except RuntimeError as e:
            if 'does not exist' not in str(e):raise
            break
        if x['StackStatus']=='DELETE_COMPLETE':break
        assert x['StackStatus']=='DELETE_IN_PROGRESS',x['StackStatus']
        time.sleep(3)
    else:raise RuntimeError('Cleanup pending; preserve receipt')
    try:aws('lambda','get-function','--function-name',f'{PREFIX}-{env}')
    except RuntimeError as e:
        if '(ResourceNotFoundException)' not in str(e):raise
    else:raise RuntimeError('Function remains')
objects=aws('s3api','list-object-versions','--bucket',BUCKET)
versions=[{'Key':x['Key'],'VersionId':x['VersionId']} for k in ['Versions','DeleteMarkers'] for x in objects.get(k,[])]
expected={(a['key'],a['version']) for a in s['artifacts'].values()}
assert all((x['Key'],x['VersionId']) in expected for x in versions),'Uninventoried object; do not delete'
if versions:assert not aws('s3api','delete-objects','--bucket',BUCKET,'--delete',json.dumps({'Objects':versions})).get('Errors')
aws('s3api','delete-bucket','--bucket',BUCKET)
for role in s['roles']:
    assert role.startswith(PREFIX+'-')
    assert aws('iam','list-role-policies','--role-name',role)['PolicyNames']==['FixtureOnly']
    assert not aws('iam','list-attached-role-policies','--role-name',role)['AttachedPolicies']
    aws('iam','delete-role-policy','--role-name',role,'--policy-name','FixtureOnly');aws('iam','delete-role','--role-name',role)
s['cleanup_completed_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();STATE.write_text(json.dumps(s,indent=2)+'\n')
print('Deleted both workloads, three artifact versions/bucket and five local-fixture roles',flush=True)
