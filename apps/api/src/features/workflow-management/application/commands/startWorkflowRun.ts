import { isMatchingRunRequest } from "../../domain/isMatchingRunRequest";
import {
  createWorkflowRun,
  canExecuteWorkflow,
  isWorkflowPublished,
  type WorkflowRun,
} from "@factory/workflow";
import type { Result } from "@factory/shared-domain";
import type {
  StartWorkflowRunInput,
  WorkflowError,
  WorkflowStorePort,
} from "../../domain/WorkflowStorePort";

export async function startWorkflowRun(
  store: WorkflowStorePort,
  input: StartWorkflowRunInput,
): Promise<Result<WorkflowRun, WorkflowError>> {
  if (
    input.recipientId &&
    !(await store.authorizeRecipient(
      input.recipientId,
      input.managementToken ?? "",
    ))
  )
    return {
      ok: false,
      error: {
        code: "RECIPIENT_UNAUTHORIZED",
        message: "Browser management token is invalid.",
      },
    };
  const runId = input.requestId;
  const existing = await store.findRun(runId);
  if (existing)
    return isMatchingRunRequest(existing, input)
      ? { ok: true, value: existing }
      : {
          ok: false,
          error: {
            code: "REQUEST_CONFLICT",
            message: "This request identity already belongs to another run.",
          },
        };
  const project = await store.findProject(input.projectId);
  if (!project)
    return {
      ok: false,
      error: { code: "PROJECT_NOT_FOUND", message: "Project does not exist." },
    };
  if (!project.enabledWorkflowIds.includes(input.workflowId))
    return {
      ok: false,
      error: {
        code: "WORKFLOW_NOT_ENABLED",
        message: "Enable this workflow in the project before starting.",
      },
    };
  if (!project.daemonId)
    return {
      ok: false,
      error: {
        code: "PROJECT_BLOCKED",
        message: "Assign a daemon to the project.",
      },
    };
  const definition = await store.findDefinition(input.workflowId);
  if (!definition)
    return {
      ok: false,
      error: {
        code: "WORKFLOW_NOT_FOUND",
        message: "Workflow does not exist.",
      },
    };
  if (!isWorkflowPublished(definition.status))
    return {
      ok: false,
      error: {
        code: "WORKFLOW_NOT_PUBLISHED",
        message: "Publish this workflow before starting a run.",
      },
    };
  if (!canExecuteWorkflow(definition))
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_EXECUTION_SETTINGS",
        message:
          "Workflow uses an unsupported model or effort.",
      },
    };
  const now = new Date().toISOString();
  const run = createWorkflowRun(
    {
      runId,
      projectId: input.projectId,
      daemonId: project.daemonId,
      workflow: definition,
      workspace: {
        projectPath: project.absolutePath,
        ...(input.branch ? { branch: input.branch } : {}),
        ...(project.setupCommand ? { setupCommand: project.setupCommand } : {}),
      },
      ...(input.recipientId ? { recipientId: input.recipientId } : {}),
      ...(input.kickoffPrompt ? { prompt: input.kickoffPrompt } : {}),
    },
    now,
  );
  const created = await store.createRun(run);
  return isMatchingRunRequest(created, input)
    ? { ok: true, value: created }
    : {
        ok: false,
        error: {
          code: "REQUEST_CONFLICT",
          message:
            "This request identity already belongs to different start settings.",
        },
      };
}
