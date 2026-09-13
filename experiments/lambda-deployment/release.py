"""Throwaway GitHub OIDC -> exact-stack release probe. No deployment retries."""
import argparse, base64, hashlib, json, os, re, subprocess, time, urllib.error, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT=Path(__file__).resolve().parent
ACCOUNT='728616601473';REGION='eu-west-1'

def credentials(environment):
    url=os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']+'&audience=sts.amazonaws.com'
    request=urllib.request.Request(url,headers={'Authorization':'Bearer '+os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    with urllib.request.urlopen(request,timeout=30) as response:token=json.load(response)['value']
    data=urllib.parse.urlencode({'Action':'AssumeRoleWithWebIdentity','Version':'2011-06-15',
        'RoleArn':f'arn:aws:iam::{ACCOUNT}:role/aa-wf15-{environment}-github',
        'RoleSessionName':'github-'+os.environ['GITHUB_RUN_ID'],'DurationSeconds':'900','WebIdentityToken':token}).encode()
    with urllib.request.urlopen(f'https://sts.{REGION}.amazonaws.com/',data=data,timeout=30) as response:root=ET.fromstring(response.read())
    ns={'s':'https://sts.amazonaws.com/doc/2011-06-15/'};c=root.find('.//s:Credentials',ns)
    for field,var in [('AccessKeyId','AWS_ACCESS_KEY_ID'),('SecretAccessKey','AWS_SECRET_ACCESS_KEY'),('SessionToken','AWS_SESSION_TOKEN')]:
        os.environ[var]=c.find('s:'+field,ns).text


def aws(*args):
    p=subprocess.run(['aws',*args,'--region',REGION,'--output','json','--no-cli-pager'],capture_output=True,text=True)
    if p.returncode:raise RuntimeError(p.stderr.strip())
    return json.loads(p.stdout) if p.stdout.strip() else {}


def observe(target):
    alias=aws('lambda','get-alias','--function-name',target['outputs']['FunctionName'],'--name','live')
    function=aws('lambda','get-function','--function-name',target['outputs']['FunctionName'],'--qualifier',alias['FunctionVersion'])['Configuration']
    return {'version':alias['FunctionVersion'],'sha256':base64.b64decode(function['CodeSha256']).hex(),
        'environment':function['Environment']['Variables']['PROBE_ENVIRONMENT']}


def health(target):
    try:
        with urllib.request.urlopen(target['outputs']['HealthUrl'],timeout=15) as response: status=response.status;body=json.load(response)
    except urllib.error.HTTPError as e:status=e.code;body=json.load(e)
    return {'status':status,'body':body}


def main():
    p=argparse.ArgumentParser();p.add_argument('--environment',choices=['staging','prod'],required=True)
    p.add_argument('--candidate',choices=['healthy','unhealthy','baseline'],required=True)
    p.add_argument('--expected-prior',required=True);args=p.parse_args()
    assert re.fullmatch('[a-f0-9]{64}',args.expected_prior)
    registry=json.loads((ROOT/'releases.json').read_text());target=registry['stacks'][args.environment];artifact=registry['artifacts'][args.candidate]
    credentials(args.environment)
    identity=aws('sts','get-caller-identity');assert identity['Account']==ACCOUNT
    before=observe(target);assert before['sha256']==args.expected_prior and before['environment']==args.environment
    manifest={'target':target['StackId'],'environment':args.environment,'artifact':artifact,'expected_prior':before,
        'workflow_sha':os.environ['GITHUB_SHA'],'run_id':os.environ['GITHUB_RUN_ID'],'run_attempt':os.environ['GITHUB_RUN_ATTEMPT']}
    digest=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    print(json.dumps({'manifest':manifest,'manifest_sha256':digest}),flush=True)
    # Verify the retained uploaded object's checksum, not just caller-supplied metadata.
    head=aws('s3api','head-object','--bucket',artifact['bucket'],'--key',artifact['key'],'--version-id',artifact['version'],'--checksum-mode','ENABLED')
    assert base64.b64decode(head['ChecksumSHA256']).hex()==artifact['sha256'] and head['ContentLength']==artifact['bytes']
    effect='aa-wf15-'+os.environ['GITHUB_RUN_ID']+'-'+args.environment
    values={'Environment':args.environment,'ArtifactBucket':artifact['bucket'],'ArtifactKey':artifact['key'],
        'ArtifactVersion':artifact['version'],'ArtifactSha256':artifact['sha256']}
    result=aws('cloudformation','create-change-set','--stack-name',target['StackId'],'--change-set-name',effect,
        '--change-set-type','UPDATE','--template-body','file://'+str(ROOT/'template.json'),
        '--parameters',json.dumps([{'ParameterKey':k,'ParameterValue':v} for k,v in values.items()]),
        '--capabilities','CAPABILITY_AUTO_EXPAND','--client-token',effect,'--description','Manifest SHA256 '+digest)
    print(json.dumps({'effect':effect,'change_set':result['Id']}),flush=True)
    for _ in range(60):
        change=aws('cloudformation','describe-change-set','--change-set-name',result['Id'])
        if change['Status'] not in ['CREATE_PENDING','CREATE_IN_PROGRESS']:break
        time.sleep(3)
    assert change['Status']=='CREATE_COMPLETE',change.get('StatusReason',change['Status'])
    for c in change['Changes']:
        r=c['ResourceChange']
        assert r['ResourceType'] in ['AWS::Lambda::Function','AWS::Lambda::Version','AWS::Lambda::Alias'],r
        assert not (r['ResourceType']=='AWS::Lambda::Function' and (r['Action']!='Modify' or r.get('Replacement')!='False')),r
    print(json.dumps({'reviewed_changes':change['Changes']}),flush=True)
    # Recheck the predecessor immediately before applying a single effect.
    assert observe(target)==before
    aws('cloudformation','execute-change-set','--change-set-name',result['Id'],'--client-request-token',effect)
    for _ in range(90):
        stack=aws('cloudformation','describe-stacks','--stack-name',target['StackId'])['Stacks'][0]
        if stack['StackStatus'] not in ['UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS']:break
        time.sleep(3)
    assert stack['StackStatus']=='UPDATE_COMPLETE',stack['StackStatus']
    after=observe(target);assert after['sha256']==artifact['sha256'] and after['environment']==args.environment
    sample=health(target);assert sample['body']['release']==artifact['source'] and sample['body']['environment']==args.environment
    expected=503 if args.candidate=='unhealthy' else 200
    assert sample['status']==expected and sample['body']['healthy']==(expected==200)
    print(json.dumps({'provider_update':'confirmed','lambda':after,'health':sample,
        'application_health':'failed' if expected==503 else 'healthy',
        'manifest_sha256':digest,'effect':effect}),flush=True)
    # A known failed-health release must report failure even when the provider update worked.
    if expected==503:raise SystemExit(2)

if __name__=='__main__':main()
