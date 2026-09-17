import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const daemons = pgTable("daemons", {
  daemonId: text("daemon_id").primaryKey(),
  machineName: text("machine_name").notNull(),
  displayName: text("display_name").notNull(),
  maxParallelHarnesses: integer("max_parallel_harnesses").notNull().default(1),
  metadata: jsonb("metadata").notNull().default({}),
  configurationRevision: integer("configuration_revision").notNull().default(1),
  appliedConfiguration: jsonb("applied_configuration"),
  appliedConfigurationRevision: integer("applied_configuration_revision"),
  configurationApplyStatus: text("configuration_apply_status").notNull().default("pending"),
  configurationFailureReason: text("configuration_failure_reason"),
  runtimeFacts: jsonb("runtime_facts"),
  status: text("status").notNull().default("unknown"),
  authTokenHash: text("auth_token_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const deviceAuthorizations = pgTable("device_authorizations", {
  deviceCode: text("device_code").primaryKey(),
  userCode: text("user_code").notNull().unique(),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  machineName: text("machine_name").notNull(),
  pollIntervalSeconds: integer("poll_interval_seconds").notNull().default(5),
  lastPolledAt: timestamp("last_polled_at"),
  daemonId: text("daemon_id"),
  authToken: text("auth_token"),
  requestedDaemonId: text("requested_daemon_id"),
});

export const projects = pgTable("projects", {
  setupCommand: text("setup_command"),
  projectId: text("project_id").primaryKey(),
  name: text("name").notNull(),
  absolutePath: text("absolute_path").notNull(),
  daemonId: text("daemon_id"),
  gitStatus: text("git_status").notNull().default("unknown"),
  blockedReason: text("blocked_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workflows = pgTable("workflows", {
  workflowId: text("workflow_id").primaryKey(),
  definition: jsonb("definition").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const activityTemplates = pgTable("activity_templates", {
  templateId: text("template_id").primaryKey(),
  activity: jsonb("activity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const projectEnabledWorkflows = pgTable(
  "project_enabled_workflows",
  {
    projectId: text("project_id").notNull(),
    workflowId: text("workflow_id").notNull(),
  },
  (table) => ({
    enabledWorkflowPk: primaryKey({
      columns: [table.projectId, table.workflowId],
    }),
  }),
);
export const workflowRuns = pgTable("workflow_runs", {
  runId: text("run_id").primaryKey(),
  projectId: text("project_id").notNull(),
  workflowId: text("workflow_id").notNull(),
  daemonId: text("daemon_id").notNull(),
  recipientId: text("recipient_id"),
  snapshot: jsonb("snapshot").notNull(),
  state: jsonb("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const workflowCommands = pgTable("workflow_commands", {
  commandId: text("command_id").primaryKey(),
  runId: text("run_id").notNull(),
  daemonId: text("daemon_id").notNull(),
  executionId: text("execution_id").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const workflowMessages = pgTable("workflow_messages", {
  messageId: text("message_id").primaryKey(),
  runId: text("run_id").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const workflowDocuments = pgTable("workflow_documents", {
  revisionId: text("revision_id").primaryKey(),
  runId: text("run_id").notNull(),
  documentId: text("document_id").notNull(),
  name: text("name").notNull(),
  executionId: text("execution_id").notNull(),
  activityId: text("activity_id").notNull(),
  revision: integer("revision").notNull(),
  content: text("content").notNull(),
  consumedRevisions: jsonb("consumed_revisions").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const browserRecipients = pgTable("browser_recipients", {
  recipientId: text("recipient_id").primaryKey(),
  managementTokenHash: text("management_token_hash").notNull(),
  lastDeliveryError: text("last_delivery_error"),
  subscription: jsonb("subscription"),
  active: boolean("active").notNull().default(true),
  deliveryStatus: text("delivery_status").notNull().default("unenrolled"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const workflowNotifications = pgTable("workflow_notifications", {
  notificationId: text("notification_id").primaryKey(),
  runId: text("run_id").notNull(),
  recipientId: text("recipient_id"),
  payload: jsonb("payload").notNull(),
  deliveryStatus: text("delivery_status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
