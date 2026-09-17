import { createWorkflowExecutionContainer } from "../../workflow-execution/infrastructure/workflowExecutionContainer";
import type { WorkflowConnectionHandler } from "../../daemon-connection/adapters/WebSocketDaemonConnectionAdapter";
import { Command } from "commander";
import { runDeviceLoginFlow } from "../application/loginFlow";
import { resolveFactoryApiUrl } from "../application/deviceLogin";
import { resolveMachineName } from "../application/machineName";
import {
  clearDaemonCredentials,
  loadDaemonCredentials,
  saveDaemonCredentials,
} from "../infrastructure/credentialStore";
import { openBrowserSafely } from "../infrastructure/browserOpener";
import { confirmDaemonDeletionFromStdin, waitForConfirmationFromStdin } from "../infrastructure/confirmationPrompt";
import { createAuthorizationWaitIndicator } from "../infrastructure/authorizationSpinner";
import {
  DaemonAuthenticationError,
  WebSocketDaemonConnectionAdapter,
} from "../../daemon-connection/adapters/WebSocketDaemonConnectionAdapter";
import { shouldReuseDaemonIdentity } from "@factory/shared-domain";
import type { StoredCredentials } from "../infrastructure/credentialStore";
import {
  deleteDaemonRegistration,
  resolveDaemonDeletionTarget,
  shouldClearLocalCredentials,
} from "../../daemon-connection/application/deleteDaemon";

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function reuseStoredDaemonId(factoryApiUrl: string, fresh: boolean): string | null {
  if (fresh) return null;
  const stored = loadDaemonCredentials();
  return stored && shouldReuseDaemonIdentity(stored, factoryApiUrl) ? stored.daemonId : null;
}

async function loginWithStableIdentity(
  explicitApiUrl: string | undefined,
  machineName: string,
  noBrowser: boolean,
  fresh: boolean
): Promise<StoredCredentials> {
  const factoryApiUrl = resolveFactoryApiUrl(explicitApiUrl);
  return runDeviceLoginFlow(explicitApiUrl, machineName, noBrowser, {
    existingDaemonId: reuseStoredDaemonId(factoryApiUrl, fresh),
    openUrl: openBrowserSafely,
    saveCredentials: saveDaemonCredentials,
    waitForConfirmation: waitForConfirmationFromStdin,
    waitIndicator: createAuthorizationWaitIndicator(),
  });
}

async function connectDaemonOnce(credentials: StoredCredentials, machineName: string, workflow: WorkflowConnectionHandler): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const connection = new WebSocketDaemonConnectionAdapter(
      credentials.daemonId,
      machineName,
      workflow,
      () => resolve(),
    );
    connection.connectToFactoryApi(credentials.factoryApiUrl, credentials.authToken).then(
      () => console.log(`daemon ${credentials.daemonId} connected`),
      (error: unknown) => reject(error)
    );
  });
}

async function startDaemonWithReconnect(credentials: StoredCredentials, machineName: string): Promise<never> {
  const workflow = await createWorkflowExecutionContainer(credentials.daemonId);
  let reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
  for (;;) {
    try {
      await connectDaemonOnce(credentials, machineName, workflow);
      console.log(`daemon ${credentials.daemonId} disconnected, reconnecting...`);
    } catch (error) {
      if (error instanceof DaemonAuthenticationError) throw error;
      console.log(`daemon connection failed: ${error instanceof Error ? error.message : "unknown"}, retrying...`);
    }
    await waitForDelay(reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_DELAY_MS);
  }
}

export function buildCliCommands(): Command {
  const program = new Command();
  program.name("cli").description("Authenticate this machine and run a machine-run daemon.");

  const auth = program.command("auth").description("Manage device authorization credentials.");

  auth
    .command("login")
    .option("--api-url <url>", "Factory API URL")
    .option("--machine-name <name>", "Machine name")
    .option("--no-browser", "Print the verification URL without opening a browser")
    .option("--fresh", "Mint a fresh daemon identity instead of reusing the stored one")
    .action(async (options: { apiUrl?: string; machineName?: string; browser?: boolean; fresh?: boolean }) => {
      const credentials = await loginWithStableIdentity(options.apiUrl, resolveMachineName(options.machineName), options.browser === false, options.fresh === true);
      void credentials;
    });

  auth.command("logout").action(() => {
    const cleared = clearDaemonCredentials();
    console.log(cleared ? "logged out — stored credentials cleared." : "not logged in — no stored credentials found.");
  });

  auth.command("status").action(() => {
    const credentials = loadDaemonCredentials();
    console.log(credentials ? `daemon ${credentials.daemonId} @ ${credentials.factoryApiUrl}` : "not logged in — run cli auth login first");
  });

  const daemon = program.command("daemon").description("Run a machine-run daemon.");
  daemon
    .command("start")
    .option("--api-url <url>", "Factory API URL")
    .option("--machine-name <name>", "Machine name")
    .option("--no-browser", "Print the verification URL without opening a browser")
    .option("--fresh", "Mint a fresh daemon identity instead of reusing the stored one")
    .action(async (options: { apiUrl?: string; machineName?: string; browser?: boolean; fresh?: boolean }) => {
      const factoryApiUrl = resolveFactoryApiUrl(options.apiUrl);
      const machineName = resolveMachineName(options.machineName);
      const fresh = options.fresh === true;
      let credentials = fresh ? null : loadDaemonCredentials();
      if (!credentials || credentials.factoryApiUrl !== factoryApiUrl) {
        console.log("no valid credentials — starting device login.");
        credentials = await loginWithStableIdentity(options.apiUrl, machineName, options.browser === false, fresh);
      }
      try {
        await startDaemonWithReconnect(credentials, machineName);
      } catch (error) {
        if (error instanceof DaemonAuthenticationError) {
          console.log("stored credentials were rejected — starting device login.");
          credentials = await loginWithStableIdentity(options.apiUrl, machineName, options.browser === false, fresh);
          await startDaemonWithReconnect(credentials, machineName);
        } else {
          throw error;
        }
      }
    });

  daemon
    .command("delete [daemonId]")
    .description("Deregister a daemon and clear local credentials when deleting self.")
    .option("--api-url <url>", "Factory API URL")
    .option("--yes", "Skip the stdin confirmation prompt")
    .action(async (daemonId?: string, options: { apiUrl?: string; yes?: boolean } = {}) => {
      const stored = loadDaemonCredentials();
      const target = resolveDaemonDeletionTarget(stored, daemonId, options.apiUrl);
      if (!target.ok) {
        console.log(target.error.message);
        process.exitCode = 1;
        return;
      }
      if (!options.yes) {
        const confirmed = await confirmDaemonDeletionFromStdin(target.value.daemonId);
        if (!confirmed) {
          console.log("delete cancelled — daemon ID did not match.");
          return;
        }
      }
      const result = await deleteDaemonRegistration(target.value.factoryApiUrl, target.value.daemonId);
      if (!result.ok) {
        console.log(`delete failed (${result.error.code}): ${result.error.message}`);
        process.exitCode = result.error.code === "DAEMON_NOT_FOUND" ? 1 : 1;
        return;
      }
      if (shouldClearLocalCredentials(stored, result.value.daemonId)) clearDaemonCredentials();
      console.log(`daemon ${result.value.daemonId} deregistered.`);
    });

  return program;
}
