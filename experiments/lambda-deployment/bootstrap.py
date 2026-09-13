"""Disposable #15 bootstrap. Exact account/resources, create-only, no blind retries."""
import argparse, base64, datetime, hashlib, json, os, subprocess, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE = ROOT / 'dist/bootstrap.json'
ACCOUNT = '728616601473'
REGION = 'eu-west-1'
BUCKET = f'aa-wf15-{ACCOUNT}-{REGION}-artifacts'
AWS = '/home/amillard98/.local/bin/aws'


def aws(*args):
    result = subprocess.run([AWS, *args, '--profile', 'agents-assemble', '--region', REGION,
        '--output', 'json', '--no-cli-pager'], capture_output=True, text=True)
    if result.returncode: raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else {}


def policy(statements): return {'Version':'2012-10-17','Statement':statements}
def allow(actions, resources, **extra): return {'Effect':'Allow','Action':actions,'Resource':resources,**extra}
def arn(env, kind): return f'arn:aws:iam::{ACCOUNT}:role/aa-wf15-{env}-{kind}'
def trust(service): return policy([{'Effect':'Allow','Principal':{'Service':service},'Action':'sts:AssumeRole'}])
def persist(state): STATE.write_text(json.dumps(state,indent=2)+'\n')

READS = ['lambda:GetFunction','lambda:GetFunctionConfiguration','lambda:GetFunctionCodeSigningConfig',
 'lambda:GetFunctionRecursionConfig','lambda:GetRuntimeManagementConfig','lambda:GetFunctionScalingConfig',
 'lambda:GetProvisionedConcurrencyConfig','lambda:ListVersionsByFunction','lambda:ListTags','lambda:GetPolicy',
 'lambda:GetAlias','lambda:ListAliases']
WRITES = ['lambda:UpdateFunctionCode','lambda:UpdateFunctionConfiguration','lambda:PublishVersion',
 'lambda:UpdateAlias','lambda:TagResource','lambda:UntagResource']


def executor(env, bootstrap=True, api_id=None):
    fn=f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:aa-wf15-{env}'
    log=f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/aa-wf15-{env}'
    statements=[allow(READS+WRITES+(['lambda:CreateFunction','lambda:DeleteFunction','lambda:CreateAlias',
        'lambda:DeleteAlias','lambda:AddPermission','lambda:RemovePermission'] if bootstrap else []),[fn,fn+':*']),
      allow(['s3:GetObject','s3:GetObjectVersion'],f'arn:aws:s3:::{BUCKET}/releases/*'),
      allow('iam:PassRole',arn(env,'runtime'),Condition={'StringEquals':{'iam:PassedToService':'lambda.amazonaws.com'}}),
      allow(['logs:DescribeLogGroups','logs:DescribeResourcePolicies'],'*'),
      allow(['logs:ListTagsForResource','logs:GetDataProtectionPolicy','logs:DescribeIndexPolicies']+
        (['logs:CreateLogGroup','logs:DeleteLogGroup','logs:PutRetentionPolicy','logs:TagResource','logs:UntagResource'] if bootstrap else []),[log,log+':*']),
      allow(['apigateway:GET','apigateway:POST','apigateway:PATCH','apigateway:PUT','apigateway:DELETE','apigateway:TagResource'] if bootstrap else ['apigateway:GET'],
        [f'arn:aws:apigateway:{REGION}::/apis',f'arn:aws:apigateway:{REGION}::/apis/*'] if bootstrap else
        [f'arn:aws:apigateway:{REGION}::/apis/{api_id}',f'arn:aws:apigateway:{REGION}::/apis/{api_id}/*'])]
    if bootstrap:
        statements.append(allow(['apigateway:POST','apigateway:GET','apigateway:DELETE'],
          f'arn:aws:apigateway:{REGION}::/tags/arn%3Aaws%3Aapigateway%3A{REGION}%3A%3A%2Fv2%2Fapis%2F*'))
    if not bootstrap:
        statements[0] = allow(READS, [fn, fn+':*'])
        statements.extend([allow([a for a in WRITES if a != 'lambda:UpdateAlias'], fn),
                           allow('lambda:UpdateAlias', fn+':live')])
    return policy(statements)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('phase',choices=['prepare','execute','narrow'])
    phase=parser.parse_args().phase
    identity=aws('sts','get-caller-identity');assert identity['Account']==ACCOUNT
    if phase=='prepare':
        if STATE.exists():raise RuntimeError('Existing receipt: reconcile before another preparation')
        # Preflight every target; any existing role/stack/bucket aborts before writes.
        for env in ['staging','prod']:
            for kind in ['runtime','cloudformation','github']:
                try:aws('iam','get-role','--role-name',f'aa-wf15-{env}-{kind}')
                except RuntimeError as e:
                    if '(NoSuchEntity)' not in str(e):raise
                else:raise RuntimeError('Role already exists')
            try:aws('cloudformation','describe-stacks','--stack-name',f'aa-wf15-{env}')
            except RuntimeError as e:
                if 'does not exist' not in str(e):raise
            else:raise RuntimeError('Stack already exists')
        try:aws('s3api','head-bucket','--bucket',BUCKET)
        except RuntimeError as e:
            if '(404)' not in str(e):raise
        else:raise RuntimeError('Bucket already exists')
        state={'account':ACCOUNT,'region':REGION,'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'bucket':BUCKET,'roles':[],'stacks':{},'artifacts':{}}
        persist(state)
        aws('s3api','create-bucket','--bucket',BUCKET,'--create-bucket-configuration',json.dumps({'LocationConstraint':REGION}))
        state['bucket_created']=True;persist(state)
        aws('s3api','put-public-access-block','--bucket',BUCKET,'--public-access-block-configuration',json.dumps({k:True for k in ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']}))
        aws('s3api','put-bucket-ownership-controls','--bucket',BUCKET,'--ownership-controls',json.dumps({'Rules':[{'ObjectOwnership':'BucketOwnerEnforced'}]}))
        aws('s3api','put-bucket-versioning','--bucket',BUCKET,'--versioning-configuration','Status=Enabled')
        aws('s3api','put-bucket-encryption','--bucket',BUCKET,'--server-side-encryption-configuration',json.dumps({'Rules':[{'ApplyServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]}))
        aws('s3api','put-bucket-tagging','--bucket',BUCKET,'--tagging',json.dumps({'TagSet':[{'Key':'Experiment','Value':'aa-wf15'}]}))
        for candidate in ['healthy','unhealthy']:
            path=ROOT/'dist'/f'{candidate}.zip';data=path.read_bytes();digest=hashlib.sha256(data).hexdigest()
            key=f'releases/{digest}/function.zip'
            upload=aws('s3api','put-object','--bucket',BUCKET,'--key',key,'--body',str(path),
                '--checksum-algorithm','SHA256','--checksum-sha256',base64.b64encode(hashlib.sha256(data).digest()).decode())
            assert upload.get('VersionId') and upload['ChecksumSHA256']==base64.b64encode(hashlib.sha256(data).digest()).decode()
            state['artifacts'][candidate]={'bucket':BUCKET,'key':key,'version':upload['VersionId'],'sha256':digest,'bytes':len(data)};persist(state)
        for env in ['staging','prod']:
            for kind,service in [('runtime','lambda.amazonaws.com'),('cloudformation','cloudformation.amazonaws.com')]:
                name=f'aa-wf15-{env}-{kind}'
                aws('iam','create-role','--role-name',name,'--assume-role-policy-document',json.dumps(trust(service)),
                    '--tags','Key=Experiment,Value=aa-wf15')
                state['roles'].append(name);persist(state)
                doc=executor(env) if kind=='cloudformation' else policy([allow(['logs:CreateLogStream','logs:PutLogEvents'],
                    f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/aa-wf15-{env}:*')])
                aws('iam','put-role-policy','--role-name',name,'--policy-name','FixtureOnly','--policy-document',json.dumps(doc))
                assert aws('iam','get-role-policy','--role-name',name,'--policy-name','FixtureOnly')['PolicyDocument']==doc
            artifact=state['artifacts']['healthy']
            values={'Environment':env,'ArtifactBucket':BUCKET,'ArtifactKey':artifact['key'],'ArtifactVersion':artifact['version'],'ArtifactSha256':artifact['sha256']}
            response=aws('cloudformation','create-change-set','--stack-name',f'aa-wf15-{env}','--change-set-name','aa-wf15-bootstrap',
                '--change-set-type','CREATE','--role-arn',arn(env,'cloudformation'),'--template-body','file://'+str(ROOT/'template.json'),
                '--parameters',json.dumps([{'ParameterKey':k,'ParameterValue':v} for k,v in values.items()]),
                '--tags','Key=Experiment,Value=aa-wf15','--capabilities','CAPABILITY_AUTO_EXPAND','--client-token',f'aa-wf15-bootstrap-{env}')
            state['stacks'][env]=response;persist(state)
            print(json.dumps({'prepared':env,**response}),flush=True)
    elif phase=='execute':
        state=json.loads(STATE.read_text())
        for env,receipt in state['stacks'].items():
            observed=aws('cloudformation','describe-change-set','--change-set-name',receipt['Id'])
            assert observed['Status']=='CREATE_COMPLETE' and observed['ExecutionStatus']=='AVAILABLE'
            changes=observed['Changes'];assert len(changes)==7 and all(c['ResourceChange']['Action']=='Add' for c in changes)
            allowed={'AWS::Logs::LogGroup','AWS::Lambda::Function','AWS::Lambda::Version','AWS::Lambda::Alias','AWS::Lambda::Permission','AWS::ApiGatewayV2::Api','AWS::ApiGatewayV2::Stage'}
            assert {c['ResourceChange']['ResourceType'] for c in changes}==allowed
            processed=aws('cloudformation','get-template','--change-set-name',receipt['Id'],'--stack-name',receipt['StackId'],'--template-stage','Processed')
            (ROOT/'dist'/f'{env}-processed.json').write_text(json.dumps(processed,indent=2)+'\n')
            aws('cloudformation','execute-change-set','--change-set-name',receipt['Id'],'--client-request-token',f'aa-wf15-bootstrap-{env}')
            state['stacks'][env]['executed']=True;persist(state)
            print('Started '+env,flush=True)
    else:
        state=json.loads(STATE.read_text())
        for env,receipt in state['stacks'].items():
            stack=aws('cloudformation','describe-stacks','--stack-name',receipt['StackId'])['Stacks'][0]
            assert stack['StackStatus']=='CREATE_COMPLETE'
            outputs={v['OutputKey']:v['OutputValue'] for v in stack['Outputs']}
            doc=executor(env,False,outputs['ApiId']);name=f'aa-wf15-{env}-cloudformation'
            aws('iam','put-role-policy','--role-name',name,'--policy-name','FixtureOnly','--policy-document',json.dumps(doc))
            assert aws('iam','get-role-policy','--role-name',name,'--policy-name','FixtureOnly')['PolicyDocument']==doc
            assert not aws('iam','list-attached-role-policies','--role-name',name)['AttachedPolicies']
            state['stacks'][env]['outputs']=outputs;state['stacks'][env]['narrowed']=True;persist(state)
            print('Verified narrow executor '+env,flush=True)

if __name__=='__main__':main()
