import { ArrowRight, FolderGit2, GitBranch, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
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
  Status,
} from "@/components/workspace";
import { type Credentials, text, useResource } from "@/lib/api";

export function Projects({
  id,
  credentials,
  organizationName,
}: {
  id?: string;
  credentials: Credentials;
  organizationName: string;
}) {
  const state = useResource(id ? `/projects/${id}` : "/projects", credentials);
  const repositories = useResource(id ? `/projects/${id}/repositories` : null, credentials);
  const versions = useResource(id ? "/catalog/versions" : null, credentials);
  if (id)
    return (
      <>
        <a href="#/projects" className="mb-5 inline-block text-xs text-slate-500">
          ← All projects
        </a>
        <PageHeading
          eyebrow={organizationName}
          title={text(state.data?.name) || "Project"}
          description={
            text(state.data?.description) ||
            "Repository identity, admission policy, and delivery history for this project."
          }
          action={
            <div className="flex flex-wrap items-center gap-4">
              <Button variant="outline" onClick={state.refresh}>
                <RefreshCw />
                Refresh project
              </Button>
              <a
                href="#/runs"
                className="inline-flex items-center gap-2 text-sm font-medium text-teal-700"
              >
                View runs
                <ArrowRight className="size-4" />
              </a>
            </div>
          }
        />
        <ErrorNotice error={state.error} />
        {state.loading && <Loading />}
        {state.data && (
          <>
            <div className="mb-6 flex items-center gap-3">
              <Status value={state.data.status} />
              <span className="text-xs text-slate-500">
                Policy generation {text(state.data.policyEpoch)} · revision{" "}
                {text(state.data.version)}
              </span>
            </div>
            <Tabs defaultValue="repositories">
              <TabsList>
                <TabsTrigger value="repositories">Repositories</TabsTrigger>
                <TabsTrigger value="policy">Policy & lifecycle</TabsTrigger>
                <TabsTrigger value="integrations">GitHub & deployments</TabsTrigger>
              </TabsList>
              <TabsContent value="repositories" className="mt-6 space-y-5">
                <CommandForm
                  title="Register repository"
                  description="Verify a GitHub repository and its stable upstream identity before admission."
                  path={`/projects/${id}/repositories`}
                  credentials={credentials}
                  fields={[
                    { name: "owner", label: "GitHub owner", required: true },
                    { name: "name", label: "Repository name", required: true },
                  ]}
                  onDone={repositories.refresh}
                />
                <ErrorNotice error={repositories.error} />
                {itemList(repositories.data).map((repository) => (
                  <ResourceCard
                    key={text(repository.id)}
                    resource={{
                      ...repository,
                      name:
                        text(repository.fullName) || text(repository.url) || text(repository.id),
                    }}
                  >
                    <Details value={repository} title="Verified identity & binding" />
                    <CommandForm
                      title="Revalidate identity"
                      description="Verify the current upstream owner, repository identity, and source baseline. A same-URL replacement requires a separate registration."
                      path={`/projects/${id}/repositories/${text(repository.id)}/revalidate`}
                      credentials={credentials}
                      defaults={{ expectedVersion: repository.version }}
                      fields={[
                        {
                          name: "owner",
                          label: "GitHub owner",
                          required: true,
                          value: text(repository.owner),
                        },
                        {
                          name: "name",
                          label: "Repository name",
                          required: true,
                          value: text(repository.name),
                        },
                      ]}
                      onDone={repositories.refresh}
                    />
                  </ResourceCard>
                ))}
                {!repositories.loading &&
                  !repositories.error &&
                  !itemList(repositories.data).length && (
                    <Empty title="Register a repository">
                      Each run uses one verified writable repository. Registration binds its stable
                      upstream identity.
                    </Empty>
                  )}
              </TabsContent>
              <TabsContent value="integrations" className="mt-6 space-y-5">
                <Card className="shadow-none">
                  <CardHeader>
                    <h2 className="font-medium">Issue routing & deployment policy</h2>
                    <CardDescription>
                      Bind signed issue events and pin the workflows used for exact deployment
                      approvals.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-3">
                    <CommandForm
                      title="Route GitHub issue events"
                      description="Create a route for signed issue events with this exact label. Each delivery still requires current admission policy."
                      path="/integrations/github/routes"
                      credentials={credentials}
                      defaults={{ projectId: id }}
                      fields={[
                        {
                          name: "repositoryId",
                          label: "Repository",
                          type: "select",
                          required: true,
                          options: itemList(repositories.data).map((repository) => ({
                            value: text(repository.id),
                            label: text(repository.fullName) || text(repository.name),
                          })),
                        },
                        { name: "label", label: "Routing label", required: true },
                        {
                          name: "playbookVersionId",
                          label: "Published playbook version",
                          type: "select",
                          options: itemList(versions.data).map((version) => ({
                            value: text(version.id),
                            label: text(version.id),
                          })),
                        },
                      ]}
                    />
                    <CommandForm
                      title="Pin deployment workflow"
                      description="Publish an immutable workflow profile. The approved artifact, environment revision, account and policy generation are verified at deployment."
                      path="/integrations/deployment-profiles"
                      credentials={credentials}
                      defaults={{ region: "eu-west-1", expectedPreviousArtifact: null }}
                      fields={[
                        {
                          name: "repositoryId",
                          label: "Repository",
                          type: "select",
                          required: true,
                          options: itemList(repositories.data).map((repository) => ({
                            value: text(repository.id),
                            label: text(repository.fullName) || text(repository.name),
                          })),
                        },
                        {
                          name: "environment",
                          label: "Target environment",
                          type: "select",
                          required: true,
                          options: [
                            { value: "staging", label: "Staging" },
                            { value: "production", label: "Production" },
                          ],
                        },
                        {
                          name: "workflowPath",
                          label: "Workflow path",
                          required: true,
                          placeholder: ".github/workflows/deploy.yml",
                        },
                        { name: "workflowRef", label: "Workflow ref", required: true },
                        {
                          name: "workflowRevision",
                          label: "Verified workflow commit",
                          required: true,
                          hint: "Exact 40-character Git commit.",
                        },
                        {
                          name: "environmentRevision",
                          label: "Environment revision",
                          required: true,
                        },
                        {
                          name: "healthUrl",
                          label: "Release health URL",
                          required: true,
                          hint: "Must report the exact deployed artifactDigest.",
                        },
                        {
                          name: "expectedStatus",
                          label: "Expected HTTP status",
                          type: "number",
                          required: true,
                          value: "200",
                        },
                        { name: "accountId", label: "AWS account ID", required: true },
                        { name: "stackName", label: "CloudFormation stack", required: true },
                        { name: "rollbackWorkflowPath", label: "Rollback workflow path" },
                        {
                          name: "expectedPreviousArtifact",
                          label: "Expected previous artifact digest",
                          hint: "Leave empty for first deployment.",
                        },
                        {
                          name: "policyGeneration",
                          label: "Policy generation",
                          type: "number",
                          required: true,
                          value: "1",
                        },
                      ]}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="policy" className="mt-6 space-y-5">
                <Details value={state.data} title="Project policy and lifecycle" />
                <div className="flex flex-wrap gap-3">
                  <CommandForm
                    title="Revise policy"
                    description="Future admissions use this policy revision. Existing manifests remain immutable."
                    path={`/projects/${id}/policy`}
                    credentials={credentials}
                    defaults={{ expectedVersion: state.data.version }}
                    fields={[
                      {
                        name: "policy",
                        label: "Project policy",
                        type: "json",
                        required: true,
                        value: JSON.stringify(state.data.policy, null, 2),
                        hint: "Choose trusted runner access, invocation limits, allowed playbooks, and concrete runtime/environment profile IDs.",
                      },
                    ]}
                    onDone={state.refresh}
                  />
                  {["archive", "suspend", "resume"].map((action) => (
                    <CommandForm
                      key={action}
                      title={`${action[0].toUpperCase()}${action.slice(1)} project`}
                      description={
                        action === "archive"
                          ? "Stop new permits while preserving admitted work and its history."
                          : action === "suspend"
                            ? "Request cutoffs at each enrolled consumer. Earlier in-flight obligations remain recorded."
                            : "Resume new project admissions under a new policy generation."
                      }
                      path={`/projects/${id}/${action}`}
                      credentials={credentials}
                      defaults={{ expectedVersion: state.data?.version }}
                      fields={[
                        { name: "reason", label: "Reason", type: "textarea", required: true },
                      ]}
                      onDone={state.refresh}
                    />
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </>
    );
  const projects = itemList(state.data);
  return (
    <>
      <PageHeading
        eyebrow={organizationName}
        title="Projects"
        description="Give every delivery a home. Connect a verified repository, govern its execution, and follow the work through production."
        action={
          <CommandForm
            title="Create project"
            description="Create a project in your current organization. Register its repository before admitting a run."
            path="/projects"
            credentials={credentials}
            fields={[
              {
                name: "name",
                label: "Project name",
                required: true,
                placeholder: "Customer platform",
              },
              {
                name: "description",
                label: "Description",
                type: "textarea",
                placeholder: "What does this team deliver?",
              },
            ]}
            onDone={state.refresh}
          />
        }
      />
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Metric label="Projects" value={projects.length} icon={<FolderGit2 className="size-4" />} />
        <Metric
          label="Active projects"
          value={projects.filter((project) => project.status === "active").length}
          icon={<GitBranch className="size-4" />}
        />
        <Card className="border-teal-100 bg-teal-50/50 shadow-none">
          <CardContent className="pt-1">
            <p className="text-xs font-medium text-teal-800">A traceable path to delivery</p>
            <p className="mt-2 text-xs leading-5 text-teal-700">
              Issue → approved specification → reviewed commit → verified deployment
            </p>
          </CardContent>
        </Card>
      </div>
      <ErrorNotice error={state.error} />
      {state.loading && <Loading />}
      {projects.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((project) => (
            <ResourceCard
              key={text(project.id)}
              resource={project}
              href={`#/projects/${text(project.id)}`}
            >
              <p className="text-xs text-slate-500">
                Policy generation {text(project.policyEpoch)} · revision {text(project.version)}
              </p>
            </ResourceCard>
          ))}
        </div>
      )}
      {!state.loading && !state.error && !projects.length && (
        <Empty title="Your first delivery starts here">
          Create a project to connect your repository and choose a playbook. Runs and their history
          will stay linked to this workspace.
        </Empty>
      )}
    </>
  );
}
function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="gap-2 shadow-none">
      <CardHeader className="flex-row items-center justify-between">
        <CardDescription>{label}</CardDescription>
        <span className="text-slate-400">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}
