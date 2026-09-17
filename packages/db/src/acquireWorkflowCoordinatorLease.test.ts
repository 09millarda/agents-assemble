import { expect, test } from "bun:test";
import { acquireWorkflowCoordinatorLease } from "./acquireWorkflowCoordinatorLease";
import { withIsolatedWorkflowDatabase } from "./testing/withIsolatedWorkflowDatabase";
const databaseUrl = process.env.WORKFLOW_TEST_DATABASE_URL;
test.skipIf(!databaseUrl)(
  "one coordinator owns execution and incompatible upgrade refuses active runs",
  async () => {
    await withIsolatedWorkflowDatabase(
      databaseUrl!,
      async ({ connectionString, sql }) => {
        await sql`insert into projects(project_id,name,absolute_path) values ('lease-project','Lease test project','/tmp/lease')`;
        await sql`insert into daemons(daemon_id,machine_name,auth_token_hash) values ('lease-daemon','Lease test daemon','test-token-hash')`;
        await sql`insert into workflow_runs(run_id,project_id,workflow_id,daemon_id,snapshot,state) values ('active-lease-run','lease-project','lease-workflow','lease-daemon','{}'::jsonb,'{"status":"queued"}'::jsonb)`;
        const release = await acquireWorkflowCoordinatorLease(
          connectionString,
          "workflow-v1",
          () => {},
        );
        try {
          await expect(
            acquireWorkflowCoordinatorLease(
              connectionString,
              "workflow-v1",
              () => {},
            ),
          ).rejects.toThrow("already owns");
        } finally {
          await release();
        }
        await expect(
          acquireWorkflowCoordinatorLease(
            connectionString,
            "incompatible-v2",
            () => {},
          ),
        ).rejects.toThrow("finish or be explicitly cancelled");
      },
    );
  },
  10000,
);

test.skipIf(!databaseUrl)(
  "terminating the lease session signals fatal lease loss instead of reacquiring",
  async () => {
    const { default: postgres } = await import("postgres");
    const { randomBytes } = await import("node:crypto");
    const admin = postgres(databaseUrl!);
    const databaseName = "workflow_lease_" + randomBytes(8).toString("hex");
    await admin.unsafe(`create database ${databaseName}`);
    const testUrl = new URL(databaseUrl!);
    testUrl.pathname = "/" + databaseName;
    let release: () => Promise<void> = async () => {};
    let resolveLoss: (error: Error) => void = () => {};
    const lost = new Promise<Error>((resolve) => {
      resolveLoss = resolve;
    });
    try {
      release = await acquireWorkflowCoordinatorLease(
        testUrl.toString(),
        "workflow-v1",
        resolveLoss,
      );
      const [session] =
        await admin`select pid from pg_stat_activity where datname=${databaseName}`;
      await admin`select pg_terminate_backend(${session!.pid})`;
      expect((await lost).message).toContain("lease");
      await release();
    } finally {
      await release();
      await admin.unsafe(`drop database ${databaseName} with (force)`);
      await admin.end();
    }
  },
  10000,
);
