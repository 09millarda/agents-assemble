import pg, { type PoolClient } from "pg";
import { type ContextName, DomainError, type Message, MessageSchema } from "./contracts.ts";
import { digest, newId } from "./crypto.ts";

export interface RecordEnvelope<T = unknown> {
  id: string;
  organizationId: string;
  kind: string;
  version: number;
  data: T;
  createdAt: string;
  updatedAt: string;
}
export interface CommandMeta {
  organizationId: string;
  actorId: string;
  operation: string;
  operationId: string;
  request: unknown;
  correlationId?: string;
  authorityExpiresAt?: string;
}
type Row = {
  id: string;
  organization_id: string;
  kind: string;
  version: number;
  data: unknown;
  created_at: Date;
  updated_at: Date;
};
function record<T>(row: Row): RecordEnvelope<T> {
  return {
    id: row.id,
    organizationId: row.organization_id,
    kind: row.kind,
    version: row.version,
    data: row.data as T,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** A transaction has access to exactly one context and one organization. */
export class Transaction {
  private events: Message[] = [];
  private eventKinds = new Map<string, string>();
  constructor(
    private client: PoolClient,
    public readonly context: ContextName,
    public readonly meta: CommandMeta,
  ) {}
  async now(): Promise<Date> {
    const result = await this.client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    return result.rows[0].now;
  }
  async get<T = unknown>(kind: string, id: string): Promise<RecordEnvelope<T> | undefined> {
    const result = await this.client.query<Row>(
      `SELECT * FROM ${this.context}.aggregates WHERE organization_id=$1 AND kind=$2 AND id=$3 FOR UPDATE`,
      [this.meta.organizationId, kind, id],
    );
    return result.rows[0] ? record<T>(result.rows[0]) : undefined;
  }
  async require<T = unknown>(kind: string, id: string): Promise<RecordEnvelope<T>> {
    const found = await this.get<T>(kind, id);
    if (!found)
      throw new DomainError("not_found", "The resource is unavailable in this organization", 404);
    return found;
  }
  async list<T = unknown>(kind: string, limit = 500): Promise<RecordEnvelope<T>[]> {
    const result = await this.client.query<Row>(
      `SELECT * FROM ${this.context}.aggregates WHERE organization_id=$1 AND kind=$2 ORDER BY created_at,id LIMIT $3`,
      [this.meta.organizationId, kind, limit],
    );
    return result.rows.map(record<T>);
  }
  async find<T = unknown>(
    kind: string,
    filter: Record<string, unknown>,
    options: { limit?: number; offset?: number } = {},
  ): Promise<RecordEnvelope<T>[]> {
    const result = await this.client.query<Row>(
      `SELECT * FROM ${this.context}.aggregates WHERE organization_id=$1 AND kind=$2 AND data @> $3::jsonb ORDER BY created_at,id LIMIT $4 OFFSET $5`,
      [
        this.meta.organizationId,
        kind,
        JSON.stringify(filter),
        Math.min(options.limit ?? 500, 10000),
        options.offset ?? 0,
      ],
    );
    return result.rows.map(record<T>);
  }
  async all<T = unknown>(
    kind: string,
    filter: Record<string, unknown> = {},
  ): Promise<RecordEnvelope<T>[]> {
    const result: RecordEnvelope<T>[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await this.find<T>(kind, filter, { limit: 500, offset });
      result.push(...page);
      if (page.length < 500) return result;
    }
  }
  async put<T>(kind: string, id: string, data: T, expectedVersion = 0): Promise<RecordEnvelope<T>> {
    const current = await this.get(kind, id);
    if ((current?.version ?? 0) !== expectedVersion)
      throw new DomainError(
        "version_conflict",
        "The resource changed; refresh before deciding",
        409,
        "never",
        current?.version ?? 0,
      );
    const result = await this.client.query<Row>(
      `INSERT INTO ${this.context}.aggregates(organization_id,kind,id,version,data)
      VALUES($1,$2,$3,1,$4) ON CONFLICT(organization_id,kind,id) DO UPDATE SET
      version=${this.context}.aggregates.version+1,data=EXCLUDED.data,updated_at=clock_timestamp() RETURNING *`,
      [this.meta.organizationId, kind, id, JSON.stringify(data)],
    );
    const saved = record<T>(result.rows[0]);
    await this.client.query(
      `INSERT INTO ${this.context}.revisions(organization_id,kind,aggregate_id,version,data,digest,actor_id,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        this.meta.organizationId,
        kind,
        id,
        saved.version,
        JSON.stringify(data),
        digest(data),
        this.meta.actorId,
        this.meta.operationId,
      ],
    );
    return saved;
  }
  async emit(
    type: string,
    aggregate: Pick<RecordEnvelope, "id" | "version" | "kind">,
    payload: Message["payload"],
  ): Promise<Message> {
    const count = await this.client.query<{ sequence: number }>(
      `SELECT COALESCE(MAX(sequence),0)::int+1 AS sequence FROM ${this.context}.outbox WHERE organization_id=$1 AND aggregate_id=$2`,
      [this.meta.organizationId, aggregate.id],
    );
    const message = MessageSchema.parse({
      id: newId(),
      organizationId: this.meta.organizationId,
      source: this.context,
      type,
      schemaVersion: 1,
      aggregateId: aggregate.id,
      aggregateVersion: aggregate.version,
      sequence: count.rows[0].sequence,
      causationId: this.meta.operationId,
      correlationId: this.meta.correlationId ?? this.meta.operationId,
      occurredAt: (await this.now()).toISOString(),
      payload,
    });
    message.sequence += this.events.filter(
      (event) => event.aggregateId === message.aggregateId,
    ).length;
    this.events.push(message);
    this.eventKinds.set(message.id, aggregate.kind);
    return message;
  }
  async flush() {
    for (const message of this.events) {
      const current = await this.client.query<{ version: number }>(
        `SELECT version FROM ${this.context}.aggregates WHERE organization_id=$1 AND id=$2 AND kind=$3`,
        [this.meta.organizationId, message.aggregateId, this.eventKinds.get(message.id)],
      );
      if (current.rows.length !== 1) throw new Error("outbox_aggregate_unavailable");
      message.aggregateVersion = current.rows[0].version;
      await this.client.query(
        `INSERT INTO ${this.context}.outbox(id,organization_id,aggregate_id,sequence,message) VALUES($1,$2,$3,$4,$5)`,
        [
          message.id,
          message.organizationId,
          message.aggregateId,
          message.sequence,
          JSON.stringify(message),
        ],
      );
      await this.client.query(`INSERT INTO ${this.context}.delivery(message_id) VALUES($1)`, [
        message.id,
      ]);
    }
    this.events = [];
    this.eventKinds.clear();
  }
  async retryDelivery(id: string, expectedAttempts: number, reason: string) {
    const result = await this.client.query<{ attempts: number; delivered_at: Date | null }>(
      `SELECT d.attempts,d.delivered_at FROM ${this.context}.delivery d JOIN ${this.context}.outbox o ON o.id=d.message_id WHERE o.id=$1 AND o.organization_id=$2 FOR UPDATE OF d`,
      [id, this.meta.organizationId],
    );
    const current = result.rows[0];
    if (!current) throw new DomainError("not_found", "Message unavailable", 404);
    if (current.attempts !== expectedAttempts)
      throw new DomainError(
        "version_conflict",
        "Delivery attempts changed; refresh before retry",
        409,
        "never",
        current.attempts,
      );
    const receipt = await this.put("operator-action", newId(), {
      action: "retry-delivery",
      messageId: id,
      expectedAttempts,
      reason,
      actorId: this.meta.actorId,
    });
    await this.client.query(
      `UPDATE ${this.context}.delivery SET delivered_at=NULL,poison=false,available_at=clock_timestamp() WHERE message_id=$1`,
      [id],
    );
    return { status: "pending" as const, receiptId: receipt.id };
  }
  async receive(message: Message) {
    const previous = await this.client.query<{ sequence: number }>(
      `SELECT sequence FROM ${this.context}.inbox_cursor WHERE organization_id=$1 AND source=$2 AND aggregate_id=$3 FOR UPDATE`,
      [this.meta.organizationId, message.source, message.aggregateId],
    );
    const sequence = previous.rows[0]?.sequence ?? 0;
    if (message.sequence !== sequence + 1)
      throw new Error(
        `inbox_gap:${message.source}:${message.aggregateId}:${sequence + 1}:${message.sequence}`,
      );
    await this.client.query(
      `INSERT INTO ${this.context}.inbox(organization_id,source,message_id,aggregate_id,sequence,payload_digest) VALUES($1,$2,$3,$4,$5,$6)`,
      [
        this.meta.organizationId,
        message.source,
        message.id,
        message.aggregateId,
        message.sequence,
        digest(message),
      ],
    );
    await this.client.query(
      `INSERT INTO ${this.context}.inbox_cursor(organization_id,source,aggregate_id,sequence) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,source,aggregate_id) DO UPDATE SET sequence=EXCLUDED.sequence`,
      [this.meta.organizationId, message.source, message.aggregateId, message.sequence],
    );
  }
}

export class ContextStore {
  private pool: pg.Pool;
  constructor(
    public readonly context: ContextName,
    databaseUrl: string,
  ) {
    this.pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 6,
      application_name: `aa-${context}`,
    });
  }
  async close() {
    await this.pool.end();
  }
  private async transaction<T>(
    organizationId: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE aa_${this.context}`);
      // One context-local tenant lock serializes authority and aggregate invariants. No global lock.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${this.context}:${organizationId}`,
      ]);
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async command<T>(meta: CommandMeta, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.execute(meta, work);
  }
  private async execute<T>(
    meta: CommandMeta,
    work: (tx: Transaction) => Promise<T>,
    incoming?: Message,
  ): Promise<T> {
    const hash = digest({ actorId: meta.actorId, request: meta.request });
    const stored = await this.transaction(meta.organizationId, async (client) => {
      const prior = await client.query<{
        request_digest: string;
        result: {
          value?: T;
          error?: {
            code: string;
            message: string;
            status: number;
            retry: "never" | "same_operation" | "reconcile";
            currentVersion?: number;
          };
        };
      }>(
        `SELECT request_digest,result FROM ${this.context}.idempotency WHERE organization_id=$1 AND operation=$2 AND operation_id=$3`,
        [meta.organizationId, meta.operation, meta.operationId],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_digest !== hash)
          throw new DomainError(
            "idempotency_conflict",
            "This operation identity was already used for different content",
            409,
          );
        return prior.rows[0].result;
      }
      const tx = new Transaction(client, this.context, meta);
      if (incoming) await tx.receive(incoming);
      await client.query("SAVEPOINT command_work");
      let result: {
        value?: T;
        error?: {
          code: string;
          message: string;
          status: number;
          retry: "never" | "same_operation" | "reconcile";
          currentVersion?: number;
        };
      };
      try {
        if (meta.authorityExpiresAt && new Date(meta.authorityExpiresAt) <= (await tx.now()))
          throw new DomainError(
            "authority_expired",
            "The bounded access decision expired; refresh before a new operation",
            403,
          );
        result = { value: await work(tx) };
        if (meta.authorityExpiresAt && new Date(meta.authorityExpiresAt) <= (await tx.now()))
          throw new DomainError(
            "authority_expired",
            "The bounded access decision expired before acceptance",
            403,
          );
        await tx.flush();
      } catch (error) {
        if (!(error instanceof DomainError) || error.retry === "same_operation") throw error;
        await client.query("ROLLBACK TO SAVEPOINT command_work");
        result = {
          error: {
            code: error.code,
            message: error.message,
            status: error.status,
            retry: error.retry,
            ...(error.currentVersion === undefined ? {} : { currentVersion: error.currentVersion }),
          },
        };
      }
      await client.query(
        `INSERT INTO ${this.context}.idempotency(organization_id,operation,operation_id,request_digest,actor_id,result) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          meta.organizationId,
          meta.operation,
          meta.operationId,
          hash,
          meta.actorId,
          JSON.stringify(result),
        ],
      );
      return result;
    });
    if (stored.error)
      throw new DomainError(
        stored.error.code,
        stored.error.message,
        stored.error.status,
        stored.error.retry,
        stored.error.currentVersion,
      );
    return stored.value as T;
  }
  /** Autonomous timer work is conditional on durable state, not a replayable external command.
   * Empty polls leave no idempotency rows; actual writes retain normal audit and outbox records. */
  async schedule<T>(
    organizationId: string,
    operation: string,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.transaction(organizationId, async (client) => {
      const tx = new Transaction(client, this.context, {
        organizationId,
        actorId: "scheduler",
        operation,
        operationId: newId(),
        request: {},
      });
      const result = await work(tx);
      await tx.flush();
      return result;
    });
  }
  async read<T>(organizationId: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.transaction(organizationId, (client) =>
      work(
        new Transaction(client, this.context, {
          organizationId,
          actorId: "system",
          operation: "read",
          operationId: "read",
          request: null,
        }),
      ),
    );
  }
  async consume<T>(
    message: Message,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T | { accepted: false; code: string }> {
    MessageSchema.parse(message);
    try {
      return await this.execute(
        {
          organizationId: message.organizationId,
          actorId: message.source,
          operation: `inbox:${message.source}`,
          operationId: message.id,
          request: message,
          correlationId: message.correlationId,
        },
        work,
        message,
      );
    } catch (error) {
      // A definitive domain rejection is a consumed verdict. Transport/gap errors
      // roll back both the inbox and work and remain eligible for delivery retry.
      if (
        error instanceof DomainError &&
        error.code !== "idempotency_conflict" &&
        error.retry !== "same_operation"
      )
        return { accepted: false, code: error.code };
      throw error;
    }
  }
  async pending(limit = 100): Promise<Message[]> {
    return this.transaction("outbox", async (client) => {
      const result = await client.query<{ message: Message }>(
        `SELECT o.message FROM ${this.context}.outbox o JOIN ${this.context}.delivery d ON d.message_id=o.id WHERE d.delivered_at IS NULL AND d.poison=false AND d.available_at<=clock_timestamp() ORDER BY o.created_at,o.sequence LIMIT $1`,
        [limit],
      );
      return result.rows.map((row) => MessageSchema.parse(row.message));
    });
  }
  async markDelivered(id: string) {
    await this.transaction("outbox", async (client) => {
      await client.query(
        `UPDATE ${this.context}.delivery SET delivered_at=clock_timestamp() WHERE message_id=$1`,
        [id],
      );
    });
  }
  async markFailed(id: string, code: string) {
    await this.transaction("outbox", async (client) => {
      await client.query(
        `UPDATE ${this.context}.delivery SET attempts=attempts+1,last_error=$2,poison=attempts>=9,available_at=clock_timestamp()+make_interval(secs=>LEAST(300, power(2,attempts)::int)) WHERE message_id=$1`,
        [id, code],
      );
    });
  }
  async messages(
    organizationId: string,
    options: { after?: string; limit?: number; pendingOnly?: boolean } = {},
  ) {
    return this.transaction(organizationId, async (client) => {
      const result = await client.query<{
        message: Message;
        attempts: number;
        poison: boolean;
        last_error: string | null;
        delivered_at: Date | null;
      }>(
        `SELECT o.message,d.attempts,d.poison,d.last_error,d.delivered_at FROM ${this.context}.outbox o JOIN ${this.context}.delivery d ON d.message_id=o.id WHERE o.organization_id=$1 AND ($2::boolean=false OR d.delivered_at IS NULL) AND ($3::uuid IS NULL OR (o.created_at,o.aggregate_id,o.sequence)>(SELECT created_at,aggregate_id,sequence FROM ${this.context}.outbox WHERE id=$3 AND organization_id=$1)) ORDER BY o.created_at,o.aggregate_id,o.sequence LIMIT $4`,
        [organizationId, options.pendingOnly ?? false, options.after ?? null, options.limit ?? 100],
      );
      return result.rows.map((row) => ({
        message: MessageSchema.parse(row.message),
        attempts: row.attempts,
        poison: row.poison,
        error: row.last_error,
        deliveredAt: row.delivered_at?.toISOString() ?? null,
      }));
    });
  }
  async health(organizationId?: string) {
    return this.transaction("health", async (client) => {
      const result = await client.query<{
        pending: number;
        poison: number;
        oldest_seconds: number;
      }>(
        `SELECT count(*) FILTER(WHERE delivered_at IS NULL)::int AS pending,count(*) FILTER(WHERE poison)::int AS poison,COALESCE(EXTRACT(EPOCH FROM clock_timestamp()-min(available_at) FILTER(WHERE delivered_at IS NULL)),0)::float AS oldest_seconds FROM ${this.context}.delivery d JOIN ${this.context}.outbox o ON o.id=d.message_id WHERE ($1::uuid IS NULL OR o.organization_id=$1)`,
        [organizationId ?? null],
      );
      return { context: this.context, ...result.rows[0] };
    });
  }
}
