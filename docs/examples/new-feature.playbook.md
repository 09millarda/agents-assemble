# Illustrative definition: new feature

This is a design example for [ADR 0002](../architecture/0002-playbook-and-action-contract.md), using the [shared contracts and notation](playbook-contract.md). It is not executable configuration. Dependency digests, exact runtime bindings and schema bodies must be materialized by a later prototype/implementation.

```yaml
formatVersion: agents-assemble.playbook/1
package: {id: example/new-feature, version: 0.1.0}
inputs:
  brief: ArtifactRef
  checkpoint: CheckpointRef
  suppliedSpec: ArtifactRef | null
  deliveryKey: DeliveryKey
outputs: {outcome: published | rejected, pullRequest: PRRef | null}
dependencies:
  actions: [discover, specify, approveSpec, prepare, implement, check, review, approvePublish, publishPR]
runtimeSlots: [researcher, author, implementer, reviewer]
permissions: [repository.read, workspace.write, artifact.read, artifact.write, pull_request.upsert]
policy: {referencedSpecChange: pause_and_replan, retries: adapter_certified_only}
body:
  id: feature
  type: sequence
  children:
    - id: discovery
      type: call
      action: discover
      runtime: researcher
      with: {brief: $input.brief, checkpoint: $input.checkpoint}
    - id: specification
      type: call
      action: specify
      runtime: author
      with:
        brief: $input.brief
        findings: $discovery.findings
        suppliedSpec: $input.suppliedSpec
    - id: scopeApproval
      type: call
      action: approveSpec
      with: {spec: $specification.spec}
    - id: scopeDecision
      type: choose
      cases:
        - when: {eq: [$scopeApproval.approved, false]}
          then:
            id: rejectedScope
            type: end
            result: {outcome: rejected, pullRequest: null}
      otherwise: {id: approvedScope, type: sequence, children: []}
    - id: workspace
      type: call
      action: prepare
      with: {checkpoint: $input.checkpoint}
    - id: delivery
      type: repeat
      maxIterations: 3
      initial: {checkpoint: $workspace.checkpoint, feedback: []}
      body:
        id: repairRound
        type: sequence
        children:
          - id: implementation
            type: call
            action: implement
            runtime: implementer
            with:
              spec: $specification.spec
              specApproval: $scopeApproval
              checkpoint: $carry.checkpoint
              feedback: $carry.feedback
          - id: verification
            type: parallel
            join: all
            maxConcurrency: 2
            branches:
              - id: checks
                type: call
                action: check
                with: {spec: $specification.spec, checkpoint: $implementation.checkpoint}
              - id: review
                type: call
                action: review
                runtime: reviewer
                with: {spec: $specification.spec, checkpoint: $implementation.checkpoint}
            output: {checks: $checks, review: $review}
        output: {checkpoint: $implementation.checkpoint, verification: $verification}
      until:
        all:
          - {eq: [$body.verification.checks.passed, true]}
          - {eq: [$body.verification.review.accepted, true]}
      carry:
        checkpoint: $body.checkpoint
        feedback: [$body.verification.checks.evidence, $body.verification.review.findings]
      output:
        checkpoint: $body.checkpoint
        checks: $body.verification.checks
        review: $body.verification.review
    - id: publicationApproval
      type: call
      action: approvePublish
      with:
        spec: $specification.spec
        checkpoint: $delivery.checkpoint
        checks: $delivery.checks
        review: $delivery.review
        deliveryKey: $input.deliveryKey
    - id: publicationDecision
      type: choose
      cases:
        - when: {eq: [$publicationApproval.approved, false]}
          then:
            id: rejectedPublication
            type: end
            result: {outcome: rejected, pullRequest: null}
      otherwise: {id: approvedPublication, type: sequence, children: []}
    - id: publication
      type: call
      action: publishPR
      with:
        spec: $specification.spec
        checkpoint: $delivery.checkpoint
        deliveryKey: $input.deliveryKey
        approval: $publicationApproval
    - id: complete
      type: end
      result: {outcome: published, pullRequest: $publication.pullRequest}
```

`sequence` with no children is the identity/no-op branch. Parallel children publish their own results to the composite's output binder only after all succeed. `$body` refers to the repeat body's declared output, not arbitrary private nested state. `repeat` evaluates `until` after the body returns; a false result on the final iteration suspends with `limit_reached` before publication approval.

The first implementation consumes an empty feedback list; later iterations receive both check evidence and review findings with the previous verified checkpoint. Both verification actions run against the implementation's immutable commit. Check workspace mutations cannot change that commit. The publication adapter revalidates the gate and intended target before any external write; Git merge/deployment is not authorized by this template.

An edit to the consumed spec cannot silently affect an active implementation or keep an old approval valid for a different revision. Once Execution observes a relevant edit, it pauses as described in the ADR. If the edit is adopted, a linked successor supplies the revised spec through `suppliedSpec`, the recovered code through `checkpoint` and the same `deliveryKey`; discovery/specification are re-evaluated and approvals are new. A retained old revision requires an explicit, version-checked human decision.
