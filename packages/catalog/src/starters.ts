import { array, literal, object, ref } from "./builder.ts";
import {
  type ActionDefinition,
  type Binding,
  type Definition,
  digest,
  type JsonSchema,
  type Node,
  normalizeDefinition,
} from "./definition.ts";

const string: JsonSchema = { type: "string", minLength: 1, maxLength: 4096 };
const bool: JsonSchema = { type: "boolean" };
export const artifactSchema: JsonSchema = {
  type: "object",
  properties: { id: string, revisionId: string, digest: string, mediaType: string },
  required: ["id", "revisionId", "digest", "mediaType"],
  additionalProperties: false,
};
export const checkpointSchema: JsonSchema = {
  type: "object",
  properties: { id: string, repositoryId: string, commit: string, digest: string },
  required: ["id", "repositoryId", "commit", "digest"],
  additionalProperties: false,
};
const response = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const approval = response({ approved: bool, receiptId: string, manifestDigest: string });
export const deploymentPolicySchema = response({
  profileDigest: string,
  environmentRevision: string,
  policyGeneration: { type: "integer", minimum: 1 },
  accountId: string,
  stackName: string,
});
const review = response({
  accepted: bool,
  spec: artifactSchema,
  checkpoint: checkpointSchema,
  findings: artifactSchema,
});
const checks = response({
  passed: bool,
  spec: artifactSchema,
  checkpoint: checkpointSchema,
  evidence: artifactSchema,
});
const feedback: JsonSchema = { type: "array", items: artifactSchema, maxItems: 100 };
const nullableArtifact: JsonSchema = { anyOf: [artifactSchema, { type: "null" }] };
const permissions = [
  "repository.read",
  "workspace.write",
  "artifact.read",
  "artifact.write",
  "pull_request.upsert",
  "deployment.dispatch",
];
const capabilities: ActionDefinition["capabilities"] = [
  "native-account",
  "structured-results",
  "durable-human-requests",
  "checkpoint-recovery",
];
function action(
  alias: string,
  kind: ActionDefinition["kind"],
  inputs: JsonSchema,
  outputs: JsonSchema,
  effect: ActionDefinition["effect"] = "read",
): ActionDefinition {
  const value = {
    id: `agents-assemble/${alias}`,
    version: "1.0.0",
    kind,
    executor:
      kind === "agent" || alias === "prepare" || alias === "check"
        ? ("runner" as const)
        : ("service" as const),
    adapter: alias,
    adapterVersion: "1.0.0",
    inputs,
    outputs,
    effect,
    permissions:
      effect === "workspace_write"
        ? ["repository.read", "workspace.write"]
        : effect === "external_write"
          ? [alias === "publishPR" ? "pull_request.upsert" : "deployment.dispatch"]
          : [],
    capabilities: kind === "agent" ? capabilities : [],
    retry: { maxAttempts: 1, safeErrorClasses: [] },
    timeoutSeconds: kind === "human" ? 604800 : 3600,
    cancellation: kind === "human" ? ("supported" as const) : ("reconcile" as const),
  };
  return { ...value, digest: digest(value) };
}
export const starterActions: Record<string, ActionDefinition> = {
  discover: action(
    "discover",
    "agent",
    response({ brief: artifactSchema, checkpoint: checkpointSchema }),
    response({ findings: artifactSchema }),
  ),
  specify: action(
    "specify",
    "agent",
    response({ brief: artifactSchema, findings: artifactSchema, suppliedSpec: nullableArtifact }),
    response({ spec: artifactSchema }),
  ),
  approveSpec: action("approveSpec", "human", response({ spec: artifactSchema }), approval),
  prepare: action(
    "prepare",
    "deterministic",
    response({ checkpoint: checkpointSchema }),
    response({ checkpoint: checkpointSchema }),
  ),
  implement: action(
    "implement",
    "agent",
    response({
      spec: artifactSchema,
      specApproval: approval,
      checkpoint: checkpointSchema,
      feedback,
    }),
    response({ checkpoint: checkpointSchema }),
    "workspace_write",
  ),
  check: action(
    "check",
    "deterministic",
    response({ spec: artifactSchema, checkpoint: checkpointSchema }),
    checks,
  ),
  review: action(
    "review",
    "agent",
    response({ spec: artifactSchema, checkpoint: checkpointSchema }),
    review,
  ),
  approvePublish: action(
    "approvePublish",
    "human",
    response({
      spec: artifactSchema,
      checkpoint: checkpointSchema,
      checks,
      review,
      deliveryKey: string,
    }),
    approval,
  ),
  publishPR: action(
    "publishPR",
    "integration",
    response({ spec: artifactSchema, checkpoint: checkpointSchema, deliveryKey: string, approval }),
    response({ pullRequest: string }),
    "external_write",
  ),
  investigate: action(
    "investigate",
    "agent",
    response({
      report: artifactSchema,
      checkpoint: checkpointSchema,
      priorFindings: nullableArtifact,
    }),
    response({ findings: artifactSchema }),
  ),
  reproduce: action(
    "reproduce",
    "agent",
    response({
      report: artifactSchema,
      findings: artifactSchema,
      checkpoint: checkpointSchema,
      previousEvidence: artifactSchema,
    }),
    response({ reproduced: bool, evidence: artifactSchema, checkpoint: checkpointSchema }),
  ),
  unreproduced: action(
    "unreproduced",
    "human",
    response({ report: artifactSchema, evidence: artifactSchema }),
    response({
      decision: { type: "string", enum: ["investigate_again", "stop"] },
      evidence: artifactSchema,
    }),
  ),
  waitMerge: action(
    "waitMerge",
    "integration",
    response({ pullRequest: string, checkpoint: checkpointSchema }),
    response({
      artifactDigest: string,
      commit: string,
      workflowRevision: string,
      stagingPolicy: deploymentPolicySchema,
      productionPolicy: deploymentPolicySchema,
    }),
  ),
  staging: action(
    "staging",
    "integration",
    response({
      artifactDigest: string,
      workflowRevision: string,
      sourceCommit: string,
      policy: deploymentPolicySchema,
    }),
    response({ healthy: bool, deploymentId: string, artifactDigest: string }),
    "external_write",
  ),
  approveProduction: action(
    "approveProduction",
    "human",
    response({
      artifactDigest: string,
      environment: string,
      workflowRevision: string,
      sourceCommit: string,
      policy: deploymentPolicySchema,
      stagingDeploymentId: string,
    }),
    approval,
  ),
  production: action(
    "production",
    "integration",
    response({
      artifactDigest: string,
      environment: string,
      workflowRevision: string,
      sourceCommit: string,
      policy: deploymentPolicySchema,
      approval,
    }),
    response({ deploymentId: string, artifactDigest: string }),
    "external_write",
  ),
  verifyHealth: action(
    "verifyHealth",
    "integration",
    response({ deploymentId: string, artifactDigest: string }),
    response({ healthy: bool, evidence: artifactSchema }),
  ),
  recoverProduction: action(
    "recoverProduction",
    "integration",
    response({ deploymentId: string, evidence: artifactSchema }),
    response({
      outcome: { type: "string", enum: ["rolled_back", "manual_recovery", "outcome_unknown"] },
      evidence: artifactSchema,
    }),
    "external_write",
  ),
};
function call(id: string, action: string, fields: Record<string, Binding>, runtime?: string): Node {
  return { id, type: "call", action, with: object(fields), ...(runtime ? { runtime } : {}) };
}
function stop(id: string, outcome: string): Node {
  return {
    id,
    type: "end",
    result: object({ outcome: literal(outcome), pullRequest: literal(null) }),
  };
}
const noop = (id: string): Node => ({
  id,
  type: "sequence",
  children: [],
  outputSchema: response({}),
});
function rejectUnless(id: string, source: string, field: string, outcome: string): Node {
  return {
    id,
    type: "choose",
    cases: [
      // biome-ignore lint/suspicious/noThenProperty: The canonical choose-node grammar names its non-callable branch slot then.
      { when: { eq: [ref(source, field), literal(false)] }, then: stop(`${id}Rejected`, outcome) },
    ],
    otherwise: noop(`${id}Accepted`),
  };
}
function remediation(): Node {
  return {
    id: "delivery",
    type: "repeat",
    maxIterations: 3,
    initial: object({ checkpoint: ref("workspace", "/checkpoint"), feedback: array() }),
    body: {
      id: "repairRound",
      type: "sequence",
      children: [
        call(
          "implementation",
          "implement",
          {
            spec: ref("specification", "/spec"),
            specApproval: ref("scopeApproval"),
            checkpoint: ref("carry", "/checkpoint"),
            feedback: ref("carry", "/feedback"),
          },
          "implementer",
        ),
        {
          id: "verification",
          type: "parallel",
          join: "all",
          maxConcurrency: 2,
          branches: [
            call("checks", "check", {
              spec: ref("specification", "/spec"),
              checkpoint: ref("implementation", "/checkpoint"),
            }),
            call(
              "review",
              "review",
              {
                spec: ref("specification", "/spec"),
                checkpoint: ref("implementation", "/checkpoint"),
              },
              "reviewer",
            ),
          ],
          output: object({ checks: ref("checks"), review: ref("review") }),
        },
      ],
      output: object({
        checkpoint: ref("implementation", "/checkpoint"),
        verification: ref("verification"),
      }),
    },
    until: {
      all: [
        { eq: [ref("body", "/verification/checks/passed"), literal(true)] },
        { eq: [ref("body", "/verification/review/accepted"), literal(true)] },
      ],
    },
    carry: object({
      checkpoint: ref("body", "/checkpoint"),
      feedback: array(
        ref("body", "/verification/checks/evidence"),
        ref("body", "/verification/review/findings"),
      ),
    }),
    output: object({
      checkpoint: ref("body", "/checkpoint"),
      checks: ref("body", "/verification/checks"),
      review: ref("body", "/verification/review"),
    }),
  };
}
function deliveryTail(): Node[] {
  return [
    call("scopeApproval", "approveSpec", { spec: ref("specification", "/spec") }),
    rejectUnless("scopeDecision", "scopeApproval", "/approved", "rejected"),
    call("workspace", "prepare", { checkpoint: ref("input", "/checkpoint") }),
    remediation(),
    call("publicationApproval", "approvePublish", {
      spec: ref("specification", "/spec"),
      checkpoint: ref("delivery", "/checkpoint"),
      checks: ref("delivery", "/checks"),
      review: ref("delivery", "/review"),
      deliveryKey: ref("input", "/deliveryKey"),
    }),
    rejectUnless("publicationDecision", "publicationApproval", "/approved", "rejected"),
    call("publication", "publishPR", {
      spec: ref("specification", "/spec"),
      checkpoint: ref("delivery", "/checkpoint"),
      deliveryKey: ref("input", "/deliveryKey"),
      approval: ref("publicationApproval"),
    }),
    call("merge", "waitMerge", {
      pullRequest: ref("publication", "/pullRequest"),
      checkpoint: ref("delivery", "/checkpoint"),
    }),
    call("stagingDeployment", "staging", {
      artifactDigest: ref("merge", "/artifactDigest"),
      workflowRevision: ref("merge", "/workflowRevision"),
      sourceCommit: ref("merge", "/commit"),
      policy: ref("merge", "/stagingPolicy"),
    }),
    rejectUnless("stagingDecision", "stagingDeployment", "/healthy", "staging_failed"),
    call("productionApproval", "approveProduction", {
      artifactDigest: ref("merge", "/artifactDigest"),
      environment: literal("production"),
      workflowRevision: ref("merge", "/workflowRevision"),
      sourceCommit: ref("merge", "/commit"),
      policy: ref("merge", "/productionPolicy"),
      stagingDeploymentId: ref("stagingDeployment", "/deploymentId"),
    }),
    rejectUnless("productionDecision", "productionApproval", "/approved", "rejected"),
    call("productionDeployment", "production", {
      artifactDigest: ref("merge", "/artifactDigest"),
      environment: literal("production"),
      workflowRevision: ref("merge", "/workflowRevision"),
      sourceCommit: ref("merge", "/commit"),
      policy: ref("merge", "/productionPolicy"),
      approval: ref("productionApproval"),
    }),
    call("health", "verifyHealth", {
      deploymentId: ref("productionDeployment", "/deploymentId"),
      artifactDigest: ref("merge", "/artifactDigest"),
    }),
    {
      id: "healthDecision",
      type: "choose",
      cases: [
        {
          when: { eq: [ref("health", "/healthy"), literal(false)] },
          // biome-ignore lint/suspicious/noThenProperty: The canonical choose-node grammar names its non-callable branch slot then.
          then: {
            id: "recovery",
            type: "sequence",
            children: [
              call("recoveryResult", "recoverProduction", {
                deploymentId: ref("productionDeployment", "/deploymentId"),
                evidence: ref("health", "/evidence"),
              }),
              {
                id: "recoveryEnd",
                type: "end",
                result: object({
                  outcome: ref("recoveryResult", "/outcome"),
                  pullRequest: ref("publication", "/pullRequest"),
                }),
              },
            ],
            outputSchema: response({}),
          },
        },
      ],
      otherwise: noop("healthy"),
    },
    {
      id: "complete",
      type: "end",
      result: object({
        outcome: literal("delivered"),
        pullRequest: ref("publication", "/pullRequest"),
      }),
    },
  ];
}
function reproduction(): Node {
  return {
    id: "reproduction",
    type: "repeat",
    maxIterations: 3,
    initial: object({
      checkpoint: ref("input", "/baselineCheckpoint"),
      evidence: ref("investigation", "/findings"),
    }),
    body: {
      id: "reproduceRound",
      type: "sequence",
      children: [
        call(
          "probe",
          "reproduce",
          {
            report: ref("input", "/report"),
            findings: ref("investigation", "/findings"),
            checkpoint: ref("carry", "/checkpoint"),
            previousEvidence: ref("carry", "/evidence"),
          },
          "researcher",
        ),
        {
          id: "reproductionDecision",
          type: "choose",
          cases: [
            {
              when: { eq: [ref("probe", "/reproduced"), literal(true)] },
              // biome-ignore lint/suspicious/noThenProperty: The canonical choose-node grammar names its non-callable branch slot then.
              then: {
                id: "reproduced",
                type: "sequence",
                children: [],
                output: object({ evidence: ref("probe", "/evidence") }),
                outputSchema: response({ evidence: artifactSchema }),
              },
            },
          ],
          otherwise: {
            id: "needEvidence",
            type: "sequence",
            children: [
              call("humanDecision", "unreproduced", {
                report: ref("input", "/report"),
                evidence: ref("probe", "/evidence"),
              }),
              {
                id: "continueDecision",
                type: "choose",
                cases: [
                  {
                    when: { eq: [ref("humanDecision", "/decision"), literal("stop")] },
                    // biome-ignore lint/suspicious/noThenProperty: The canonical choose-node grammar names its non-callable branch slot then.
                    then: stop("unreproducedStop", "unreproduced"),
                  },
                ],
                otherwise: noop("investigateAgain"),
              },
            ],
            output: object({ evidence: ref("humanDecision", "/evidence") }),
            outputSchema: response({ evidence: artifactSchema }),
          },
        },
      ],
      output: object({
        reproduced: ref("probe", "/reproduced"),
        evidence: ref("reproductionDecision", "/evidence"),
        checkpoint: ref("probe", "/checkpoint"),
      }),
    },
    until: { eq: [ref("body", "/reproduced"), literal(true)] },
    carry: object({ checkpoint: ref("body", "/checkpoint"), evidence: ref("body", "/evidence") }),
    output: object({ checkpoint: ref("body", "/checkpoint"), evidence: ref("body", "/evidence") }),
  };
}
export function starterPlaybook(kind: "new-feature" | "bug-fix"): Definition {
  const isBug = kind === "bug-fix";
  const commonInputs = {
    checkpoint: checkpointSchema,
    suppliedSpec: nullableArtifact,
    deliveryKey: string,
  };
  const nodes = isBug
    ? [
        call(
          "investigation",
          "investigate",
          {
            report: ref("input", "/report"),
            checkpoint: ref("input", "/checkpoint"),
            priorFindings: ref("input", "/priorFindings"),
          },
          "researcher",
        ),
        reproduction(),
        call(
          "specification",
          "specify",
          {
            brief: ref("input", "/report"),
            findings: ref("reproduction", "/evidence"),
            suppliedSpec: ref("input", "/suppliedSpec"),
          },
          "author",
        ),
      ]
    : [
        call(
          "discovery",
          "discover",
          { brief: ref("input", "/brief"), checkpoint: ref("input", "/checkpoint") },
          "researcher",
        ),
        call(
          "specification",
          "specify",
          {
            brief: ref("input", "/brief"),
            findings: ref("discovery", "/findings"),
            suppliedSpec: ref("input", "/suppliedSpec"),
          },
          "author",
        ),
      ];
  const body: Node = {
    id: isBug ? "bugFix" : "feature",
    type: "sequence",
    children: [...nodes, ...deliveryTail()],
  };
  const aliases = new Set<string>();
  const collect = (node: Node) => {
    if (node.type === "call") aliases.add(node.action);
    else if (node.type === "sequence") node.children.forEach(collect);
    else if (node.type === "parallel") node.branches.forEach(collect);
    else if (node.type === "choose") {
      node.cases.forEach((entry) => {
        collect(entry.then);
      });
      collect(node.otherwise);
    } else if (node.type === "repeat" || node.type === "forEach") collect(node.body);
  };
  collect(body);
  return normalizeDefinition({
    formatVersion: "agents-assemble.playbook/1",
    package: { id: `agents-assemble/${kind}`, version: "1.0.0" },
    inputs: isBug
      ? response({
          ...commonInputs,
          report: artifactSchema,
          baselineCheckpoint: checkpointSchema,
          priorFindings: nullableArtifact,
        })
      : response({ ...commonInputs, brief: artifactSchema }),
    outputs: response({
      outcome: {
        type: "string",
        enum: [
          "delivered",
          "rejected",
          "unreproduced",
          "staging_failed",
          "rolled_back",
          "manual_recovery",
          "outcome_unknown",
        ],
      },
      pullRequest: { type: ["string", "null"] },
    }),
    dependencies: Object.fromEntries(
      [...aliases].sort().map((alias) => [alias, starterActions[alias]]),
    ),
    runtimeSlots: Object.fromEntries(
      ["researcher", "author", "implementer", "reviewer"].map((slot) => [
        slot,
        { harness: "codex", capabilities },
      ]),
    ),
    permissions,
    policy: {
      maxInvocations: 100,
      maxConcurrency: 2,
      maxExpressionDepth: 32,
      maxExpressionNodes: 10000,
      referencedSpecChange: "pause_and_replan",
    },
    body,
  });
}
