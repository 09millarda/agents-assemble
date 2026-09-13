# Disposable Lambda deployment probe

Decision [#15](https://github.com/09millarda/agents-assemble/issues/15).
Throwaway provider experiment, never production application code. The identity
probe has passed; this application template has not been provisioned.

## Local application checks

Requires Node 22 or newer, npm and Python 3. Commit fixture changes first so the
embedded source revision identifies the actual archived source.

```sh
npm ci --ignore-scripts
npm run build
npm run check
PROBE_HEALTHY=false npm run build
PROBE_HEALTHY=false npm run check
```

Build produces `dist/function.zip` and `dist/artifact.json`. ZIP metadata is fixed;
identical source revision, dependencies and health flag produce identical bytes.
`GET /health` returns 200 or a deliberate 503 with source revision and environment.
Build once and upload once; promotion must reuse the recorded S3 object version
and ZIP SHA-256, rather than rebuilding for the other environment. The health flag
is part of the built bytes, so a failing release has a distinct artifact digest.

## Proposed infrastructure

`template.json` is a SAM template for each of `aa-wf15-staging` and `aa-wf15-prod`
in Proof of Concept (`728616601473`), Ireland (`eu-west-1`). It requires precreated
runtime roles and a private versioned artifact bucket. Parameters identify exact
artifact bytes; a template parameter asserting a hash alone does not verify them.
The deployment controller must compare uploaded bytes and Lambda's CodeSha256.

Local SAM translator 1.113.0 expands each template to seven resources: log group,
function, version, alias, invocation permission, HTTP API and stage. Its generated
OpenAPI integration invokes `live`, and permission is restricted to that API's
GET /health route. Published versions have `DeletionPolicy: Retain`; account for
retained versions during cleanup. No CodeDeploy or implicit IAM role is generated.
Local transformation is not an AWS change-set or permission validation.

The mainline [bootstrap review](https://github.com/09millarda/agents-assemble/blob/main/docs/research/lambda-fixture-bootstrap-review.md)
records resource scope, proposed IAM boundaries, cost/duration and cleanup.
No application resources or deployment roles have been created. Do not deploy
without the agreed resource/budget scope, refreshed CLI identity, actual processed
change-set inspection and scoped effective permissions. CloudFormation alone
owns alias changes and restoration to a retained healthy artifact.

## Earlier prerequisite and identity probes

`preflight.py` records tool availability and selected GitHub metadata without
printing credentials. Its old `prerequisites.json` is historical, not live state.
`connect_identity.py` is the create-only identity bootstrap already executed in
this account; do not rerun it against the existing role/provider. The identity
role cannot deploy and has a finite trust expiry, recorded in the mainline result.

All actual app deployment, promotion, failed-health and rollback cases remain open.
