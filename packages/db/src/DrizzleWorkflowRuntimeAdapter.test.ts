import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { DrizzleWorkflowRuntimeAdapter } from "./DrizzleWorkflowRuntimeAdapter";
import type { WorkflowRun } from "@factory/workflow";
import { withIsolatedWorkflowDatabase } from "./testing/withIsolatedWorkflowDatabase";
const databaseUrl = process.env.WORKFLOW_TEST_DATABASE_URL;
test.skipIf(!databaseUrl)(
  "persists transitions and immutable documents while duplicate delivery is idempotent",
  async () => {
    await withIsolatedWorkflowDatabase(databaseUrl!, async ({ sql }) => {
      await sql`insert into projects(project_id,name,absolute_path) values ('kept-project','Runtime test project','/tmp/kept')`;
      await sql`insert into daemons(daemon_id,machine_name,auth_token_hash) values ('test-daemon','Runtime test daemon','test-token-hash')`;
      const adapter = new DrizzleWorkflowRuntimeAdapter(drizzle(sql));
      const run: WorkflowRun = {
        runId: "runtime-run",
        name: "Test run",
        projectId: "kept-project",
        workflowId: "definition",
        daemonId: "test-daemon",
        recipientId: null,
        snapshot: {
          workflowId: "definition",
          name: "Definition",
          description: "",
          status: "published",
          tags: [],
          activities: [],
          positions: {},
        },
        workspace: { projectPath: "/tmp/kept" },
        workspaceResult: null,
        kickoffPrompt: null,
        status: "awaiting-human",
        executions: [],
        documents: [
          {
            revisionId: "doc-r1",
            runId: "runtime-run",
            documentId: "plan",
            name: "Plan",
            revision: 1,
            executionId: "execution-1",
            activityId: "plan",
            content: "# Plan\nPersist this",
            consumedRevisionIds: [],
            createdAt: "2026-09-15T12:00:00.000Z",
          },
        ],
        interaction: null,
        loopPasses: {},
        loopLimits: {},
        processedMessageIds: [],
        approvedTreeHash: null,
        acceptedFindings: false,
        acceptedFindingRevisionIds: [],
        publication: null,
        error: null,
        createdAt: "2026-09-15T12:00:00.000Z",
        updatedAt: "2026-09-15T12:00:00.000Z",
      };
      await adapter.saveTransition({ run, commands: [], notifications: [] });
      await adapter.saveTransition({ run, commands: [], notifications: [] });
      expect(await adapter.findRun("runtime-run")).toEqual(run);
      await expect(
        adapter.saveTransition({
          run: { ...run, snapshot: { ...run.snapshot, name: "Changed" } },
          commands: [],
          notifications: [],
        }),
      ).rejects.toThrow("snapshots are immutable");
      await expect(
        adapter.saveTransition({
          run: {
            ...run,
            documents: [
              { ...run.documents[0]!, content: "Edited historical content" },
            ],
          },
          commands: [],
          notifications: [],
        }),
      ).rejects.toThrow("document revision");
      expect(
        (await adapter.findRun("runtime-run"))?.documents[0]?.content,
      ).toBe("# Plan\nPersist this");
    });
  },
  10000,
);
