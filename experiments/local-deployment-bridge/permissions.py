"""Disposable #15 bootstrap. Exact account/resources, create-only, no blind retries."""
import argparse, base64, datetime, hashlib, json, os, subprocess, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE = ROOT / 'dist/bootstrap.json'
ACCOUNT = '728616601473'
REGION = 'eu-west-1'
BUCKET = f'aa-wf15l-{ACCOUNT}-{REGION}-artifacts'
AWS = '/home/amillard98/.local/bin/aws'


def aws(*args):
    result = subprocess.run([AWS, *args, '--profile', 'agents-assemble', '--region', REGION,
        '--output', 'json', '--no-cli-pager'], capture_output=True, text=True)
    if result.returncode: raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else {}


def policy(statements): return {'Version':'2012-10-17','Statement':statements}
def allow(actions, resources, **extra): return {'Effect':'Allow','Action':actions,'Resource':resources,**extra}
def arn(env, kind): return f'arn:aws:iam::{ACCOUNT}:role/aa-wf15l-{env}-{kind}'
def trust(service): return policy([{'Effect':'Allow','Principal':{'Service':service},'Action':'sts:AssumeRole'}])
def persist(state): STATE.write_text(json.dumps(state,indent=2)+'\n')

READS = ['lambda:GetFunction','lambda:GetFunctionConfiguration','lambda:GetFunctionCodeSigningConfig',
 'lambda:GetFunctionRecursionConfig','lambda:GetRuntimeManagementConfig','lambda:GetFunctionScalingConfig',
 'lambda:GetProvisionedConcurrencyConfig','lambda:ListVersionsByFunction','lambda:ListTags','lambda:GetPolicy',
 'lambda:GetAlias','lambda:ListAliases']
WRITES = ['lambda:UpdateFunctionCode','lambda:UpdateFunctionConfiguration','lambda:PublishVersion',
 'lambda:UpdateAlias','lambda:TagResource','lambda:UntagResource']


def executor(env, bootstrap=True, api_id=None):
    fn=f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:aa-wf15l-{env}'
    log=f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/aa-wf15l-{env}'
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
                           allow('lambda:UpdateAlias', fn)])
    return policy(statements)

