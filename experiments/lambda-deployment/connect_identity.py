#!/usr/bin/env python3
"""Authenticated CLI bootstrap for decision 15. Default: print plan, no AWS calls."""
import argparse
import datetime as dt
import json
import os
import subprocess
import sys

ACCOUNT = '728616601473'
ROLE = 'aa-wf15-identity-check'
PROVIDER = f'arn:aws:iam::{ACCOUNT}:oidc-provider/token.actions.githubusercontent.com'
SUBJECT = 'repo:09millarda@11366827/agents-assemble@1366483946:ref:refs/heads/main'
POLICY = {'Version': '2012-10-17', 'Statement': [{
    'Effect': 'Deny', 'NotAction': 'sts:GetCallerIdentity', 'Resource': '*'}]}


def aws(*args, optional=False):
    result = subprocess.run(['aws', *args, '--region', 'eu-west-1',
                             '--output', 'json', '--no-cli-pager'],
                            env={**os.environ, 'AWS_PAGER': '', 'AWS_CLI_AUTO_PROMPT': 'off'},
                            capture_output=True, text=True)
    if result.returncode:
        if optional and '(NoSuchEntity)' in result.stderr:
            return None
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else {}


def trust(expires):
    return {'Version': '2012-10-17', 'Statement': [{
        'Effect': 'Allow', 'Principal': {'Federated': PROVIDER},
        'Action': 'sts:AssumeRoleWithWebIdentity',
        'Condition': {
            'StringEquals': {'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                             'token.actions.githubusercontent.com:sub': SUBJECT},
            'DateLessThan': {'aws:CurrentTime': expires}}}]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Create the described IAM connection')
    args = parser.parse_args()
    expires = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ')
    print(json.dumps({'account': ACCOUNT, 'role': ROLE, 'provider': PROVIDER,
                     'provider_action': 'Reuse unchanged if present; create if absent',
                     'trust': trust(expires), 'inline_policy': POLICY,
                     'scope': 'Identity only; no Lambda, S3, deployment, or IAM access',
                     'cleanup': 'Delete role inline policy, then role. Retain shared provider.'}, indent=2))
    if not args.apply:
        print('Plan only. Pass --apply with an authenticated AWS CLI profile to create this connection.')
        return
    identity = aws('sts', 'get-caller-identity')
    if identity['Account'] != ACCOUNT:
        raise RuntimeError('Wrong AWS account; no changes made.')
    # Never overwrite an existing role, including a partly completed previous attempt.
    if aws('iam', 'get-role', '--role-name', ROLE, optional=True) is not None:
        raise RuntimeError('Role already exists; no changes made. Report this output for reconciliation.')
    provider = aws('iam', 'get-open-id-connect-provider', '--open-id-connect-provider-arn',
                   PROVIDER, optional=True)
    if provider is not None:
        if provider['Url'].removeprefix('https://') != 'token.actions.githubusercontent.com' or 'sts.amazonaws.com' not in provider['ClientIDList']:
            raise RuntimeError('Existing provider is incompatible; no changes made. Shared provider will not be modified.')
        print('Reusing existing provider unchanged.')
    else:
        created = aws('iam', 'create-open-id-connect-provider', '--url',
                      'https://token.actions.githubusercontent.com', '--client-id-list',
                      'sts.amazonaws.com', '--tags', 'Key=Experiment,Value=aa-wf15')
        if created['OpenIDConnectProviderArn'] != PROVIDER:
            raise RuntimeError('Unexpected created provider ARN; stop and reconcile.')
        print('Created provider: ' + PROVIDER, flush=True)
    # Keep trust expired until the explicit deny policy is installed and verified.
    aws('iam', 'create-role', '--role-name', ROLE, '--assume-role-policy-document',
        json.dumps(trust('2000-01-01T00:00:00Z')), '--max-session-duration', '3600',
        '--description', 'Disposable decision 15 identity-only GitHub connection',
        '--tags', 'Key=Experiment,Value=aa-wf15')
    print('Created role with inactive trust: ' + ROLE, flush=True)
    aws('iam', 'put-role-policy', '--role-name', ROLE, '--policy-name', 'IdentityOnly',
        '--policy-document', json.dumps(POLICY))
    observed = aws('iam', 'get-role-policy', '--role-name', ROLE, '--policy-name', 'IdentityOnly')
    if observed['PolicyDocument'] != POLICY:
        raise RuntimeError('Policy verification failed; trust remains inactive. Stop and reconcile.')
    aws('iam', 'update-assume-role-policy', '--role-name', ROLE,
        '--policy-document', json.dumps(trust(expires)))
    print(json.dumps({'status': 'connection_created', 'role_arn': f'arn:aws:iam::{ACCOUNT}:role/{ROLE}',
                     'trust_expires_at': expires, 'github_aws_verification': 'pending'}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError) as error:
        print('STOP: ' + str(error), file=sys.stderr)
        print('Earlier successful creates, if any, remain. Do not blindly repeat; report the error for reconciliation.', file=sys.stderr)
        sys.exit(1)
