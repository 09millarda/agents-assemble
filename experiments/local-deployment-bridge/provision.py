"""Fresh, receipted five-role local-controller fixture. Never creates GitHub AWS trust."""
from permissions import *
import sys
PREFIX='aa-wf15l'
STATE=ROOT/'dist/resources.json'
OLD=ROOT.parent/'lambda-deployment'
def save(s):STATE.write_text(json.dumps(s,indent=2)+'\n')
def absent(args,marker):
    try:aws(*args)
    except RuntimeError as e:
        if marker not in str(e):raise
    else:raise RuntimeError('Target already exists: '+str(args))
def template(env,artifact):
    t=json.loads((OLD/'templates'/f'{env}-baseline.json').read_text().replace('aa-wf15','aa-wf15l'))
    t['Resources']['Function']['Properties']['Code']={k:artifact[v] for k,v in [('S3Bucket','bucket'),('S3Key','key'),('S3ObjectVersion','version')]}
    t['Resources']['Function']['Properties']['Description']=artifact['sha256']
    key=next(k for k,v in t['Resources'].items() if v['Type']=='AWS::Lambda::Version')
    v=t['Resources'].pop(key);v['Properties']['CodeSha256']=base64.b64encode(bytes.fromhex(artifact['sha256'])).decode()
    new='FunctionVersion'+artifact['sha256'][:10];t['Resources'][new]=v
    t['Resources']['FunctionAliaslive']['Properties']['FunctionVersion']={'Fn::GetAtt':[new,'Version']}
    return t
def values(env,a):return [{'ParameterKey':k,'ParameterValue':v} for k,v in {
    'Environment':env,'ArtifactBucket':BUCKET,'ArtifactKey':a['key'],'ArtifactVersion':a['version'],'ArtifactSha256':a['sha256']}.items()]
phase=sys.argv[1]
identity=aws('sts','get-caller-identity');assert identity['Account']==ACCOUNT
if phase=='prepare':
    assert not STATE.exists(),'Reconcile existing receipt; do not provision again'
    for e in ['staging','prod']:
        for kind in ['runtime','cloudformation']:absent(['iam','get-role','--role-name',f'{PREFIX}-{e}-{kind}'],'(NoSuchEntity)')
        absent(['cloudformation','describe-stacks','--stack-name',f'{PREFIX}-{e}'],'does not exist')
    absent(['iam','get-role','--role-name',PREFIX+'-controller'],'(NoSuchEntity)')
    absent(['s3api','head-bucket','--bucket',BUCKET],'(404)')
    s={'account':ACCOUNT,'region':REGION,'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'bucket':BUCKET,'roles':[],'stacks':{},'artifacts':{}}
    save(s)
    aws('s3api','create-bucket','--bucket',BUCKET,'--create-bucket-configuration',json.dumps({'LocationConstraint':REGION}))
    s['bucket_created']=True;save(s)
    aws('s3api','put-public-access-block','--bucket',BUCKET,'--public-access-block-configuration',json.dumps({k:True for k in ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']}))
    aws('s3api','put-bucket-versioning','--bucket',BUCKET,'--versioning-configuration','Status=Enabled')
    aws('s3api','put-bucket-encryption','--bucket',BUCKET,'--server-side-encryption-configuration',json.dumps({'Rules':[{'ApplyServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]}))
    registry=json.loads((OLD/'releases.json').read_text())
    for name,file in [('baseline','healthy.zip'),('healthy','release-healthy.zip'),('unhealthy','release-unhealthy.zip')]:
        path=OLD/'dist'/file;data=path.read_bytes();h=hashlib.sha256(data).hexdigest();assert h==registry['artifacts'][name]['sha256']
        key=f'releases/{h}/function.zip';checksum=base64.b64encode(bytes.fromhex(h)).decode()
        response=aws('s3api','put-object','--bucket',BUCKET,'--key',key,'--body',str(path),'--checksum-algorithm','SHA256','--checksum-sha256',checksum)
        assert response.get('VersionId') and response['ChecksumSHA256']==checksum
        s['artifacts'][name]={'bucket':BUCKET,'key':key,'version':response['VersionId'],'sha256':h,'bytes':len(data),'source':registry['artifacts'][name]['source']};save(s)
if phase in ['prepare','resume']:
    if phase=='resume':s=json.loads(STATE.read_text())
    for env in ['staging','prod']:
        for kind,service in [('runtime','lambda.amazonaws.com'),('cloudformation','cloudformation.amazonaws.com')]:
            name=f'{PREFIX}-{env}-{kind}'
            if name not in s['roles']:
                aws('iam','create-role','--role-name',name,'--assume-role-policy-document',json.dumps(trust(service)),'--tags',f'Key=Experiment,Value={PREFIX}')
                s['roles'].append(name);save(s)
            else:assert aws('iam','get-role','--role-name',name)['Role']['AssumeRolePolicyDocument']==trust(service)
            doc=executor(env) if kind=='cloudformation' else policy([allow(['logs:CreateLogStream','logs:PutLogEvents'],f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/{PREFIX}-{env}:*')])
            aws('iam','put-role-policy','--role-name',name,'--policy-name','FixtureOnly','--policy-document',json.dumps(doc))
        for candidate,a in s['artifacts'].items():
            (ROOT/'dist'/f'{env}-{candidate}.json').write_text(json.dumps(template(env,a),sort_keys=True,indent=2)+'\n')
        if env in s['stacks']:continue
        response=aws('cloudformation','create-change-set','--stack-name',f'{PREFIX}-{env}','--change-set-name',PREFIX+'-bootstrap','--change-set-type','CREATE',
          '--role-arn',arn(env,'cloudformation'),'--template-body','file://'+str(ROOT/'dist'/f'{env}-baseline.json'),'--parameters',json.dumps(values(env,s['artifacts']['baseline'])),
          '--tags',f'Key=Experiment,Value={PREFIX}','--client-token',f'{PREFIX}-bootstrap-{env}')
        s['stacks'][env]=response;save(s)
    print(json.dumps({'prepared':s['stacks'],'roles':s['roles'],'artifact_count':len(s['artifacts'])}))
elif phase=='execute':
    s=json.loads(STATE.read_text())
    for env,t in s['stacks'].items():
        c=aws('cloudformation','describe-change-set','--change-set-name',t['Id'])
        assert c['Status']=='CREATE_COMPLETE' and c['ExecutionStatus']=='AVAILABLE'
        assert len(c['Changes'])==7 and all(v['ResourceChange']['Action']=='Add' for v in c['Changes'])
        aws('cloudformation','execute-change-set','--change-set-name',t['Id'],'--client-request-token',f'{PREFIX}-bootstrap-{env}')
        s['stacks'][env]['executed']=True;save(s)
    print('Bootstrap execution requested')
elif phase=='ready':
    s=json.loads(STATE.read_text())
    for env,t in s['stacks'].items():
        stack=aws('cloudformation','describe-stacks','--stack-name',t['StackId'])['Stacks'][0]
        assert stack['StackStatus']=='CREATE_COMPLETE',stack['StackStatus']
        t['outputs']={v['OutputKey']:v['OutputValue'] for v in stack['Outputs']}
        doc=executor(env,False,t['outputs']['ApiId']);name=f'{PREFIX}-{env}-cloudformation'
        aws('iam','put-role-policy','--role-name',name,'--policy-name','FixtureOnly','--policy-document',json.dumps(doc))
        assert aws('iam','get-role-policy','--role-name',name,'--policy-name','FixtureOnly')['PolicyDocument']==doc
        t['narrowed']=True;save(s)
    role=aws('iam','get-role','--role-name','AccountFullAccessRole')['Role']['Arn']
    expires=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=4)).strftime('%Y-%m-%dT%H:%M:%SZ')
    trust_doc=policy([{'Effect':'Allow','Principal':{'AWS':role},'Action':'sts:AssumeRole','Condition':{'DateLessThan':{'aws:CurrentTime':expires}}}])
    name=PREFIX+'-controller';aws('iam','create-role','--role-name',name,'--assume-role-policy-document',json.dumps(trust_doc),'--tags',f'Key=Experiment,Value={PREFIX}')
    s['roles'].append(name);save(s)
    stacks=[t['StackId'] for t in s['stacks'].values()]
    fn=[f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:{PREFIX}-{env}' for env in s['stacks']]
    doc=policy([allow(['cloudformation:'+a for a in ['CreateChangeSet','ExecuteChangeSet']],stacks,Condition={'DateLessThan':{'aws:CurrentTime':expires}}),
      allow(['cloudformation:'+a for a in ['DescribeChangeSet','DescribeStacks','DescribeStackEvents','GetTemplate','ListChangeSets']],stacks),
      allow(['lambda:GetFunction','lambda:GetAlias'],fn+[f+':*' for f in fn]),allow(['s3:GetObject','s3:GetObjectVersion'],f'arn:aws:s3:::{BUCKET}/releases/*')])
    aws('iam','put-role-policy','--role-name',name,'--policy-name','FixtureOnly','--policy-document',json.dumps(doc))
    assert aws('iam','get-role-policy','--role-name',name,'--policy-name','FixtureOnly')['PolicyDocument']==doc
    s['controller_role']=f'arn:aws:iam::{ACCOUNT}:role/{name}';s['mutation_deadline']=expires;save(s)
    print(json.dumps({'ready':list(s['stacks']),'controller_role':s['controller_role'],'mutation_deadline':expires}))
else:raise RuntimeError('Unknown phase')
