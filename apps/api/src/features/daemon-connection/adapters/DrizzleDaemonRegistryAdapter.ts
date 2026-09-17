import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { and, daemons, eq, ne, sql } from "@factory/db";
import {
  createDefaultDaemonConfiguration,
  isDaemonDeregistered,
} from "@factory/shared-domain";
import type {
  DaemonConfiguration,
  DaemonConfigurationApplyStatus,
  DaemonDetails,
  DaemonId,
  DaemonRuntimeFacts,
  DaemonSummary,
} from "@factory/shared-domain";
import type { DeregisterOutcome, DaemonRegistryPort } from "../domain/DaemonConnectionPort";
import type {
  DaemonConfigurationPort,
  DaemonConfigurationStatePort,
  DaemonQueryPort,
  DaemonRuntimeFactsPort,
} from "../domain/DaemonConfigurationPort";
import type { Database } from "@factory/db";

const daemonDetailsSelection = {
  daemonId: daemons.daemonId,
  machineName: daemons.machineName,
  status: daemons.status,
  displayName: daemons.displayName,
  maxParallelHarnesses: daemons.maxParallelHarnesses,
  metadata: daemons.metadata,
  configurationRevision: daemons.configurationRevision,
  appliedConfiguration: daemons.appliedConfiguration,
  appliedConfigurationRevision: daemons.appliedConfigurationRevision,
  configurationApplyStatus: daemons.configurationApplyStatus,
  configurationFailureReason: daemons.configurationFailureReason,
  runtimeFacts: daemons.runtimeFacts,
};

function hashAuthToken(authToken: string): string {
  return createHash("sha256").update(authToken).digest("hex");
}

export class DrizzleDaemonRegistryAdapter
  implements
    DaemonRegistryPort,
    DaemonQueryPort,
    DaemonConfigurationPort,
    DaemonConfigurationStatePort,
    DaemonRuntimeFactsPort
{
  constructor(private readonly database: Database) {}

  async issueDaemonCredentials(machineName: string, existingDaemonId?: DaemonId | null) {
    const authToken = randomBytes(24).toString("hex");
    const authTokenHash = hashAuthToken(authToken);
    if (existingDaemonId) {
      const rows = await this.database.select().from(daemons).where(eq(daemons.daemonId, existingDaemonId)).limit(1);
      const existing = rows[0];
      if (existing && !isDaemonDeregistered((existing.status ?? "unknown") as DaemonSummary["status"])) {
        await this.database
          .update(daemons)
          .set({ machineName, status: "online", authTokenHash })
          .where(eq(daemons.daemonId, existingDaemonId));
        return { daemonId: existingDaemonId, authToken, authTokenHash };
      }
    }
    const daemonId = randomBytes(8).toString("hex");
    await this.database.insert(daemons).values({
      daemonId,
      machineName,
      displayName: machineName,
      status: "online",
      authTokenHash,
    });
    return { daemonId, authToken, authTokenHash };
  }

  async findDaemon(daemonId: DaemonId): Promise<DaemonDetails | null> {
    const rows = await this.database
      .select(daemonDetailsSelection)
      .from(daemons)
      .where(eq(daemons.daemonId, daemonId))
      .limit(1);
    return rows[0] ? toDaemonDetails(toDaemonDetailsRow(rows[0])) : null;
  }

  async saveDesiredConfiguration(
    daemonId: DaemonId,
    configuration: DaemonConfiguration,
  ): Promise<DaemonDetails | null> {
    const existing = await this.findDaemon(daemonId);
    if (!existing || isDaemonDeregistered(existing.status)) return null;
    const { displayName, maxParallelHarnesses, ...metadata } = configuration;
    await this.database
      .update(daemons)
      .set({
        displayName,
        maxParallelHarnesses,
        metadata,
        configurationRevision: sql`${daemons.configurationRevision} + 1`,
        configurationApplyStatus: "pending",
        configurationFailureReason: null,
      })
      .where(eq(daemons.daemonId, daemonId));
    return this.findDaemon(daemonId);
  }

  async recordAppliedConfiguration(
    daemonId: DaemonId,
    revision: number,
  ): Promise<DaemonDetails | null> {
    const existing = await this.findDaemon(daemonId);
    if (!existing || existing.configuration.revision !== revision) return existing;
    await this.database
      .update(daemons)
      .set({
        appliedConfiguration: existing.configuration.desired,
        appliedConfigurationRevision: revision,
        configurationApplyStatus: "applied",
        configurationFailureReason: null,
      })
      .where(
        and(
          eq(daemons.daemonId, daemonId),
          eq(daemons.configurationRevision, revision),
        ),
      );
    return this.findDaemon(daemonId);
  }

  async recordRejectedConfiguration(
    daemonId: DaemonId,
    revision: number,
    reason: string,
  ): Promise<DaemonDetails | null> {
    const existing = await this.findDaemon(daemonId);
    if (!existing || existing.configuration.revision !== revision) return existing;
    await this.database
      .update(daemons)
      .set({
        configurationApplyStatus: "failed",
        configurationFailureReason: reason,
      })
      .where(
        and(
          eq(daemons.daemonId, daemonId),
          eq(daemons.configurationRevision, revision),
        ),
      );
    return this.findDaemon(daemonId);
  }

  async recordRuntimeFacts(
    daemonId: DaemonId,
    facts: DaemonRuntimeFacts,
  ): Promise<DaemonDetails | null> {
    await this.database
      .update(daemons)
      .set({ runtimeFacts: facts })
      .where(eq(daemons.daemonId, daemonId));
    return this.findDaemon(daemonId);
  }

  async updateDaemonOnHello(daemonId: DaemonId, machineName: string): Promise<void> {
    const rows = await this.database.select().from(daemons).where(eq(daemons.daemonId, daemonId)).limit(1);
    const existing = rows[0];
    if (!existing) return;
    if (isDaemonDeregistered((existing.status ?? "unknown") as DaemonSummary["status"])) return;
    await this.database.update(daemons).set({ machineName, status: "online" }).where(eq(daemons.daemonId, daemonId));
  }

  async verifyDaemonToken(daemonId: string, authToken: string): Promise<boolean> {
    const rows = await this.database.select().from(daemons).where(eq(daemons.daemonId, daemonId)).limit(1);
    const row = rows[0];
    if (!row) return false;
    if (isDaemonDeregistered((row.status ?? "unknown") as DaemonSummary["status"])) return false;
    const expected = Buffer.from(row.authTokenHash);
    const actual = Buffer.from(hashAuthToken(authToken));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  async listKnownDaemons() {
    const rows = await this.database
      .select({ daemonId: daemons.daemonId })
      .from(daemons)
      .where(ne(daemons.status, "deregistered"));
    return rows.map((row) => row.daemonId);
  }

  async listDaemons(): Promise<DaemonSummary[]> {
    const rows = await this.database
      .select({
        daemonId: daemons.daemonId,
        machineName: daemons.machineName,
        displayName: daemons.displayName,
        status: daemons.status,
        maxParallelHarnesses: daemons.maxParallelHarnesses,
        appliedConfiguration: daemons.appliedConfiguration,
      })
      .from(daemons)
      .where(ne(daemons.status, "deregistered"));
    return rows.map((row) => toDaemonSummary(row as DaemonSummaryRow));
  }

  async deregisterDaemon(daemonId: DaemonId): Promise<DeregisterOutcome> {
    const rows = await this.database.select().from(daemons).where(eq(daemons.daemonId, daemonId)).limit(1);
    const row = rows[0];
    if (!row) return "not-found";
    if (isDaemonDeregistered((row.status ?? "unknown") as DaemonSummary["status"])) return "already-deregistered";
    await this.database.update(daemons).set({ status: "deregistered" }).where(eq(daemons.daemonId, daemonId));
    return "deregistered";
  }
}

export interface DaemonSummaryRow {
  daemonId: string;
  machineName: string;
  displayName?: string;
  status: string | null;
  maxParallelHarnesses?: number;
  appliedConfiguration?: Partial<DaemonConfiguration> | null;
}

export type DaemonConfigurationMetadata = Omit<
  DaemonConfiguration,
  "displayName" | "maxParallelHarnesses"
>;

export interface DaemonDetailsRow extends DaemonSummaryRow {
  displayName: string;
  maxParallelHarnesses: number;
  metadata: Partial<DaemonConfigurationMetadata>;
  configurationRevision: number;
  appliedConfiguration: Partial<DaemonConfiguration> | null;
  appliedConfigurationRevision: number | null;
  configurationApplyStatus: string;
  configurationFailureReason: string | null;
  runtimeFacts: DaemonRuntimeFacts | null;
}

function toDaemonDetailsRow(
  row: unknown,
): DaemonDetailsRow {
  return row as DaemonDetailsRow;
}

export function toDaemonSummary(row: DaemonSummaryRow): DaemonSummary {
  return {
    daemonId: row.daemonId,
    machineName: row.machineName,
    displayName: row.displayName ?? row.machineName,
    status: (row.status ?? "unknown") as DaemonSummary["status"],
    maxParallelHarnesses: row.maxParallelHarnesses ?? 1,
    appliedMaxParallelHarnesses:
      row.appliedConfiguration?.maxParallelHarnesses ?? null,
    activeHarnesses: 0,
    queuedCommands: 0,
  };
}

export function toDaemonDetails(row: DaemonDetailsRow): DaemonDetails {
  const desiredConfiguration = completeDaemonConfiguration(row.machineName, {
    ...row.metadata,
    displayName: row.displayName,
    maxParallelHarnesses: row.maxParallelHarnesses,
  });
  return {
    daemonId: row.daemonId,
    machineName: row.machineName,
    status: (row.status ?? "unknown") as DaemonDetails["status"],
    configuration: {
      desired: desiredConfiguration,
      applied: row.appliedConfiguration
        ? completeDaemonConfiguration(row.machineName, row.appliedConfiguration)
        : null,
      revision: row.configurationRevision,
      appliedRevision: row.appliedConfigurationRevision,
      status:
        row.configurationApplyStatus as DaemonConfigurationApplyStatus,
      failureReason: row.configurationFailureReason,
    },
    runtimeFacts: row.runtimeFacts,
    telemetry: null,
  };
}

function completeDaemonConfiguration(
  machineName: string,
  configuration: Partial<DaemonConfiguration>,
): DaemonConfiguration {
  return {
    ...createDefaultDaemonConfiguration(machineName),
    ...configuration,
  };
}

export function filterActiveDaemons(rows: DaemonSummaryRow[]): DaemonSummaryRow[] {
  return rows.filter((row) => (row.status ?? "unknown") !== "deregistered");
}
