import { KeyRound, Settings2 } from "lucide-react";
import { RuntimeProfiles } from "@/components/runtime-profiles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CommandForm,
  Details,
  Empty,
  ErrorNotice,
  type Field,
  itemList,
  Loading,
  PageHeading,
  ResourceCard,
} from "@/components/workspace";
import { type Credentials, type RecordData, text, useResource } from "@/lib/api";

function fields(profile?: RecordData): Field[] {
  return [
    { name: "name", label: "Profile name", required: true, value: text(profile?.name) },
    {
      name: "variables",
      label: "Non-secret variables",
      type: "json",
      required: true,
      value: JSON.stringify(profile?.variables ?? {}, null, 2),
      hint: "Plain configuration only. Credentials belong in logical bindings resolved by your runner.",
    },
    {
      name: "secretBindings",
      label: "Logical secret bindings",
      type: "json",
      required: true,
      value: JSON.stringify(profile?.secretBindings ?? [], null, 2),
      hint: 'Example: [{"name":"DEPLOY_TOKEN","logicalName":"staging.deploy-token"}]. Enter names only.',
    },
    {
      name: "resolverPolicy",
      label: "Runner resolver",
      type: "select",
      required: true,
      value: "local-file",
      options: [{ value: "local-file", label: "Runner-local file" }],
    },
    {
      name: "rotationPolicy",
      label: "Rotation behavior",
      type: "select",
      required: true,
      value: "refresh_per_attempt",
      options: [{ value: "refresh_per_attempt", label: "Refresh for each new attempt" }],
      hint: "Each attempt records the resolved secret versions. Values stay on the runner.",
    },
  ];
}
export function Environments({
  credentials,
  organizationName,
}: {
  credentials: Credentials;
  organizationName: string;
}) {
  const state = useResource("/environments", credentials);
  return (
    <>
      <PageHeading
        eyebrow={organizationName}
        title="Environments"
        description="Version runtime configuration centrally. Resolve secrets on the customer runner using logical bindings."
        action={
          <CommandForm
            title="Create environment"
            description="Create a profile with non-secret configuration and runner-local secret references."
            path="/environments"
            credentials={credentials}
            fields={fields()}
            onDone={state.refresh}
          />
        }
      />
      <Card className="mb-7 gap-3 border-teal-100 bg-teal-50/50 shadow-none">
        <CardHeader className="flex-row items-center gap-2">
          <KeyRound className="size-4 text-teal-700" />
          <CardTitle className="text-sm text-teal-900">Secrets stay with your runner</CardTitle>
        </CardHeader>
        <CardContent className="text-xs leading-6 text-teal-800">
          Bindings identify which secret to resolve. Each invocation records its profile and
          resolution receipt; running invocations retain their pinned authority.
        </CardContent>
      </Card>
      <ErrorNotice error={state.error} />
      {state.loading && <Loading />}
      <div className="grid gap-4 lg:grid-cols-2">
        {itemList(state.data).map((profile) => (
          <ResourceCard
            key={text(profile.id)}
            resource={{ ...profile, status: profile.active ? "active" : "inactive" }}
          >
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Settings2 className="size-4" />
              Revision {text(profile.revision)} ·{" "}
              {text(profile.rotationPolicy).replaceAll("_", " ")}
            </div>
            <Details value={profile} title="Configuration & logical bindings" />
            <CommandForm
              title="Create new revision"
              description="Preserve the current revision and apply a new profile to future eligible attempts."
              path={`/environments/${text(profile.id)}/revisions`}
              credentials={credentials}
              fields={fields(profile)}
              transform={(values) => ({ expectedVersion: profile.version, profile: values })}
              onDone={state.refresh}
            />
          </ResourceCard>
        ))}
      </div>
      {!state.loading && !state.error && !itemList(state.data).length && (
        <Empty title="Configure your first environment">
          Create a profile, declare logical secret bindings, and select it in your project admission
          policy.
        </Empty>
      )}
      <RuntimeProfiles credentials={credentials} />
    </>
  );
}
