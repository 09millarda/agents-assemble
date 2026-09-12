# Illustrative definition: bug fix

This design example uses [ADR 0002](../architecture/0002-playbook-and-action-contract.md) and the [shared contracts and notation](playbook-contract.md). It adds a bounded reproduction/investigation loop to the same delivery contract. It is not executable configuration.

```yaml
formatVersion: agents-assemble.playbook/1
package: {id: example/bug-fix, version: 0.1.0}
inputs:
  report: ArtifactRef
  checkpoint: CheckpointRef
  baselineCheckpoint: CheckpointRef
  suppliedSpec: ArtifactRef | null
  priorFindings: ArtifactRef | null
  deliveryKey: DeliveryKey
outputs: {outcome: published | rejected | unreproduced, pullRequest: PRRef | null}
dependencies:
  actions: [investigate, reproduce, unreproduced, specify, approveSpec, prepare, implement, check, review, approvePublish, publishPR]
runtimeSlots: [researcher, author, implementer, reviewer]
permissions: [repository.read, workspace.write, artifact.read, artifact.write, pull_request.upsert]
policy: {referencedSpecChange: pause_and_replan, retries: adapter_certified_only}
body:
  id: bugFix
  type: sequence
  children:
    - id: investigation
      type: call
      action: investigate
      runtime: researcher
      with:
        report: $input.report
        checkpoint: $input.checkpoint
        priorFindings: $input.priorFindings
    - id: reproduction
      type: repeat
      maxIterations: 3
      initial: {checkpoint: $input.baselineCheckpoint, evidence: $investigation.findings}
      body:
        id: reproduceRound
        type: sequence
        children:
          - id: probe
            type: call
            action: reproduce
            runtime: researcher
            with:
              report: $input.report
              findings: $investigation.findings
              checkpoint: $carry.checkpoint
              previousEvidence: $carry.evidence
          - id: reproductionDecision
            type: choose
            cases:
              - when: {eq: [$probe.reproduced, true]}
                then:
                  id: reproduced
                  type: sequence
                  children: []
                  output: {evidence: $probe.evidence}
            otherwise:
              id: needEvidence
              type: sequence
              children:
                - id: humanDecision
                  type: call
                  action: unreproduced
                  with: {report: $input.report, evidence: $probe.evidence}
                - id: continueDecision
                  type: choose
                  cases:
                    - when: {eq: [$humanDecision.decision, stop]}
                      then:
                        id: stopUnreproduced
                        type: end
                        result: {outcome: unreproduced, pullRequest: null}
                  otherwise: {id: investigateAgain, type: sequence, children: []}
              output: {evidence: $humanDecision.evidence}
        output: {reproduced: $probe.reproduced, evidence: $reproductionDecision.evidence, checkpoint: $probe.checkpoint}
      until: {eq: [$body.reproduced, true]}
      carry: {checkpoint: $body.checkpoint, evidence: $body.evidence}
      output: {evidence: $body.evidence, checkpoint: $body.checkpoint}
    - id: specification
      type: call
      action: specify
      runtime: author
      with:
        brief: $input.report
        findings: $reproduction.evidence
        suppliedSpec: $input.suppliedSpec
    - id: scopeApproval
      type: call
      action: approveSpec
      with: {spec: $specification.spec}
    - id: scopeDecision
      type: choose
      cases:
        - when: {eq: [$scopeApproval.approved, false]}
          then: {id: rejectedScope, type: end, result: {outcome: rejected, pullRequest: null}}
      otherwise: {id: approvedScope, type: sequence, children: []}
    - id: workspace
      type: call
      action: prepare
      with: {checkpoint: $input.checkpoint}
    - id: remediation
      type: repeat
      maxIterations: 3
      initial: {checkpoint: $workspace.checkpoint, feedback: [$reproduction.evidence]}
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
      output: {checkpoint: $body.checkpoint, checks: $body.verification.checks, review: $body.verification.review}
    - id: publicationApproval
      type: call
      action: approvePublish
      with:
        spec: $specification.spec
        checkpoint: $remediation.checkpoint
        checks: $remediation.checks
        review: $remediation.review
        deliveryKey: $input.deliveryKey
    - id: publicationDecision
      type: choose
      cases:
        - when: {eq: [$publicationApproval.approved, false]}
          then: {id: rejectedPublication, type: end, result: {outcome: rejected, pullRequest: null}}
      otherwise: {id: approvedPublication, type: sequence, children: []}
    - id: publication
      type: call
      action: publishPR
      with:
        spec: $specification.spec
        checkpoint: $remediation.checkpoint
        deliveryKey: $input.deliveryKey
        approval: $publicationApproval
    - id: complete
      type: end
      result: {outcome: published, pullRequest: $publication.pullRequest}
```

The reproduction loop is deliberately different from a retry. Each round supplies prior evidence and creates a new investigation occurrence; it does not assume a transient invocation failure. An unsuccessful probe takes an explicit human branch: `stop` ends with `unreproduced`, while `investigate_again` supplies a new evidence artifact and permits another round within the existing bound. The human request displays the remaining round allowance. After three unsuccessful rounds the run suspends with `limit_reached` even if more investigation was requested. Continuing beyond that bound needs a freshly authorized linked successor with additional evidence as `priorFindings`; it never resets the existing loop counter or fabricates reproduction success.

`baselineCheckpoint` identifies the original failing code, while `checkpoint` identifies the current working/recovery code. They can be identical on the first run. Reproduction runs in a separate workspace derived from the baseline; preparation/remediation use the recovered working checkpoint, so a successor does not discard an existing fix or demand that fixed code fail again. Reproduction changes and evidence are explicit inputs to the repair/specification work, never implicitly merged into the working checkpoint. A successor preserves this baseline and revalidates its evidence.

The spec records the reproduction evidence and expected/actual behavior. The check action must run the recorded reproduction after remediation and appropriate regression checks; `passed` cannot mean only that unrelated tests passed. The review result and all checks bind the exact commit proposed for publication. A supplied edited spec is revalidated against the evidence and reapproved, including in a successor.

The repeated delivery structure is shown explicitly to make control/data flow inspectable. A future builder may factor authoring helpers into this same document; runtime nested-playbook composition is not silently required by these examples. No hard-coded feature/bug branch belongs in the engine.
