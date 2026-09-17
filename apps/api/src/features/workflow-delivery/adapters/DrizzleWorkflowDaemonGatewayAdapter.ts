import {
  and,
  eq,
  isNull,
  workflowCommands,
  workflowRuns,
  type Database,
} from "@factory/db";
import type {
  HarnessCapability,
  WorkflowDaemonCommand,
  WorkflowDaemonFact,
  WorkflowRun,
} from "@factory/workflow";
import type { WorkflowRunPort } from "../../workflow-management/domain/WorkflowStorePort";
import type { WorkflowDaemonGatewayPort } from "../domain/WorkflowDaemonGatewayPort";
import type { DaemonCapabilityPort } from "../domain/DaemonCapabilityPort";
import type { DaemonSocketRegistry } from "../../daemon-connection/infrastructure/daemonSocketRegistry";
export class DrizzleWorkflowDaemonGatewayAdapter
  implements WorkflowDaemonGatewayPort, DaemonCapabilityPort
{
  private readonly capabilities = new Map<string, HarnessCapability[]>();
  constructor(
    private readonly database: Database,
    private readonly sockets: DaemonSocketRegistry,
    private readonly runs: WorkflowRunPort,
  ) {}
  async connectDaemon(
    daemonId: string,
    capabilities: HarnessCapability[],
  ): Promise<void> {
    this.capabilities.set(daemonId, structuredClone(capabilities));
    await this.deliverPendingCommands(daemonId, true);
  }
  getCapabilities(daemonId: string): HarnessCapability[] {
    return this.sockets.isDaemonConnected(daemonId)
      ? structuredClone(this.capabilities.get(daemonId) ?? [])
      : [];
  }
  async acceptFact(
    daemonId: string,
    fact: WorkflowDaemonFact,
  ): Promise<boolean> {
    const [command] = await this.database
      .select()
      .from(workflowCommands)
      .where(
        and(
          eq(workflowCommands.commandId, fact.commandId),
          eq(workflowCommands.daemonId, daemonId),
          eq(workflowCommands.runId, fact.runId),
          eq(workflowCommands.executionId, fact.executionId),
        ),
      )
      .limit(1);
    if (!command) return false;
    const accepted = await this.runs.submitMessage(fact.runId, fact.factId, {
      kind: "fact",
      fact,
    });
    if (accepted === "conflict") return false;
    await this.database
      .update(workflowCommands)
      .set({ receivedAt: new Date() })
      .where(eq(workflowCommands.commandId, fact.commandId));
    return true;
  }
  async deliverPendingCommands(
    daemonId?: string,
    includeReceived = false,
  ): Promise<void> {
    const rows = await this.database
      .select({ command: workflowCommands.payload, state: workflowRuns.state })
      .from(workflowCommands)
      .innerJoin(workflowRuns, eq(workflowRuns.runId, workflowCommands.runId))
      .where(
        and(
          ...(daemonId ? [eq(workflowCommands.daemonId, daemonId)] : []),
          ...(includeReceived ? [] : [isNull(workflowCommands.receivedAt)]),
        ),
      );
    for (const row of rows) {
      const command = row.command as WorkflowDaemonCommand;
      const run = row.state as WorkflowRun;
      if (canDeliverCommand(command, run))
        this.sockets.sendToDaemon(
          command.daemonId,
          JSON.stringify({ type: "workflow.command", command }),
        );
    }
  }
}
function canDeliverCommand(
  command: WorkflowDaemonCommand,
  run: WorkflowRun,
): boolean {
  if (command.kind === "cancel") return run.status === "cancelled";
  if (["completed", "cancelled", "failed"].includes(run.status)) return false;
  return run.executions.at(-1)?.commandId === command.commandId;
}
