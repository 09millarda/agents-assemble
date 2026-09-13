import { Monitor, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CommandForm,
  Details,
  Empty,
  ErrorNotice,
  itemList,
  Loading,
  PageHeading,
  ResourceCard,
  Status,
} from "@/components/workspace";
import { asRecord, type Credentials, text, useResource } from "@/lib/api";

export function Runners({
  credentials,
  organizationName,
}: {
  credentials: Credentials;
  organizationName: string;
}) {
  const state = useResource("/runners", credentials);
  return (
    <>
      <PageHeading
        eyebrow={organizationName}
        title="Runners"
        description="Customer-controlled Linux machines, existing native Codex login, and bounded assignments."
        action={
          <CommandForm
            title="Enroll runner"
            description="Generate a short-lived enrollment token. Run the CLI enrollment command on the machine with your existing native Codex login."
            path="/fleet/enrollments"
            credentials={credentials}
            fields={[
              {
                name: "name",
                label: "Runner name",
                required: true,
                placeholder: "build-runner-01",
              },
            ]}
            onDone={state.refresh}
          />
        }
      />
      <Card className="mb-6 gap-3 border-amber-100 bg-amber-50/50 shadow-none">
        <CardHeader className="flex-row items-center gap-2">
          <ShieldAlert className="size-4 text-amber-700" />
          <CardTitle className="text-sm text-amber-900">Trusted runner enforcement</CardTitle>
        </CardHeader>
        <CardContent className="text-xs leading-6 text-amber-800">
          Worktrees do not provide complete writer isolation. Recovery stays blocked when writer
          coverage or external effect settlement cannot be proved. Check the recorded readiness
          diagnostics before assigning work.
        </CardContent>
      </Card>
      <ErrorNotice error={state.error} />
      {state.loading && <Loading />}
      <div className="grid gap-4 lg:grid-cols-2">
        {itemList(state.data).map((runner) => {
          const capabilities = runner.capabilities ? asRecord(runner.capabilities) : undefined;
          return (
            <ResourceCard key={text(runner.id)} resource={runner}>
              <div className="flex flex-wrap items-center gap-2">
                <Monitor className="size-4 text-slate-400" />
                <Status value={capabilities?.nativeAuthentication ?? "unavailable"} />
                <span className="text-xs text-slate-500">
                  Codex {text(capabilities?.codexVersion) || "not observed"}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Last seen:{" "}
                {runner.lastSeenAt
                  ? new Date(text(runner.lastSeenAt)).toLocaleString()
                  : "No authenticated connection yet"}
              </p>
              <Details value={runner} title="Capability, connectivity & authority diagnostics" />
              <div className="flex flex-wrap gap-2">
                <CommandForm
                  title="Rotate credentials"
                  description="Create a new enrollment authorization for this runner. Native harness credentials remain local."
                  path="/fleet/enrollments"
                  credentials={credentials}
                  defaults={{ runnerId: runner.id, name: runner.name }}
                  fields={[]}
                  onDone={state.refresh}
                />
                <CommandForm
                  title="Revoke runner"
                  description="Revoke future runner authority while preserving earlier work and unresolved writer obligations."
                  path={`/runners/${text(runner.id)}/revoke`}
                  credentials={credentials}
                  defaults={{ expectedVersion: runner.version }}
                  fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                  onDone={state.refresh}
                />
              </div>
            </ResourceCard>
          );
        })}
      </div>
      {!state.loading && !state.error && !itemList(state.data).length && (
        <Empty title="Connect your first runner">
          Enroll a Linux machine after checking native Codex readiness with the runner CLI. Model
          credentials remain in the native user account.
        </Empty>
      )}
    </>
  );
}
