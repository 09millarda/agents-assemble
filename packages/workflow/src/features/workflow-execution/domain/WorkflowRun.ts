import type {
  Activity,
  WorkflowDefinition,
} from "../../workflow-definition/domain/WorkflowDefinition";
export interface RunWorkspace {
  requirePublication?: boolean;
  projectPath: string;
  branch?: string;
  pinnedCommit?: string;
  setupCommand?: string;
  repository?: string;
  pushRemote?: string;
  prBase?: string;
}
export interface WorkspaceResult {
  worktreePath: string;
  branch: string;
  pinnedCommit: string;
  treeHash?: string;
  diff?: string;
  setupLog?: string;
  repository?: string;
  pushRemote?: string;
  prBase?: string;
}
export interface BoundDocument {
  documentId: string;
  name: string;
  revisionId: string;
  content: string;
}
export interface DocumentRevision {
  revisionId: string;
  runId: string;
  documentId: string;
  name: string;
  revision: number;
  executionId: string;
  activityId: string;
  content: string;
  consumedRevisionIds: string[];
  createdAt: string;
}
export interface CompletionContract {
  outcome: string;
  outputs?: { documentId: string; content: string }[];
}
export interface TranscriptEntry {
  entryId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}
export interface ActivityExecution {
  executionId: string;
  activityId: string;
  activity: Activity;
  status: "running" | "awaiting-human" | "completed" | "failed" | "cancelled";
  inputRevisionIds: string[];
  outputRevisionIds: string[];
  sessionId: string | null;
  transcript: TranscriptEntry[];
  dispatchSequence: number;
  harnessTurnIds: string[];
  recoveryAttempt: number;
  commandId: string;
  outcome: string | null;
  error: string | null;
}
export interface HumanInteraction {
  interactionId: string;
  executionId: string;
  kind: "question" | "permission" | "approval" | "loop-exhaustion" | "recovery";
  prompt: string;
  outputRevisionIds: string[];
  targetActivityId: string | null;
  loopId?: string;
  reviewedTreeHash?: string;
  permissionRequest?: unknown;
}
export interface WorkflowRun {
  runId: string;
  name: string;
  projectId: string;
  workflowId: string;
  daemonId: string;
  recipientId: string | null;
  snapshot: WorkflowDefinition;
  workspace: RunWorkspace;
  workspaceResult: WorkspaceResult | null;
  kickoffPrompt: string | null;
  status:
    | "queued"
    | "running"
    | "awaiting-human"
    | "recovery-required"
    | "completed"
    | "cancelled"
    | "failed";
  executions: ActivityExecution[];
  documents: DocumentRevision[];
  interaction: HumanInteraction | null;
  loopPasses: Record<string, number>;
  loopLimits: Record<string, number>;
  processedMessageIds: string[];
  approvedTreeHash: string | null;
  acceptedFindings: boolean;
  acceptedFindingRevisionIds: string[];
  publication: { url: string; number?: number } | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface WorkflowDaemonCommand {
  commandId: string;
  executionId: string;
  runId: string;
  daemonId: string;
  kind: "execute" | "answer" | "cancel" | "reconcile";
  activity: Activity;
  workspace: RunWorkspace;
  workspaceResult?: WorkspaceResult;
  documents: BoundDocument[];
  documentContracts: { documentId: string; name: string }[];
  kickoffPrompt: string | null;
  sessionId?: string;
  interaction?: {
    interactionId: string;
    answer: string;
    permission?: "allow" | "deny";
    permissionRequest?: unknown;
  };
  approvedTreeHash?: string;
  acceptedFindings?: boolean;
  acceptedFindingsDocuments?: BoundDocument[];
  recoveryAuthorized?: boolean;
}
export interface WorkflowDaemonFact {
  factId: string;
  commandId: string;
  executionId: string;
  runId: string;
  type:
    | "received"
    | "progress"
    | "question"
    | "permission"
    | "completed"
    | "failed"
    | "recovery_required"
    | "cancelled";
  harnessTurnId?: string;
  code?: string;
  message?: string;
  sessionId?: string;
  interactionId?: string;
  permissionRequest?: unknown;
  completion?: CompletionContract;
  workspaceResult?: WorkspaceResult;
  publication?: { url: string; number?: number };
}
export interface HumanResponse {
  messageId: string;
  runId: string;
  interactionId?: string;
  action:
    | "answer"
    | "approve"
    | "request-changes"
    | "extend-loop"
    | "accept-findings"
    | "retry"
    | "cancel"
    | "allow-permission"
    | "deny-permission";
  answer?: string;
  additionalPasses?: number;
}
export type WorkflowMessage =
  | { kind: "start"; messageId: string }
  | { kind: "human"; response: HumanResponse }
  | { kind: "fact"; fact: WorkflowDaemonFact };
export interface WorkflowNotification {
  notificationId: string;
  runId: string;
  recipientId: string | null;
  kind: "question" | "approval" | "recovery" | "result";
  title: string;
  body: string;
  url: string;
}
export interface WorkflowTransition {
  run: WorkflowRun;
  commands: WorkflowDaemonCommand[];
  notifications: WorkflowNotification[];
}
