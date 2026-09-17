import postgres from "postgres";

export async function acquireWorkflowCoordinatorLease(
  connectionString: string,
  version: string,
  onLeaseLost: (error: Error) => void,
): Promise<() => Promise<void>> {
  let ownsLease = false;
  let released = false;
  let lost = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  function loseLease(reason: string): void {
    if (!ownsLease || released || lost) return;
    lost = true;
    ownsLease = false;
    if (heartbeat) clearInterval(heartbeat);
    onLeaseLost(new Error(`Workflow coordinator lease lost: ${reason}`));
  }
  const client = postgres(connectionString, {
    max: 1,
    max_lifetime: null,
    onclose: () => loseLease("the owning database session closed"),
  });
  const connection = await client.reserve();
  let backendPid: number;
  try {
    const [lease] =
      await connection`select pg_try_advisory_lock(781209115) as acquired, pg_backend_pid() as backend_pid`;
    if (!lease?.acquired)
      throw new Error("Another coordinator already owns workflow execution.");
    backendPid = lease.backend_pid;
    ownsLease = true;
    await connection`create table if not exists workflow_coordinator_contract (singleton boolean primary key default true check(singleton),version text not null)`;
    const [contract] =
      await connection`select version from workflow_coordinator_contract where singleton=true`;
    if (contract && contract.version !== version) {
      const [active] =
        await connection`select count(*)::int as count from workflow_runs where state->>'status' not in ('completed','cancelled','failed')`;
      if (active?.count)
        throw new Error(
          "Affected workflow runs must finish or be explicitly cancelled before an incompatible coordinator upgrade.",
        );
    }
    await connection`insert into workflow_coordinator_contract(singleton,version) values(true,${version}) on conflict(singleton) do update set version=excluded.version`;
  } catch (error) {
    released = true;
    if (ownsLease) await connection`select pg_advisory_unlock(781209115)`;
    connection.release();
    await client.end();
    throw error;
  }
  let checking = false;
  heartbeat = setInterval(() => {
    if (checking || released || lost) return;
    checking = true;
    const deadline = setTimeout(
      () => loseLease("database heartbeat timed out"),
      2500,
    );
    deadline.unref();
    void connection`select pg_backend_pid() as backend_pid, exists(select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid() and objid=781209115 and granted) as owns_lock`
      .then(([lease]) => {
        if (!lease?.owns_lock || lease.backend_pid !== backendPid)
          loseLease("the database session no longer owns its advisory lock");
      })
      .catch(() => loseLease("the database heartbeat failed"))
      .finally(() => {
        checking = false;
        clearTimeout(deadline);
      });
  }, 1000);
  heartbeat.unref();
  return async () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    if (ownsLease) await connection`select pg_advisory_unlock(781209115)`;
    ownsLease = false;
    connection.release();
    await client.end({ timeout: 1 });
  };
}
