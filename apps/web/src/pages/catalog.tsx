import { Workflow } from "lucide-react";
import { PackageExport, PackageImport } from "@/components/package-transfer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CommandForm,
  Details,
  Empty,
  ErrorNotice,
  itemList,
  Loading,
  PageHeading,
  ResourceCard,
} from "@/components/workspace";
import { type Credentials, text, useResource } from "@/lib/api";
import { DraftEditor } from "@/pages/draft";

export function Catalog({
  id,
  credentials,
  organizationName,
}: {
  id?: string;
  credentials: Credentials;
  organizationName: string;
}) {
  const state = useResource("/catalog/playbooks", credentials);
  const versions = useResource("/catalog/versions", credentials);
  const starters = useResource("/catalog/starters", credentials);
  if (id)
    return (
      <DraftEditor
        id={id}
        owner="catalog"
        credentials={credentials}
        organizationName={organizationName}
      />
    );
  const starter = itemList(starters.data)[0];
  return (
    <>
      <PageHeading
        eyebrow={organizationName}
        title="Playbooks"
        description="Compose bounded workflows with agents, human decisions, integrations, and deterministic checks."
      />
      <Tabs defaultValue="drafts">
        <TabsList>
          <TabsTrigger value="drafts">Organization drafts</TabsTrigger>
          <TabsTrigger value="versions">Immutable versions</TabsTrigger>
          <TabsTrigger value="starters">Start from a playbook</TabsTrigger>
        </TabsList>
        <TabsContent value="drafts" className="mt-6">
          <ErrorNotice error={state.error} />
          {state.loading && <Loading />}
          <div className="grid gap-4 lg:grid-cols-2">
            {itemList(state.data).map((playbook) => (
              <ResourceCard
                key={text(playbook.id)}
                resource={playbook}
                href={`#/catalog/${text(playbook.id)}`}
              >
                <p className="text-xs text-slate-500">
                  Draft sequence {text(playbook.sequence)} · submitted head{" "}
                  {text(playbook.submittedHead)}
                </p>
              </ResourceCard>
            ))}
          </div>
          {!state.loading && !state.error && !itemList(state.data).length && (
            <Empty title="Build your delivery playbook">
              Choose a bundled new-feature or bug-fix workflow to start authoring. The visual editor
              and JSON share one canonical definition.
            </Empty>
          )}
        </TabsContent>
        <TabsContent value="versions" className="mt-6 space-y-4">
          <PackageImport credentials={credentials} onDone={versions.refresh} />
          <ErrorNotice error={versions.error} />
          {itemList(versions.data).map((version) => (
            <ResourceCard key={text(version.id)} resource={version}>
              <Details value={version} title="Pinned version, closure & changelog" />
              <PackageExport id={text(version.id)} credentials={credentials} />
            </ResourceCard>
          ))}
          {!versions.loading && !versions.error && !itemList(versions.data).length && (
            <Empty title="No published versions yet">
              Save a draft, freeze an exact candidate, then publish its immutable organization
              version.
            </Empty>
          )}
        </TabsContent>
        <TabsContent value="starters" className="mt-6">
          <ErrorNotice error={starters.error} />
          <div className="grid gap-4 lg:grid-cols-2">
            {itemList(starters.data).map((item) => (
              <Card key={text(item.name)} className="shadow-none">
                <CardHeader>
                  <Workflow className="mb-2 size-5 text-teal-700" />
                  <CardTitle>{text(item.name).replaceAll("-", " ")}</CardTitle>
                  <CardDescription>
                    Discovery, explicit approvals, implementation, review, and delivery.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CommandForm
                    title="Use this playbook"
                    description="Create your own editable organization draft from this canonical starter."
                    path="/catalog/playbooks"
                    credentials={credentials}
                    defaults={{ definition: item.definition }}
                    fields={[
                      {
                        name: "title",
                        label: "Playbook title",
                        required: true,
                        value: text(item.name),
                      },
                    ]}
                    onDone={state.refresh}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="mt-6 shadow-none">
            <CardHeader>
              <CardTitle>Import a canonical definition</CardTitle>
              <CardDescription>
                Paste JSON produced by the TypeScript builder or exported from another editor.
                Unsupported behavior is rejected visibly.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CommandForm
                title="Import JSON definition"
                description="The full definition is validated before creating the draft."
                path="/catalog/playbooks"
                credentials={credentials}
                fields={[
                  { name: "title", label: "Playbook title", required: true },
                  {
                    name: "definition",
                    label: "Canonical playbook JSON",
                    type: "json",
                    required: true,
                    value: starter ? JSON.stringify(starter.definition, null, 2) : undefined,
                  },
                ]}
                onDone={state.refresh}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
