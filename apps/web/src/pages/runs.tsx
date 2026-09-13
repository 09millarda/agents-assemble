import { GitBranch, MessageSquare, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Status,
} from "@/components/workspace";
import { asRecord, type Credentials, type RecordData, text, useResource } from "@/lib/api";
import { DraftEditor } from "@/pages/draft";

export function Runs({
  id,
  credentials,
  organizationName,
}: {
  id?: string;
  credentials: Credentials;
  organizationName: string;
}) {
  const state = useResource(id ? `/runs/${id}` : "/runs", credentials);
  const refresh = state.refresh;
  useEffect(() => {
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  if (id)
    return (
      <RunDetail
        id={id}
        run={state.data}
        error={state.error}
        refresh={state.refresh}
        credentials={credentials}
        organizationName={organizationName}
      />
    );
  return (
    <>
      <PageHeading
        eyebrow={organizationName}
        title="Runs"
        description="Follow delivery from an admitted work item through exact approvals, reviewed code, and the recorded deployment outcome."
      />
      <StartRun credentials={credentials} onDone={state.refresh} />
      <ErrorNotice error={state.error} />
      {state.loading && !state.data && <Loading />}
      <div className="mt-6 space-y-4">
        {itemList(state.data).map((run) => (
          <ResourceCard
            key={text(run.id)}
            resource={{ ...run, title: `Run ${text(run.id).slice(0, 8)}` }}
            href={`#/runs/${text(run.id)}`}
          >
            <p className="text-sm leading-6 text-slate-500">{text(run.reason)}</p>
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <GitBranch className="size-3.5" />
              Delivery {text(run.deliveryId).slice(0, 8)}
            </p>
          </ResourceCard>
        ))}
      </div>
      {!state.loading && !state.error && !itemList(state.data).length && (
        <Empty title="No runs yet">
          Publish a playbook version, verify the repository baseline, and bind eligible runtime
          profiles to start a delivery.
        </Empty>
      )}
    </>
  );
}
function StartRun({ credentials, onDone }: { credentials: Credentials; onDone: () => void }) {
  const projects = useResource("/projects", credentials),
    versions = useResource("/catalog/versions", credentials),
    environments = useResource("/environments", credentials);
  const [projectId, setProjectId] = useState("");
  const repositories = useResource(
    projectId ? `/projects/${projectId}/repositories` : null,
    credentials,
  );
  const options = (items: RecordData[]) =>
    items.map((item) => ({
      value: text(item.id),
      label: text(item.name) || text(item.title) || text(item.id),
    }));
  return (
    <Card className="mb-7 gap-4 border-teal-100 bg-white shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Start a delivery</CardTitle>
        <CardDescription>
          Admission freezes repository identity, inputs, policy, profiles, and a bounded work
          budget.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorNotice error={projects.error ?? versions.error ?? repositories.error} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-2">
            <label htmlFor="run-project" className="text-sm font-medium">
              Project
            </label>
            <select
              id="run-project"
              className="h-9 w-full rounded-md border bg-white px-3 text-sm"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Select a project</option>
              {options(itemList(projects.data)).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {projectId && (
            <CommandForm
              title="Start from GitHub issue"
              description="Fetch the current issue and verified source, then freeze its brief and the selected starter. Project runtime and environment policy must be configured."
              path="/runs/from-issue"
              credentials={credentials}
              defaults={{ projectId }}
              fields={[
                {
                  name: "repositoryId",
                  label: "Writable repository",
                  type: "select",
                  required: true,
                  options: options(itemList(repositories.data)),
                },
                {
                  name: "issueNumber",
                  label: "GitHub issue number",
                  type: "number",
                  required: true,
                },
                {
                  name: "starter",
                  label: "Delivery playbook",
                  type: "select",
                  required: true,
                  options: [
                    { value: "new-feature", label: "New feature" },
                    { value: "bug-fix", label: "Bug fix" },
                  ],
                },
              ]}
              onDone={(value) => {
                onDone();
                const runId = value.runId ?? value.id;
                if (runId) location.hash = `/runs/${text(runId)}`;
              }}
            />
          )}
          {projectId && (
            <CommandForm
              title="Advanced run bindings"
              description="Review exact source and version bindings. A candidate is executable only after committed admission."
              path="/runs"
              credentials={credentials}
              defaults={{ projectId }}
              fields={[
                {
                  name: "repositoryId",
                  label: "Writable repository",
                  type: "select",
                  required: true,
                  options: options(itemList(repositories.data)),
                },
                {
                  name: "versionId",
                  label: "Published playbook version",
                  type: "select",
                  required: true,
                  options: options(itemList(versions.data)),
                },
                {
                  name: "sourceCommit",
                  label: "Verified source commit",
                  required: true,
                  hint: "Exact 40-character Git commit; moving branches cannot remain in the manifest.",
                },
                {
                  name: "inputs",
                  label: "Playbook inputs",
                  type: "json",
                  required: true,
                  value: "{}",
                },
                {
                  name: "runtimeBindings",
                  label: "Runtime slot bindings",
                  type: "json",
                  required: true,
                  value: "{}",
                  hint: "Map each declared runtime slot to an eligible organization profile ID.",
                },
                {
                  name: "environmentProfileId",
                  label: "Environment profile",
                  type: "select",
                  options: options(itemList(environments.data)),
                },
                {
                  name: "workItem",
                  label: "GitHub work item",
                  type: "json",
                  hint: '{"provider":"github","repositoryId":"…","issueNumber":20,"url":"https://github.com/…/issues/20"}',
                },
              ]}
              onDone={(value) => {
                onDone();
                if (value.id) location.hash = `/runs/${text(value.id)}`;
              }}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
function RunDetail({
  id,
  run,
  error,
  refresh,
  credentials,
  organizationName,
}: {
  id: string;
  run?: RecordData;
  error?: Error;
  refresh: () => void;
  credentials: Credentials;
  organizationName: string;
}) {
  const requests = useResource("/requests", credentials);
  const assignments = useResource(`/runs/${id}/assignments`, credentials);
  const documents = useResource("/knowledge/documents", credentials);
  const effects = useResource("/integrations/effects", credentials);
  const [documentId, setDocumentId] = useState("");
  const refreshRequests = requests.refresh,
    refreshAssignments = assignments.refresh;
  useEffect(() => {
    const timer = setInterval(() => {
      refreshRequests();
      refreshAssignments();
    }, 2000);
    return () => clearInterval(timer);
  }, [refreshRequests, refreshAssignments]);
  if (documentId)
    return (
      <>
        <Button variant="ghost" className="mb-4" onClick={() => setDocumentId("")}>
          ← Back to run
        </Button>
        <DraftEditor
          id={documentId}
          owner="knowledge"
          credentials={credentials}
          organizationName={organizationName}
        />
      </>
    );
  if (!run)
    return (
      <>
        <ErrorNotice error={error} />
        {!error && <Loading />}
      </>
    );
  const manifest = run.manifest ? asRecord(run.manifest) : undefined;
  const holds = run.holds ? asRecord(run.holds) : {};
  const engine = run.engine ? asRecord(run.engine) : {};
  const occurrences = engine.nodes ? asRecord(engine.nodes) : {};
  const proposals = Array.isArray(run.proposals) ? run.proposals.map(asRecord) : [];
  const current = itemList(assignments.data).find(
    (attempt) => attempt.status === "running" && attempt.native,
  );
  const pending = itemList(requests.data).filter((request) => request.runId === id);
  return (
    <>
      <a href="#/runs" className="mb-5 inline-block text-xs text-slate-500">
        ← All runs
      </a>
      <PageHeading
        eyebrow={organizationName}
        title={`Run ${id.slice(0, 8)}`}
        description={text(run.reason)}
        action={
          <Button
            variant="outline"
            onClick={() => {
              refresh();
              requests.refresh();
              assignments.refresh();
            }}
          >
            <RefreshCw />
            Refresh
          </Button>
        }
      />
      <ErrorNotice error={error} />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Status value={run.status} />
        <span className="text-xs text-slate-500">
          Delivery {text(run.deliveryId)} · revision {text(run.version)}
        </span>
      </div>
      {Object.keys(holds).length > 0 && (
        <Card className="mb-6 gap-3 border-amber-200 bg-amber-50/50 shadow-none">
          <CardHeader>
            <CardTitle className="text-base text-amber-900">This run has active holds</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(holds).map(([key, value]) => (
              <p key={key} className="text-sm text-amber-900">
                {text(asRecord(value).reason)}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
      <Tabs defaultValue="timeline">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="timeline">Delivery</TabsTrigger>
          <TabsTrigger value="approvals">
            Questions & approvals{" "}
            {pending.filter((request) => request.status === "pending").length > 0
              ? `(${pending.filter((request) => request.status === "pending").length})`
              : ""}
          </TabsTrigger>
          <TabsTrigger value="conversation">Conversation</TabsTrigger>
          <TabsTrigger value="effects">External effects</TabsTrigger>
          <TabsTrigger value="planning">Planning & revisions</TabsTrigger>
          <TabsTrigger value="manifest">Admission & recovery</TabsTrigger>
        </TabsList>
        <TabsContent value="effects" className="mt-6 space-y-4">
          <ErrorNotice error={effects.error} />
          <Button variant="outline" onClick={effects.refresh}>
            <RefreshCw />
            Refresh effects
          </Button>
          {itemList(effects.data)
            .filter((effect) => asRecord(effect.intent).runId === id)
            .map((effect) => (
              <ResourceCard
                key={text(effect.id)}
                resource={{ ...effect, title: text(asRecord(effect.intent).action) }}
              >
                <Details
                  value={effect}
                  title="Pinned intent, provider receipt and recovery evidence"
                />
              </ResourceCard>
            ))}
          {!effects.loading &&
            !effects.error &&
            !itemList(effects.data).some((effect) => asRecord(effect.intent).runId === id) && (
              <Empty title="No external effects recorded">
                GitHub and deployment obligations appear here when the run reaches those actions.
              </Empty>
            )}
        </TabsContent>
        <TabsContent value="timeline" className="mt-6 space-y-4">
          {Object.entries(occurrences).map(([path, value]) => {
            const occurrence = asRecord(value);
            return (
              <Card key={path} className="gap-3 shadow-none">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="text-sm">{text(occurrence.action) || path}</CardTitle>
                  <Status value={occurrence.status} />
                </CardHeader>
                <CardContent>
                  <Details
                    value={occurrence}
                    title="Accepted inputs, outputs & checkpoint evidence"
                  />
                </CardContent>
              </Card>
            );
          })}
          {!Object.keys(occurrences).length && (
            <Empty title="Admission is being resolved">
              The candidate must freeze complete authority before any node can start. Its current
              verdict and reason remain visible above.
            </Empty>
          )}
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Delivery lineage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Details
                value={{
                  deliveryId: run.deliveryId,
                  request: run.request,
                  predecessorId: run.predecessorId,
                  successorId: run.successorId,
                }}
                title="Issue, source and linked runs"
              />
              {Boolean(run.predecessorId) && (
                <a
                  className="block text-sm text-teal-700"
                  href={`#/runs/${text(run.predecessorId)}`}
                >
                  Open predecessor run →
                </a>
              )}
              {Boolean(run.successorId) && (
                <a className="block text-sm text-teal-700" href={`#/runs/${text(run.successorId)}`}>
                  Open freshly admitted successor →
                </a>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="approvals" className="mt-6 space-y-4">
          <ErrorNotice error={requests.error} />
          {pending.map((request) => (
            <HumanRequest
              key={text(request.id)}
              request={request}
              credentials={credentials}
              onDone={() => {
                requests.refresh();
                refresh();
              }}
            />
          ))}
          {!pending.length && (
            <Empty title="No human decisions requested">
              Questions and exact approvals appear here when the playbook reaches a durable human
              wait.
            </Empty>
          )}
        </TabsContent>
        <TabsContent value="conversation" className="mt-6">
          <Conversation
            id={id}
            run={run}
            assignment={current}
            credentials={credentials}
            onDone={() => {
              refresh();
              assignments.refresh();
            }}
          />
        </TabsContent>
        <TabsContent value="planning" className="mt-6 space-y-5">
          <div className="flex flex-wrap gap-3">
            <CommandForm
              title="Create planning document"
              description="Create a shared Markdown draft. Saving live edits does not alter any active run."
              path="/knowledge/documents"
              credentials={credentials}
              fields={[
                { name: "title", label: "Document title", required: true },
                { name: "content", label: "Markdown", type: "textarea", required: true },
              ]}
              onDone={documents.refresh}
            />
            {itemList(documents.data).map((document) => (
              <Button
                key={text(document.id)}
                variant="outline"
                onClick={() => setDocumentId(text(document.id))}
              >
                {text(document.title)}
              </Button>
            ))}
          </div>
          {proposals.map((proposal) => (
            <Card key={text(proposal.id)} className="shadow-none">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">Submitted revision proposal</CardTitle>
                <Status value={proposal.status} />
              </CardHeader>
              <CardContent className="space-y-4">
                <Details value={proposal} title="Observed immutable proposal" />
                {proposal.status === "pending" && (
                  <div className="flex flex-wrap gap-3">
                    <CommandForm
                      title="Retain pinned revision"
                      description="Retain the current pinned revision after reviewing only this observed proposal. Future edits require another decision."
                      path={`/runs/${id}/retain`}
                      credentials={credentials}
                      defaults={{
                        expectedVersion: run.version,
                        proposalId: proposal.id,
                        pinnedDigest: manifest?.digest,
                      }}
                      fields={[
                        { name: "reason", label: "Reason", type: "textarea", required: true },
                      ]}
                      onDone={refresh}
                    />
                    <CommandForm
                      title="Adopt in successor run"
                      description="Supersede this run and create a linked successor from entry with fresh admission and approvals."
                      path={`/runs/${id}/adopt`}
                      credentials={credentials}
                      defaults={{ expectedVersion: run.version, proposalId: proposal.id }}
                      fields={[
                        { name: "reason", label: "Reason", type: "textarea", required: true },
                      ]}
                      onDone={(value) => {
                        if (value.id) location.hash = `/runs/${text(value.id)}`;
                        refresh();
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
        <TabsContent value="manifest" className="mt-6 space-y-5">
          <Details
            value={manifest ?? run.request}
            title={manifest ? "Frozen admission manifest" : "Candidate admission inputs"}
          />
          <Details value={assignments.data} title="Bounded attempts and writer coverage" />
          <div className="flex flex-wrap gap-3">
            <CommandForm
              title="Request cancellation"
              description="Stop future scheduling and account for work already in flight. A request does not prove every writer or effect stopped."
              path={`/runs/${id}/cancel`}
              credentials={credentials}
              defaults={{ expectedVersion: run.version }}
              fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
              onDone={refresh}
            />
            <CommandForm
              title="Inspect recovery"
              keepOpen
              description="Evaluate recovery eligibility without inventing writer-stop or external-effect evidence."
              path={`/runs/${id}/recovery`}
              credentials={credentials}
              defaults={{ expectedVersion: run.version, action: "inspect" }}
              fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
              onDone={refresh}
            />
            <CommandForm
              title="Resume from verified baseline"
              description="Request a new candidate with fresh admission from the verified immutable baseline. The service must confirm that no invocation was issued and an eligible runner is idle before creating a successor."
              path={`/runs/${id}/recovery`}
              credentials={credentials}
              defaults={{ expectedVersion: run.version, action: "resume" }}
              fields={[
                {
                  name: "reason",
                  label: "Recovery decision reason",
                  type: "textarea",
                  required: true,
                },
              ]}
              onDone={(value) => {
                refresh();
                if (value.successorId) location.hash = `/runs/${text(value.successorId)}`;
              }}
            />
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
function HumanRequest({
  request,
  credentials,
  onDone,
}: {
  request: RecordData;
  credentials: Credentials;
  onDone: () => void;
}) {
  const schema = asRecord(request.responseSchema);
  const properties = schema.properties ? asRecord(schema.properties) : {};
  const approval = Object.hasOwn(properties, "approved");
  const fields: Field[] = approval
    ? [
        {
          name: "approved",
          label: "Decision",
          type: "select",
          required: true,
          options: [
            { value: "true", label: "Approve the exact revision" },
            { value: "false", label: "Reject the exact revision" },
          ],
        },
      ]
    : [{ name: "response", label: "Typed response", type: "json", required: true, value: "{}" }];
  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">{text(request.title)}</CardTitle>
          <CardDescription>
            Deadline {new Date(text(request.deadline)).toLocaleString()}
          </CardDescription>
        </div>
        <Status value={request.status} />
      </CardHeader>
      <CardContent className="space-y-4">
        <Details
          value={{
            manifestDigest: request.manifestDigest,
            input: request.input,
            responseSchema: request.responseSchema,
          }}
          title="Exact revision and response contract"
        />
        {request.status === "pending" && (
          <CommandForm
            title={approval ? "Review decision" : "Answer question"}
            description={`This response binds request revision ${text(request.version)} and manifest ${text(request.manifestDigest)}.`}
            path={`/requests/${text(request.id)}/respond`}
            credentials={credentials}
            fields={[
              ...fields,
              { name: "reason", label: "Reason", type: "textarea", required: true },
            ]}
            transform={(values) => ({
              expectedVersion: request.version,
              manifestDigest: request.manifestDigest,
              reason: values.reason,
              response: approval ? { approved: values.approved === "true" } : values.response,
            })}
            onDone={onDone}
          />
        )}
        {request.status !== "pending" && (
          <Details
            value={{
              response: request.response,
              responderId: request.responderId,
              reason: request.reason,
            }}
            title="Recorded response and attribution"
          />
        )}
      </CardContent>
    </Card>
  );
}
function Conversation({
  id,
  run,
  assignment,
  credentials,
  onDone,
}: {
  id: string;
  run: RecordData;
  assignment?: RecordData;
  credentials: Credentials;
  onDone: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const state = useResource(`/runs/${id}/conversation?after=${cursor}`, credentials);
  const [output, setOutput] = useState<RecordData[]>([]);
  useEffect(() => {
    if (state.data) {
      const received = itemList(state.data, "output");
      setOutput((current) => {
        const merged = new Map(current.map((item) => [text(item.id), item]));
        for (const item of received) merged.set(text(item.id), item);
        return [...merged.values()].sort((a, b) => Number(a.sequence) - Number(b.sequence));
      });
      if (state.data.hasMore) setCursor(Number(state.data.cursor));
    }
  }, [state.data]);
  const refresh = state.refresh;
  useEffect(() => {
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [refresh]);
  const native = assignment?.native ? asRecord(assignment.native) : undefined;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="size-4" />
            Shared harness conversation
          </CardTitle>
          <CardDescription>
            Available attributed native output and tool activity. Cursor{" "}
            {text(state.data?.cursor) || "0"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ErrorNotice error={state.error} />
          <div
            className="max-h-[500px] space-y-4 overflow-y-auto"
            role="log"
            aria-label="Harness output"
          >
            {output.map((item) => (
              <div key={text(item.id)} className="rounded-lg bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between text-[10px] text-slate-400">
                  <span>
                    {text(item.actorId)} · {text(item.kind)}
                  </span>
                  <span>#{text(item.sequence)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-700">
                  {text(item.text)}
                </p>
              </div>
            ))}
            {!output.length && (
              <p className="py-8 text-center text-sm text-slate-500">
                No native output has been received for this run.
              </p>
            )}
          </div>
          {assignment && native ? (
            <CommandForm
              inline
              title="Send instruction"
              description="Queue an ordinary instruction for this exact turn."
              path={`/runs/${id}/steer`}
              credentials={credentials}
              defaults={{
                expectedVersion: run.version,
                assignmentId: assignment.id,
                turnId: native.turnId,
              }}
              fields={[
                {
                  name: "text",
                  label: "Instruction",
                  type: "textarea",
                  required: true,
                  hint: "Instructions do not replace approval, revision, or permission decisions.",
                },
              ]}
              onDone={() => {
                state.refresh();
                onDone();
              }}
            />
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-xs text-slate-500">
              Instructions are available when a current native turn is confirmed.
            </p>
          )}
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">Input delivery ledger</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {itemList(state.data, "inputs").map((input) => (
              <div key={text(input.id)} className="space-y-2 border-b pb-3 text-xs">
                <Status value={input.status} />
                <p className="whitespace-pre-wrap text-slate-700">{text(input.text)}</p>
                <p className="break-all text-[10px] text-slate-400">
                  {text(input.actorId)} · turn {text(input.turnId)}
                </p>
              </div>
            ))}
            {!itemList(state.data, "inputs").length && (
              <p className="text-xs text-slate-500">No instructions submitted.</p>
            )}
          </CardContent>
        </Card>
        {assignment && native && (
          <CommandForm
            title="Interrupt & redirect"
            description="Interrupt the exact current native turn and hold continuation. This does not prove every workspace writer or remote effect has stopped."
            path={`/runs/${id}/interrupt`}
            credentials={credentials}
            defaults={{
              expectedVersion: run.version,
              assignmentId: assignment.id,
              turnId: native.turnId,
            }}
            fields={[
              {
                name: "text",
                label: "Interruption reason and redirection",
                type: "textarea",
                required: true,
              },
            ]}
            onDone={() => {
              state.refresh();
              onDone();
            }}
          />
        )}
      </div>
    </div>
  );
}
