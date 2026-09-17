import type {
  WorkflowTransition,
  HumanResponse,
  ActivityExecution,
  HumanInteraction,
} from "./WorkflowRun";
import { buildCommand } from "./buildWorkflowDaemonCommand";
import {
  startActivity,
  continueToActivity,
  dispatchActivityExecution,
} from "./workflowActivityProgression";

export function answerWorkflowInteraction(
  transition: WorkflowTransition,
  response: HumanResponse,
  now: string,
): void {
  const run = transition.run;
  if (response.runId !== run.runId) return;
  const execution = run.executions.at(-1);
  if (response.action === "cancel") {
    run.status = "cancelled";
    run.interaction = null;
    if (execution) {
      execution.status = "cancelled";
      transition.commands.push({
        ...buildCommand(run, execution, "cancel"),
        commandId: `${execution.commandId}:cancel`,
      });
    }
    return;
  }
  const interaction = run.interaction;
  if (
    !execution ||
    !interaction ||
    response.interactionId !== interaction.interactionId
  )
    return;
  switch (interaction.kind) {
    case "recovery":
      retryWorkflowExecution(transition, execution, interaction, response);
      return;
    case "question":
      answerWorkflowQuestion(transition, execution, interaction, response, now);
      return;
    case "permission":
      answerHarnessPermission(transition, execution, interaction, response);
      return;
    case "approval":
      answerWorkflowApproval(transition, execution, interaction, response, now);
      return;
    case "loop-exhaustion":
      return;
  }
}

function resumeExecutionDispatch(
  transition: WorkflowTransition,
  execution: ActivityExecution,
): void {
  execution.dispatchSequence += 1;
  execution.commandId = `${execution.executionId}:dispatch:${execution.dispatchSequence}:attempt:${execution.recoveryAttempt}`;
  execution.status = "running";
  transition.run.status = "running";
  transition.run.interaction = null;
}

function retryWorkflowExecution(
  transition: WorkflowTransition,
  execution: ActivityExecution,
  interaction: HumanInteraction,
  response: HumanResponse,
): void {
  if (response.action !== "retry") return;
  const run = transition.run;
  if (interaction.targetActivityId) {
    const target = interaction.targetActivityId;
    run.interaction = null;
    run.error = null;
    startActivity(transition, target, new Date().toISOString());
    return;
  }
  execution.recoveryAttempt += 1;
  execution.commandId = `${execution.executionId}:dispatch:${execution.dispatchSequence}:attempt:${execution.recoveryAttempt}`;
  execution.status = "running";
  execution.error = null;
  run.status = "running";
  run.error = null;
  run.interaction = null;
  transition.commands.push({
    ...buildCommand(run, execution, "execute"),
    recoveryAuthorized: true,
  });
}

function answerWorkflowQuestion(
  transition: WorkflowTransition,
  execution: ActivityExecution,
  interaction: HumanInteraction,
  response: HumanResponse,
  now: string,
): void {
  if (response.action !== "answer" || !response.answer?.trim()) return;
  execution.transcript.push({
    entryId: response.messageId,
    role: "user",
    content: response.answer,
    createdAt: now,
  });
  resumeExecutionDispatch(transition, execution);
  transition.commands.push({
    ...buildCommand(transition.run, execution, "answer"),
    interaction: {
      interactionId: interaction.interactionId,
      answer: response.answer,
      permissionRequest: interaction.permissionRequest,
    },
  });
}

function answerHarnessPermission(
  transition: WorkflowTransition,
  execution: ActivityExecution,
  interaction: HumanInteraction,
  response: HumanResponse,
): void {
  if (
    response.action !== "allow-permission" &&
    response.action !== "deny-permission"
  )
    return;
  resumeExecutionDispatch(transition, execution);
  transition.commands.push({
    ...buildCommand(transition.run, execution, "answer"),
    interaction: {
      interactionId: interaction.interactionId,
      answer: response.action,
      permission: response.action === "allow-permission" ? "allow" : "deny",
      permissionRequest: interaction.permissionRequest,
    },
  });
}

function answerWorkflowApproval(
  transition: WorkflowTransition,
  execution: ActivityExecution,
  interaction: HumanInteraction,
  response: HumanResponse,
  now: string,
): void {
  const run = transition.run;
  if (response.action === "approve") {
    run.approvedTreeHash = interaction.reviewedTreeHash ?? null;
    run.interaction = null;
    continueToActivity(transition, interaction.targetActivityId, now);
  } else if (response.action === "request-changes" && response.answer?.trim()) {
    resumeExecutionDispatch(transition, execution);
    execution.transcript.push({
      entryId: response.messageId,
      role: "user",
      content: response.answer,
      createdAt: now,
    });
    run.approvedTreeHash = null;
    dispatchActivityExecution(transition, execution, now, {
      ...buildCommand(
        run,
        execution,
        execution.sessionId ? "answer" : "execute",
      ),
      interaction: {
        interactionId: interaction.interactionId,
        answer: response.answer,
        permissionRequest: interaction.permissionRequest,
      },
    });
  }
}
