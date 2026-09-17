import type { WorkflowRun } from "@factory/workflow";
import type { BrowserNotificationPort } from "../../browser-recipient/domain/BrowserNotificationPort";
import type { BrowserRecipientPort } from "../../browser-recipient/domain/BrowserRecipientPort";
import type {
  StartWorkflowRun as StartWorkflowRunCommand,
  WorkflowRunPort,
} from "../../workflow-run/domain/WorkflowRunPort";

export interface WorkflowRunNavigationPort {
  openRun(runId: string): Promise<void>;
}

export interface StartWorkflowRunInput {
  runs: Pick<WorkflowRunPort, "startRun">;
  browser: BrowserNotificationPort;
  recipients: BrowserRecipientPort;
  navigation: WorkflowRunNavigationPort;
  resolveRequestId: (input: Omit<StartWorkflowRunCommand, "requestId">) => string;
  projectId: string;
  workflowId: string;
  kickoffPrompt: string;
  branch: string;
  notifyBrowser: boolean;
}

export async function startWorkflowRun({
  runs,
  browser,
  recipients,
  navigation,
  resolveRequestId,
  projectId,
  workflowId,
  kickoffPrompt,
  branch,
  notifyBrowser,
}: StartWorkflowRunInput): Promise<WorkflowRun> {
  const credential = notifyBrowser ? browser.loadCredential() : null;
  const status = credential ? await recipients.getStatus(credential) : null;
  const input = {
    projectId,
    workflowId,
    ...(kickoffPrompt.trim() ? { kickoffPrompt: kickoffPrompt.trim() } : {}),
    ...(branch.trim() ? { branch: branch.trim() } : {}),
    ...(credential && status?.active ? credential : {}),
  };
  const created = await runs.startRun({
    ...input,
    requestId: resolveRequestId(input),
  });
  await navigation.openRun(created.runId);
  return created;
}
