"""THROWAWAY: real GitHub identity observations, no deployment or AWS access."""
import datetime, hashlib, json, pathlib, subprocess, sys, uuid

ROOT = pathlib.Path(__file__).parent
EVIDENCE = ROOT / 'evidence/github.json'
REPO = 'repos/09millarda/agents-assemble'
WORKFLOW = 'deployment-dispatch-probe.yml'

def api(path, data=None, discard=False):
    args = ['gh', 'api', '-H', 'X-GitHub-Api-Version: 2022-11-28', path]
    if data is not None:
        args += ['--method', 'POST', '--input', '-']
    result = subprocess.run(args, input=json.dumps(data) if data else None,
                            text=True, stdout=subprocess.DEVNULL if discard else subprocess.PIPE,
                            stderr=subprocess.PIPE, check=True)
    return None if discard else (json.loads(result.stdout) if result.stdout.strip() else None)

if sys.argv[1] == 'dispatch':
    suffix = uuid.uuid4().hex[:12]
    state = {'api_version': '2022-11-28', 'started': datetime.datetime.now(datetime.timezone.utc).isoformat(),
             'workflow': WORKFLOW, 'workflow_commit': subprocess.check_output(['git', '-C', '/home/amillard98/Documents/git/agents-assemble', 'rev-parse', 'HEAD'], text=True).strip(),
             'evidence_class': 'actual-github-with-controlled-response-loss', 'dispatches': []}
    for label in ('first', 'duplicate', 'lost-response'):
        request = {'ref': 'main', 'return_run_details': True, 'inputs': {
            'effect_id': 'duplicate-' + suffix if label != 'lost-response' else 'lost-' + suffix,
            'nonce': suffix,
            'manifest_sha256': hashlib.sha256(b'aa-wf15-exact-disposable-manifest').hexdigest()}}
        # Durable record precedes call; lost-response stdout is discarded by the OS,
        # not retained and subsequently rediscovered from that response.
        record = {'label': label, 'request': request, 'state': 'may-have-dispatched'}
        state['dispatches'].append(record)
        EVIDENCE.write_text(json.dumps(state, indent=2) + '\n')
        response = api(f'{REPO}/actions/workflows/{WORKFLOW}/dispatches', request, discard=label == 'lost-response')
        record['response'] = response
        record['state'] = 'unknown-response-discarded' if label == 'lost-response' else 'acknowledged'
        EVIDENCE.write_text(json.dumps(state, indent=2) + '\n')
    print(json.dumps(state, indent=2))
elif sys.argv[1] == 'collect':
    state = json.loads(EVIDENCE.read_text())
    runs = api(f'{REPO}/actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&per_page=100')['workflow_runs']
    titles = {f"aa-wf15-dispatch-{d['request']['inputs']['effect_id']}-{d['request']['inputs']['nonce']}" for d in state['dispatches']}
    observed = []
    for run in runs:
        if run['display_title'] not in titles:
            continue
        assert run['head_sha'] == state['workflow_commit'] and run['head_branch'] == 'main'
        record = {k: run[k] for k in ('id', 'run_attempt', 'display_title', 'event', 'path', 'head_sha', 'head_branch', 'status', 'conclusion', 'html_url', 'created_at')}
        record['repository_id'] = run['repository']['id']
        record['attempts'] = []
        for attempt in range(1, run['run_attempt'] + 1):
            detail = api(f"{REPO}/actions/runs/{run['id']}/attempts/{attempt}")
            item = {k: detail[k] for k in ('id', 'run_attempt', 'head_sha', 'status', 'conclusion', 'html_url')}
            if item['status'] == 'completed':
                log = subprocess.check_output(['gh', 'run', 'view', str(run['id']), '--repo', '09millarda/agents-assemble', '--attempt', str(attempt), '--log'], text=True)
                items = []
                for line in log.splitlines():
                    marker = 'AA_DISPATCH_OBSERVATION={'
                    if marker in line:
                        items.append(json.loads('{' + line.split(marker, 1)[1]))
                assert len(items) == 1, items
                item['observation'] = items[0]
                assert items[0]['GITHUB_RUN_ID'] == str(run['id'])
                assert items[0]['GITHUB_RUN_ATTEMPT'] == str(attempt)
                assert items[0]['GITHUB_WORKFLOW_SHA'] == state['workflow_commit']
            record['attempts'].append(item)
        observed.append(record)
    state['runs'] = observed
    EVIDENCE.write_text(json.dumps(state, indent=2) + '\n')
    print(json.dumps(observed, indent=2))
