# GitHub dispatch identity and recovery sources

Decision: [#15 — Validate Lambda deployment identity and recovery](https://github.com/09millarda/agents-assemble/issues/15). Checked 2026-09-13. This is source research; provider observations and controlled protocol tests must be reported separately.

## Finding

GitHub can return the newly created run directly, but its documented dispatch interface supplies neither a caller idempotency key nor a logical deployment authorization record. The recommended adapter therefore keeps durable effect identity and claim authority outside GitHub, and treats GitHub run/attempt identity as execution evidence. This recommendation follows from the documented API and identity boundaries below; it is not a GitHub exactly-once guarantee.

## Verified API and identity facts

The version-specific **2022-11-28** OpenAPI description contains `return_run_details: boolean` for `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`. `true` selects HTTP 200 with `workflow_run_id`, `run_url`, and `html_url`; `false` selects HTTP 204. Its request schema contains `ref`, `inputs`, and `return_run_details`, with no idempotency-key field. `ref` is documented as a branch or tag. The schema was inspected at pinned commit `cca5c0021436293e6ec6a689b9e2f6794080d003`. [GitHub's versioned OpenAPI schema](https://github.com/github/rest-api-description/blob/cca5c0021436293e6ec6a689b9e2f6794080d003/descriptions/api.github.com/api.github.com.2022-11-28.json), [dispatch REST reference](https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28#create-a-workflow-dispatch-event).

The February 19, 2026 announcement says omitting this parameter retains the empty response and GitHub CLI 2.87.0 adds run URL output. The documentation site's version-qualified page currently shows newer-version example headers, so probes should record their actual `X-GitHub-Api-Version` header. The pinned schema above verifies support independently of that rendered example. [GitHub announcement](https://github.blog/changelog/2026-02-19-workflow-dispatch-api-now-returns-run-ids/).

Minimal request shape for the probe, with values replaced by its actual input names:

```http
POST /repos/09millarda/agents-assemble/actions/workflows/WORKFLOW_FILE/dispatches
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json

{"ref":"main","return_run_details":true,"inputs":{"effect_id":"EFFECT","manifest_sha256":"DIGEST"}}
```

This is a schema-based example, not a record that a request was sent. Authentication is intentionally omitted from the example. [Dispatch request schema](https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28#create-a-workflow-dispatch-event).

`workflow_dispatch` requires the workflow file on the default branch. The event's SHA is the last commit on the dispatched branch or tag. Consequently, supplying a branch name alone does not bind a previously approved workflow revision; observed revision must be checked against the intended revision. The latter is an adapter inference. [Dispatch event semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).

Run listing supports workflow, event, branch, creation-time and head-SHA narrowing, pagination up to 100 per page, and a 1,000-result ceiling for filtered searches. No arbitrary dispatch-input filter is documented. Returned records include run ID, attempt, repository, workflow ID, path, head SHA, event, status, conclusion, and display title. A separate attempt endpoint permits retrieving a particular attempt. [Workflow runs REST reference](https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28).

`run-name` can interpolate `inputs` and `github` context values and appears in the run list. This makes a nonce in the title useful for candidate discovery; because the workflow author controls the expression and dispatchers supply inputs, title equality alone is not independent approval evidence. [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#run-name).

`GITHUB_RUN_ID` stays constant across reruns; `GITHUB_RUN_ATTEMPT` starts at one and increments. Repository and owner IDs, workflow ref, and workflow SHA also have predefined variables. [Variables reference](https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables). Reruns retain the original event SHA/ref and original initiating actor's privileges, even if a different person starts the rerun. [Rerun semantics](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).

OIDC claims include repository/owner IDs, event, ref, workflow ref/SHA, run ID and attempt; audience and subject constrain trust. These identify a workflow execution. The documented claims do not contain this product's accepted approval, manifest digest, environment generation, or consumed effect authority. A valid workflow token therefore needs application-side binding to those records before a logical deployment is authorized. The application-side requirement is an adapter inference. [OIDC reference](https://docs.github.com/en/actions/reference/security/oidc).

## Cancellation and concurrency facts

A concurrency group is repository-scoped and case insensitive, with at most one running member. Default `queue: single` replaces an existing pending member; `queue: max` permits up to 100 pending members and cannot combine with `cancel-in-progress: true`. Ordering follows when members start waiting, not dispatch order. These are scheduler properties. [Concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

Cancellation reevaluates job/step conditions, signals selected runner processes, and eventually terminates them. Some conditions allow work to continue; there is a five-minute cancellation timeout. The procedure does not describe undoing external API operations. Thus a cancelled run is insufficient evidence that an already accepted cloud operation stopped or that its environment can be released; that conclusion is an adapter inference. [Cancellation reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation).

## Recommendations and qualification limits

1. Persist an effect and possible-dispatch state before sending. Use direct run details when received. If acknowledgement is lost, query bounded candidate windows and verify exact repository/workflow/revision plus correlation evidence. Zero candidates at one instant is not proof that dispatch never happened: none of the cited listing documentation supplies such a completeness guarantee.
2. Multiple matching runs must remain multiple candidates for one logical effect. A duplicate dispatch or a rerun must pass the same one-use claim, binding current approval, exact manifest, generation and predecessor. Run ID alone is not that claim. Avoid issuing broad cloud credentials before the claim.
3. Retain environment obligations after claim loss, runner cancellation or unknown provider outcome. Reconcile the provider operation under its original stable identity before admitting a replacement. GitHub concurrency cannot fence other repositories, operators or an external operation surviving its runner.
4. Preserve attempt-specific evidence and immutable receipt identity. Redelivering a receipt across context boundaries must not redispatch the effect. Conflicting payloads under the same effect/receipt ID require explicit rejection and retained history.

These recommendations extend the repository's [durable execution contract](../architecture/0003-durable-execution-and-recovery.md) and [Lambda deployment experiment plan](lambda-deployment-plan.md). A local database fixture can test state transitions and crash recovery. A non-deploying GitHub probe can establish observed dispatch/rerun correlation. Neither alone proves a live authenticated claim-to-AWS authority bridge, expiry/revocation behavior of issued credentials, or automatic restoration in AWS.
