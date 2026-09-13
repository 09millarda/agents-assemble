import {
  CommandForm,
  Details,
  Empty,
  ErrorNotice,
  type Field,
  itemList,
  ResourceCard,
} from "@/components/workspace";
import { type Credentials, type RecordData, text, useResource } from "@/lib/api";

function fields(profile?: RecordData): Field[] {
  return [
    { name: "name", label: "Profile name", required: true, value: text(profile?.name) },
    {
      name: "model",
      label: "Exact Codex model",
      required: true,
      value: text(profile?.model),
      hint: "Use an explicitly available model. The runner never silently substitutes settings.",
    },
    {
      name: "effort",
      label: "Reasoning effort",
      type: "select",
      required: true,
      value: text(profile?.effort),
      options: ["low", "medium", "high", "xhigh", "max", "ultra"].map((value) => ({
        value,
        label: value,
      })),
    },
    {
      name: "sandbox",
      label: "Native sandbox setting",
      type: "select",
      required: true,
      value: text(profile?.sandbox),
      options: [
        { value: "read-only", label: "Read only" },
        { value: "workspace-write", label: "Workspace write" },
      ],
    },
    {
      name: "trustedRunner",
      label: "Trusted runner policy",
      type: "select",
      required: true,
      value: profile ? String(profile.trustedRunner) : "",
      options: [
        { value: "false", label: "Do not grant trusted-runner authority" },
        { value: "true", label: "Allow execution on a trusted runner" },
      ],
    },
    {
      name: "capabilities",
      label: "Required capabilities",
      type: "json",
      required: true,
      value: JSON.stringify(profile?.capabilities ?? [], null, 2),
    },
  ];
}
export function RuntimeProfiles({ credentials }: { credentials: Credentials }) {
  const state = useResource("/runtime-profiles", credentials);
  return (
    <section className="mt-10 space-y-5" aria-labelledby="runtime-profiles-title">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="runtime-profiles-title" className="text-lg font-semibold">
            Runtime profiles
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Exact native model settings, capabilities, and enforcement requirements.
          </p>
        </div>
        <CommandForm
          title="Create runtime profile"
          description="Record an exact Codex profile. Admission checks compatibility against the selected customer runner."
          path="/runtime-profiles"
          credentials={credentials}
          fields={fields()}
          transform={(values) => ({
            ...values,
            harness: "codex",
            codexVersion: "0.153.4",
            trustedRunner: values.trustedRunner === "true",
          })}
          onDone={state.refresh}
        />
      </div>
      <ErrorNotice error={state.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {itemList(state.data).map((profile) => (
          <ResourceCard key={text(profile.id)} resource={profile}>
            <p className="text-xs text-slate-500">
              {text(profile.model)} · {text(profile.effort)} · Codex {text(profile.codexVersion)}
            </p>
            <Details value={profile} title="Pinned settings and capability requirements" />
            <CommandForm
              title="Revise runtime profile"
              description="Create an immutable successor profile. Existing run manifests keep their reviewed settings."
              path={`/runtime-profiles/${text(profile.id)}/revisions`}
              credentials={credentials}
              fields={fields(profile)}
              transform={(values) => ({
                ...values,
                harness: "codex",
                codexVersion: "0.153.4",
                trustedRunner: values.trustedRunner === "true",
              })}
              onDone={state.refresh}
            />
          </ResourceCard>
        ))}
      </div>
      {!state.loading && !state.error && !itemList(state.data).length && (
        <Empty title="No runtime profiles yet">
          Declare exact native settings before binding runtime slots for a run.
        </Empty>
      )}
    </section>
  );
}
