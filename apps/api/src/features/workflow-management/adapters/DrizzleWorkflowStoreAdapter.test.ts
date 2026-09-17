import { expect, test } from "bun:test";
import type { WorkflowDefinition } from "@factory/workflow";
import {
  createDatabaseConnection,
  eq,
  projectEnabledWorkflows,
  projects,
  workflows,
} from "@factory/db";
import { DrizzleProjectRegistryAdapter } from "../../project-workspace/adapters/DrizzleProjectRegistryAdapter";
import { DrizzleWorkflowStoreAdapter } from "./DrizzleWorkflowStoreAdapter";

const databaseUrl = process.env.WORKFLOW_TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  "unpublishes atomically and deletes enabled-workflow references with the workflow row",
  async () => {
    const database = createDatabaseConnection(databaseUrl!);
    const workflowId = `delete-workflow-${crypto.randomUUID()}`;
    const projectId = `delete-project-${crypto.randomUUID()}`;
    const definition: WorkflowDefinition = {
      workflowId,
      name: "Delete me",
      description: "",
      status: "published",
      tags: [],
      activities: [],
      positions: {},
    };

    try {
      await database.insert(projects).values({
        projectId,
        name: "Delete workflow test project",
        absolutePath: "/tmp/delete-workflow-test",
      });
      await database.insert(workflows).values({
        workflowId,
        definition,
      });
      await database.insert(projectEnabledWorkflows).values({
        projectId,
        workflowId,
      });

      const adapter = new DrizzleWorkflowStoreAdapter(
        database,
        new DrizzleProjectRegistryAdapter(database),
      );

      const unpublished = await adapter.unpublishDefinition(workflowId);
      expect(unpublished?.status).toBe("draft");
      expect(
        await database
          .select()
          .from(projectEnabledWorkflows)
          .where(eq(projectEnabledWorkflows.workflowId, workflowId)),
      ).toEqual([]);

      await adapter.saveDefinition({ ...unpublished!, status: "published" });
      await database.insert(projectEnabledWorkflows).values({
        projectId,
        workflowId,
      });
      expect(await adapter.deleteDefinition(workflowId)).toBe(true);
      expect(
        await database
          .select()
          .from(workflows)
          .where(eq(workflows.workflowId, workflowId)),
      ).toEqual([]);
      expect(
        await database
          .select()
          .from(projectEnabledWorkflows)
          .where(eq(projectEnabledWorkflows.workflowId, workflowId)),
      ).toEqual([]);
      expect(await adapter.deleteDefinition(workflowId)).toBe(false);
    } finally {
      await database
        .delete(projectEnabledWorkflows)
        .where(eq(projectEnabledWorkflows.projectId, projectId));
      await database
        .delete(workflows)
        .where(eq(workflows.workflowId, workflowId));
      await database.delete(projects).where(eq(projects.projectId, projectId));
      await (
        database as unknown as {
          session: { client: { end: (options?: { timeout?: number }) => Promise<void> } };
        }
      ).session.client.end({ timeout: 1 });
    }
  },
  10000,
);
