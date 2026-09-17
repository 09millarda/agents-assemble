import { pollForDeviceCredentials, requestDeviceLogin, resolveFactoryApiUrl } from "./deviceLogin";
import type { DeviceFlowAuthorization, DeviceLoginOutcome, FetchImpl } from "./deviceLogin";
import type { StoredCredentials } from "../infrastructure/credentialStore";
import { waitForConfirmationFromStdin } from "../infrastructure/confirmationPrompt";
import type { AuthorizationWaitIndicator } from "../infrastructure/authorizationSpinner";

export interface LoginFlowDependencies {
  fetchImpl?: FetchImpl;
  sleepMs?: (delayMs: number) => Promise<void>;
  nowMs?: () => number;
  existingDaemonId?: string | null;
  openUrl?: (url: string) => Promise<boolean>;
  print?: (message: string) => void;
  saveCredentials?: (credentials: StoredCredentials) => void;
  waitForConfirmation?: () => Promise<void>;
  waitIndicator?: AuthorizationWaitIndicator;
}

const noopWaitIndicator: AuthorizationWaitIndicator = {
  start: () => {},
  stop: () => {},
};

export function formatLoginPrompt(authorization: DeviceFlowAuthorization): string {
  return `Go to ${authorization.verification_uri} and enter code ${authorization.user_code}`;
}

export async function runDeviceLoginFlow(
  explicitApiUrl: string | undefined,
  machineName: string,
  noBrowser: boolean,
  dependencies: LoginFlowDependencies = {}
): Promise<StoredCredentials> {
  const print = dependencies.print ?? console.log;
  const waitForConfirmation = dependencies.waitForConfirmation ?? waitForConfirmationFromStdin;
  const waitIndicator = dependencies.waitIndicator ?? noopWaitIndicator;
  const factoryApiUrl = resolveFactoryApiUrl(explicitApiUrl);
  const authorization = await requestDeviceLogin(factoryApiUrl, machineName, dependencies.fetchImpl, dependencies.existingDaemonId);
  print(formatLoginPrompt(authorization));
  print(`Device ${machineName} requests approval.`);
  print(`Code ${authorization.user_code}`);
  const browserNote = noBrowser ? "open manually with --no-browser" : "will open in browser";
  print(`Verify at ${authorization.verification_uri} (${browserNote})`);
  await waitForConfirmation();
  if (!noBrowser && dependencies.openUrl) {
    const opened = await dependencies.openUrl(authorization.verification_uri);
    if (!opened) print(`Open this URL manually: ${authorization.verification_uri}`);
  }
  waitIndicator.start();
  let outcome: DeviceLoginOutcome;
  try {
    outcome = await pollForDeviceCredentials(factoryApiUrl, authorization, dependencies);
  } finally {
    waitIndicator.stop();
  }
  if (!outcome.ok) throw new Error(`Login failed (${outcome.error.code}): ${outcome.error.message}`);
  dependencies.saveCredentials?.(outcome.credentials);
  print(`authorized daemon ${outcome.credentials.daemonId}`);
  return outcome.credentials;
}

export async function resolveDaemonCredentials(dependencies: {
  loadCredentials: () => StoredCredentials | null;
  factoryApiUrl: string;
  probeCredentials: (credentials: StoredCredentials) => Promise<boolean>;
  runLogin: () => Promise<StoredCredentials>;
}): Promise<StoredCredentials> {
  const stored = dependencies.loadCredentials();
  if (stored && stored.factoryApiUrl === dependencies.factoryApiUrl) {
    const isValid = await dependencies.probeCredentials(stored);
    if (isValid) return stored;
  }
  return dependencies.runLogin();
}
