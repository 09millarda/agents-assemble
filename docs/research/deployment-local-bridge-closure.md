# Deployment investigation closed at owner request

2026-09-13 · [Issue #15](https://github.com/09millarda/agents-assemble/issues/15).

The owner asked to stop, clean up and close this investigation. It is closed as **not planned**, not as completed adapter qualification. No deployment ADR is accepted. The release's deployment requirement is unchanged; remaining integration/recovery qualification is deferred without creating a new ticket.

## Retained evidence

Earlier [actual Lambda deployments and restoration](lambda-live-deployment-result.md), [dispatch and PostgreSQL fault results](deployment-authority-result.md), and [signed GitHub identity verification](deployment-oidc-claim-result.md) remain valid within their stated limits.

The final [local bridge source and partial evidence](https://github.com/09millarda/agents-assemble/tree/5102f79af0d84ac1b5f6204896d74192808d51cb/experiments/local-deployment-bridge) used existing local AWS authentication, a dedicated scoped controller role, PostgreSQL and a temporary HTTPS tunnel. No EC2 or managed database host was provisioned.

Three actual GitHub runs passed the revoked, expired and wrong-workflow rejection probes. Two staging requests admitted one durable claim and rejected the duplicate. After the owner stopped the experiment, the first staging run ended in failure and the duplicate was cancelled. The archived database preserves the admitted obligation and provider intent; neither was relabeled a successful deployment. Independent AWS observations showed both baseline stacks at CREATE_COMPLETE and no candidate change sets listed.

The local bridge did **not** complete candidate deployment, provider-response-loss recovery or automatic restoration tests. Its operator-created test grants do not establish authenticated product approval or trusted merged-build integration. Those limits supersede any earlier proposed next-step wording.

## Verified cleanup

[Independent cleanup observations](https://github.com/09millarda/agents-assemble/blob/5102f79af0d84ac1b5f6204896d74192808d51cb/experiments/local-deployment-bridge/evidence/cleanup-verification.json) confirm, in Proof of Concept account `728616601473`, Ireland:

- Both `aa-wf15l` CloudFormation stacks reached DELETE_COMPLETE; their Lambda functions, API Gateway APIs and log groups are absent.
- Three versioned artifact objects and their bucket were deleted.
- The five local fixture roles and the earlier `aa-wf15-identity-check` role are absent.
- Gateway, controller supervisor, provider worker and temporary tunnel stopped. PostgreSQL was exported before its container was removed; Docker Desktop was stopped.
- All five decision-15 GitHub workflows are disabled. The newly retired local bridge and identity workflows also have false job guards in source.

The first stack deletions failed immediately after installing cleanup policies. Read-back confirmed the required actions/resources; an explicit retry with the same policies succeeded. IAM propagation is a possible explanation, not an established cause. The archive retains the failure and final checks.

The account-wide GitHub OIDC provider and existing local AWS sign-in/profile are retained. No account or organization settings were changed during cleanup. Historical CloudFormation records and archived evidence remain, but no fixture workloads are running. Actual billing was not measured; deletion does not remove already incurred usage charges.

Validation included final AWS resource reads, GitHub workflow/run status, local process/container shutdown, and a credential-pattern scan of the 26 selected evidence files. The SQL dump is retained in its generated format. This closure does not assert that unexecuted tests passed.
