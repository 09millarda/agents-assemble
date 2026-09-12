#!/usr/bin/env python3
"""Throwaway read-only prerequisite recorder for decision #15; no cloud mutations.

Prints only explicit metadata projections. Never outputs credentials, variable
values, tokens, AWS config contents, or raw command failures.
"""
import configparser
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

REPO = '09millarda/agents-assemble'


def github(path, projection):
    try:
        result = subprocess.run(['gh', 'api', f'repos/{REPO}/{path}', '--jq', projection],
                                capture_output=True, text=True, timeout=30)
        if result.returncode:
            return {'observed': False, 'exit_code': result.returncode}
        return {'observed': True, 'data': json.loads(result.stdout)}
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        return {'observed': False, 'error_type': type(exc).__name__}


def aws_file(path):
    result = {'path': str(path), 'exists': path.exists()}
    if path.exists():
        parser = configparser.RawConfigParser()
        try:
            parser.read(path)
            result['profile_names'] = parser.sections()
        except configparser.Error:
            result['parse_failed'] = True
    return result


record = {
    'recorded_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'kind': 'read_only_prerequisites',
    'repository': REPO,
    'executables': {name: shutil.which(name) for name in ['aws', 'sam', 'gh', 'node', 'python3']},
    'aws_environment_names': sorted(key for key in os.environ if key.startswith('AWS_')),
    'aws_files': [aws_file(Path(os.environ.get(env, str(Path.home() / '.aws' / name))))
                  for name, env in [('config', 'AWS_CONFIG_FILE'), ('credentials', 'AWS_SHARED_CREDENTIALS_FILE')]],
    'github': {
        'actions_permissions': github('actions/permissions', '{enabled,allowed_actions,sha_pinning_required}'),
        'workflows': github('actions/workflows', '{total_count,workflows:[.workflows[]|{id,name,path,state}]}'),
        'environments': github('environments', '{total_count,environments:[.environments[]|{name,protection_rules}]}'),
        'secret_names': github('actions/secrets', '{total_count,names:[.secrets[].name]}'),
        'variable_names': github('actions/variables', '{total_count,names:[.variables[].name]}'),
    },
    'conformance_passed': False,
    'unexercised': ['real workflow dispatch/correlation', 'AWS identity and permissions',
                    'artifact build and immutable promotion', 'production effect authorization',
                    'real staging/production-like deployment', 'health failure and rollback',
                    'lost acknowledgments and concurrent release recovery'],
    'interpretation': 'Presence or absence of configuration is not a provider conformance verdict. '
                      'No STS call, workflow dispatch or cloud mutation is performed.'
}
print(json.dumps(record, indent=2))
