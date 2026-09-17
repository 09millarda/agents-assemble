import type { WorkflowRun, WorkflowTransition } from "./WorkflowRun";
export function createWorkflowNotifications(
  previous: WorkflowRun,
  transition: WorkflowTransition,
): void {
  const run = transition.run;
  const interaction = run.interaction;
  if (
    interaction &&
    interaction.interactionId !== previous.interaction?.interactionId
  ) {
    const kind =
      interaction.kind === "question" || interaction.kind === "permission"
        ? "question"
        : interaction.kind === "approval"
          ? "approval"
          : "recovery";
    transition.notifications.push({
      notificationId: `${interaction.interactionId}:notification`,
      runId: run.runId,
      recipientId: run.recipientId,
      kind,
      title: run.name,
      body: interaction.prompt,
      url: `/workflow-runs/${encodeURIComponent(run.runId)}`,
    });
  }
  if (
    ["completed", "cancelled", "failed"].includes(run.status) &&
    run.status !== previous.status &&
    !transition.notifications.some(
      (notification) => notification.notificationId === `${run.runId}:result`,
    )
  ) {
    transition.notifications.push({
      notificationId: `${run.runId}:result`,
      runId: run.runId,
      recipientId: run.recipientId,
      kind: "result",
      title: run.name,
      body: run.publication?.url ?? `Workflow ${run.status}`,
      url: `/workflow-runs/${encodeURIComponent(run.runId)}`,
    });
  }
}
