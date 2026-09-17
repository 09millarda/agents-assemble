export type Result<T, E = DomainError> = { ok: true; value: T } | { ok: false; error: E };

export type DomainError = { code: string; message: string };

export type DaemonId = string;

export interface DaemonConfiguration {
  displayName: string;
  maxParallelHarnesses: number;
  location: string;
  deviceLabel: string;
  purpose: string;
  ownerTeam: string;
  tags: string[];
  notes: string;
}

export type DaemonConfigurationApplyStatus = "pending" | "applied" | "failed";

export interface DaemonConfigurationState {
  desired: DaemonConfiguration;
  applied: DaemonConfiguration | null;
  revision: number;
  appliedRevision: number | null;
  status: DaemonConfigurationApplyStatus;
  failureReason: string | null;
}

export interface DaemonHarnessCapability {
  harness: string;
  version: string;
  models: Array<{ model: string; efforts: string[] }>;
  questions: boolean;
  permissions: boolean;
  structuredOutput: boolean;
}

export interface DaemonRuntimeFacts {
  machineName: string;
  operatingSystem: string;
  architecture: string;
  cpuCount: number;
  memoryBytes: number;
  daemonVersion: string;
  harnessVersions: Array<{ harness: string; version: string }>;
  capabilities: DaemonHarnessCapability[];
  lastSeenAt: string;
}

export interface DaemonTelemetry {
  activeHarnesses: number;
  queuedCommands: number;
  desiredMaxParallelHarnesses: number;
  appliedMaxParallelHarnesses: number;
}

export type DaemonLogDirection =
  | "daemon-to-api"
  | "api-to-daemon"
  | "local";

export type DaemonLogSource =
  | "websocket"
  | "daemon-stdout"
  | "daemon-stderr"
  | "harness-stdout"
  | "harness-stderr";

export interface DaemonLogEnvelope {
  eventId: string;
  daemonId: DaemonId;
  connectionSessionId: string;
  occurredAt: string;
  direction: DaemonLogDirection;
  source: DaemonLogSource;
  payload: string;
}

export const MIN_DAEMON_HARNESS_CAPACITY = 1;
export const MAX_DAEMON_HARNESS_CAPACITY = 10;

export function isDaemonHarnessCapacityValid(capacity: number): boolean {
  return (
    Number.isInteger(capacity) &&
    capacity >= MIN_DAEMON_HARNESS_CAPACITY &&
    capacity <= MAX_DAEMON_HARNESS_CAPACITY
  );
}

export function createDefaultDaemonConfiguration(
  machineName: string,
): DaemonConfiguration {
  return {
    displayName: machineName,
    maxParallelHarnesses: 1,
    location: "",
    deviceLabel: "",
    purpose: "",
    ownerTeam: "",
    tags: [],
    notes: "",
  };
}

export type DaemonStatus = "unknown" | "online" | "offline" | "busy" | "deregistered";

export interface DaemonSummary {
  daemonId: DaemonId;
  machineName: string;
  displayName: string;
  status: DaemonStatus;
  maxParallelHarnesses: number;
  appliedMaxParallelHarnesses: number | null;
  activeHarnesses: number;
  queuedCommands: number;
}

export interface DaemonDetails {
  daemonId: DaemonId;
  machineName: string;
  status: DaemonStatus;
  configuration: DaemonConfigurationState;
  runtimeFacts: DaemonRuntimeFacts | null;
  telemetry: DaemonTelemetry | null;
}

export function isDaemonReachable(status: DaemonStatus): boolean {
  return status === "online";
}

export function isDaemonDeregistered(status: DaemonStatus): boolean {
  return status === "deregistered";
}

export function canDeregisterDaemon(status: DaemonStatus): boolean {
  return status === "online" || status === "offline" || status === "busy";
}

export function resolveDaemonLiveStatus(persistedStatus: DaemonStatus, isSocketConnected: boolean): DaemonStatus {
  if (isDaemonDeregistered(persistedStatus)) return "deregistered";
  if (isSocketConnected) return "online";
  if (persistedStatus === "busy") return "busy";
  if (persistedStatus === "unknown") return "unknown";
  return "offline";
}

export type DeviceAuthorizationStatus = "pending" | "approved" | "denied" | "expired";

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
}

export type DeviceTokenErrorCode = "authorization_pending" | "slow_down" | "access_denied" | "expired_token";

export const DEVICE_AUTHORIZATION_LIFETIME_SECONDS = 10 * 60;

export function normalizeUserCode(userCode: string): string {
  return userCode.trim().toUpperCase().replace(/-/g, "");
}

export function isUserCodeValid(userCode: string): boolean {
  return /^[A-HJ-NP-Z2-9]{8}$/.test(normalizeUserCode(userCode));
}

export function isDeviceAuthorizationExpired(expiresAtMs: number, nowMs: number): boolean {
  return nowMs >= expiresAtMs;
}

export function canPollDeviceAuthorization(
  status: DeviceAuthorizationStatus,
  nowMs: number,
  expiresAtMs: number,
  lastPollAtMs: number,
  pollIntervalMs: number
): boolean {
  if (status !== "pending") return false;
  if (isDeviceAuthorizationExpired(expiresAtMs, nowMs)) return false;
  return nowMs - lastPollAtMs >= pollIntervalMs;
}

export function canApproveDeviceAuthorization(
  status: DeviceAuthorizationStatus,
  storedUserCode: string,
  enteredUserCode: string,
  nowMs: number,
  expiresAtMs: number
): boolean {
  if (status !== "pending") return false;
  if (isDeviceAuthorizationExpired(expiresAtMs, nowMs)) return false;
  if (!isUserCodeValid(storedUserCode) || !isUserCodeValid(enteredUserCode)) return false;
  return normalizeUserCode(storedUserCode) === normalizeUserCode(enteredUserCode);
}

export function shouldReuseDaemonIdentity(
  stored: { factoryApiUrl: string } | null,
  requestedApiUrl: string
): boolean {
  return stored !== null && stored.factoryApiUrl === requestedApiUrl;
}

export function hasDaemonMachineNameChanged(storedMachineName: string, helloMachineName: string): boolean {
  return storedMachineName !== helloMachineName;
}

export function compareDaemonIds(first: DaemonId, second: DaemonId): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

export interface ProjectInfo {
  projectId: string;
  name: string;
  absolutePath: string;
  daemonId: string | null;
  gitStatus: GitStatus;
  blockedReason: string | null;
  enabledWorkflowIds: string[];
  setupCommand?: string | null;
}

export type GitStatus = "unknown" | "valid" | "missing-path" | "not-a-repo" | "git-unavailable";

export type ProjectGitErrorCode = "PROJECT_NOT_FOUND" | "NOT_A_GIT_REPO" | "GIT_UNAVAILABLE";

export function isAbsoluteProjectPath(candidate: string): boolean {
  return candidate.startsWith("/") && candidate.trim().length > 0;
}

export function isProjectNameValid(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 100;
}

export function canRunInProject(gitStatus: GitStatus): boolean {
  return gitStatus === "valid";
}

export function describeProjectBlockedReason(gitStatus: GitStatus): string | null {
  if (gitStatus === "valid" || gitStatus === "unknown") return null;
  if (gitStatus === "missing-path") return "Project path does not exist on the assigned daemon.";
  if (gitStatus === "not-a-repo") return "Project path is not a git repository.";
  return "Git is unavailable on the assigned daemon.";
}

export function mapGitCheckToStatus(outcome: "ok" | "missing-path" | "not-a-repo" | "git-unavailable"): GitStatus {
  if (outcome === "ok") return "valid";
  return outcome;
}

export function mapGitStatusToErrorCode(gitStatus: GitStatus): ProjectGitErrorCode | null {
  if (gitStatus === "missing-path") return "PROJECT_NOT_FOUND";
  if (gitStatus === "not-a-repo") return "NOT_A_GIT_REPO";
  if (gitStatus === "git-unavailable") return "GIT_UNAVAILABLE";
  return null;
}

export function canEnableWorkflowForProject(project: ProjectInfo, workflowId: string): boolean {
  return workflowId.trim().length > 0 && !project.enabledWorkflowIds.includes(workflowId);
}

export function isWorkflowEnabledForProject(project: ProjectInfo, workflowId: string): boolean {
  return project.enabledWorkflowIds.includes(workflowId);
}

export function compareProjectNames(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}
