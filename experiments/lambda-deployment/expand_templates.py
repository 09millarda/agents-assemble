"""Expand reviewed SAM locally; AWS receives plain CloudFormation resources."""
import importlib.metadata,json,os
from pathlib import Path
from samtranslator.translator.transform import transform

assert importlib.metadata.version('aws-sam-translator')=='1.113.0'
os.environ['AWS_DEFAULT_REGION']='eu-west-1'
root=Path(__file__).resolve().parent
registry=json.loads((root/'releases.json').read_text())
(root/'templates').mkdir(exist_ok=True)
for env in ['staging','prod']:
 for candidate,a in registry['artifacts'].items():
  parameters={'Environment':env,'ArtifactBucket':a['bucket'],'ArtifactKey':a['key'],'ArtifactVersion':a['version'],'ArtifactSha256':a['sha256']}
  result=transform(json.loads((root/'template.json').read_text()),parameters,None)
  assert 'Transform' not in result and len(result['Resources'])==7
  assert {r['Type'] for r in result['Resources'].values()}=={'AWS::Logs::LogGroup','AWS::Lambda::Function','AWS::Lambda::Version','AWS::Lambda::Alias','AWS::Lambda::Permission','AWS::ApiGatewayV2::Api','AWS::ApiGatewayV2::Stage'}
  assert result['Resources']['FunctionAliaslive']['Properties']['Name']=='live'
  (root/'templates'/f'{env}-{candidate}.json').write_text(json.dumps(result,indent=2)+'\n')
print('Six seven-resource templates expanded and inspected')
