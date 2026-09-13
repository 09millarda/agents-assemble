import { payloadDigest, type StartCommand } from "../src/protocol.ts";
export function makeCommand(): StartCommand {
  const payload = {
    prompt: "Implement a bounded change. Café.",
    repository: { repositoryId: "repo-1", url: "/tmp/source", commit: "a".repeat(40) },
    runtime: {
      profileId: "runtime-1",
      revision: "a".repeat(64),
      model: "example-model",
      effort: "medium" as const,
      sandbox: "workspace-write" as const,
      trustedRunner: true as const,
      codexVersion: "0.153.4" as const,
    },
    environment: {
      profileId: "environment-1",
      revision: "b".repeat(64),
      resolverPolicy: "local-file" as const,
      rotationPolicy: "refresh_per_attempt" as const,
      variables: {},
      secretBindings: [],
    },
  };
  return {
    kind: "start",
    commandId: "command-1",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    payloadDigest: payloadDigest(payload),
    payload,
    scope: {
      deploymentId: "deployment-1",
      organizationId: "organization-1",
      runnerId: "runner-1",
      journalId: "journal-1",
      runId: "run-1",
      occurrenceId: "occurrence-1",
      attemptId: "attempt-1",
      invocationId: "invocation-1",
      assignmentId: "assignment-1",
      generation: 1,
      admissionId: "admission-1",
      inputDigest: "c".repeat(64),
    },
  };
}
