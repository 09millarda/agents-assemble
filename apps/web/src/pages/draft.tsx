import type { Node } from "@aa/catalog/definition";
import { Download, RefreshCw, Save, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { LiveGraph } from "@/components/live-graph";
import { LiveMarkdown } from "@/components/live-markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  CommandForm,
  Details,
  ErrorNotice,
  Loading,
  PageHeading,
  Status,
} from "@/components/workspace";
import {
  asRecord,
  type Credentials,
  type RecordData,
  resource,
  text,
  useCommand,
  useResource,
} from "@/lib/api";

function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
function supported(node: unknown): node is Node {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const item = asRecord(node);
  if (
    typeof item.id !== "string" ||
    !["call", "sequence", "choose", "parallel", "forEach", "repeat", "end"].includes(
      text(item.type),
    )
  )
    return false;
  if (item.type === "sequence")
    return Array.isArray(item.children) && item.children.every(supported);
  if (item.type === "parallel")
    return Array.isArray(item.branches) && item.branches.every(supported);
  if (item.type === "choose")
    return (
      Array.isArray(item.cases) &&
      item.cases.every((branch) => supported(asRecord(branch).then)) &&
      supported(item.otherwise)
    );
  if (item.type === "forEach" || item.type === "repeat") return supported(item.body);
  return true;
}
export function DraftEditor({
  id,
  owner,
  credentials,
  organizationName,
}: {
  id: string;
  owner: "catalog" | "knowledge";
  credentials: Credentials;
  organizationName: string;
}) {
  const base = `/collaboration/${owner}/${id}`;
  const state = useResource(base, credentials);
  const command = useCommand(credentials);
  const [content, setContent] = useState("");
  const [baseDraft, setBaseDraft] = useState<RecordData>();
  const [dirty, setDirty] = useState(false);
  const [livePending, setLivePending] = useState(false);
  const [localError, setLocalError] = useState<Error>();
  const [candidate, setCandidate] = useState<RecordData>();
  const [receipt, setReceipt] = useState<RecordData>();
  useEffect(() => {
    if (state.data && !dirty) {
      setBaseDraft(state.data);
      setContent(
        owner === "knowledge"
          ? text(state.data.content)
          : JSON.stringify(state.data.content, null, 2),
      );
    }
  }, [state.data, dirty, owner]);
  const refresh = state.refresh;
  // Owner polling provides cursor recovery; local changes keep their exact base until accepted.
  useEffect(() => {
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  let parsed: RecordData | undefined;
  try {
    parsed = asRecord(JSON.parse(content));
  } catch {}
  const graph = parsed && supported(parsed.body) ? parsed.body : undefined;
  async function save() {
    setLocalError(undefined);
    try {
      const result = await command.run(`${base}/replace`, {
        epoch: baseDraft?.epoch,
        expectedSequence: baseDraft?.sequence,
        content: owner === "knowledge" ? content : JSON.parse(content),
      });
      setReceipt(result);
      if (result.status === "accepted") {
        setDirty(false);
        state.refresh();
      }
    } catch (error) {
      if (error instanceof SyntaxError)
        setLocalError(new Error("Enter valid JSON before saving the draft."));
    }
  }
  async function freeze() {
    try {
      const result = await command.run(`${base}/candidates`, {
        epoch: state.data?.epoch,
        expectedSequence: state.data?.sequence,
      });
      setCandidate(resource(result));
    } catch {}
  }
  return (
    <>
      <a
        href={owner === "catalog" ? "#/catalog" : "#/runs"}
        className="mb-5 inline-block text-xs text-slate-500"
      >
        ← Back to workspace
      </a>
      <PageHeading
        eyebrow={organizationName}
        title={text(state.data?.title) || "Collaborative draft"}
        description="Draft changes and immutable submission are separate. Active runs keep their pinned revision until an explicit decision."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={state.refresh} aria-label="Refresh draft">
              <RefreshCw className="size-4" />
            </Button>
            <Button disabled={!dirty || command.pending} onClick={save}>
              <Save className="size-4" />
              Save draft
            </Button>
          </div>
        }
      />
      <ErrorNotice error={localError ?? command.error ?? state.error} />
      {!baseDraft && state.loading && <Loading />}
      {baseDraft && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <Users className="size-4" />
            <Status
              value={
                dirty ? "local_changes" : state.data?.pendingDependencies ? "pending" : "saved"
              }
            />
            <span>Owner cursor {text(state.data?.sequence)}</span>
            <span>Submitted head {text(state.data?.submittedHead)}</span>
            {dirty && state.data?.sequence !== baseDraft.sequence && (
              <span className="text-amber-700">
                New remote edits arrived. Saving will compare your original base.
              </span>
            )}
          </div>
          {Array.isArray(state.data?.conflicts) && state.data.conflicts.length > 0 && (
            <Card className="mb-5 border-amber-200 bg-amber-50/60 shadow-none">
              <CardHeader>
                <CardTitle>Draft needs conflict review</CardTitle>
                <CardDescription>
                  Inspect the preserved proposal and current draft, make a deliberate repair, then
                  resolve each observed conflict.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Details
                  value={receipt ?? state.data}
                  title="Conflict and preserved draft evidence"
                />
                {state.data.conflicts.map((conflict) => (
                  <CommandForm
                    key={text(conflict)}
                    title="Resolve observed conflict"
                    description={`Acknowledge only conflict ${text(conflict)} after reviewing and repairing the current draft.`}
                    path={`${base}/conflicts/${text(conflict)}/resolve`}
                    credentials={credentials}
                    defaults={{ expectedSequence: state.data?.sequence }}
                    fields={[]}
                    onDone={state.refresh}
                  />
                ))}
              </CardContent>
            </Card>
          )}
          <Tabs defaultValue={owner === "catalog" ? "visual" : "markdown"}>
            <TabsList>
              {owner === "catalog" && <TabsTrigger value="visual">Visual workflow</TabsTrigger>}
              <TabsTrigger value={owner === "catalog" ? "json" : "markdown"}>
                {owner === "catalog" ? "Canonical JSON" : "Markdown"}
              </TabsTrigger>
              <TabsTrigger value="revision">Review & submit</TabsTrigger>
            </TabsList>
            <TabsContent value="visual" className="mt-5">
              {graph && parsed ? (
                <LiveGraph
                  id={id}
                  credentials={credentials}
                  onSaved={state.refresh}
                  onPending={setLivePending}
                />
              ) : (
                <Card>
                  <CardContent className="pt-4 text-sm text-amber-800">
                    This definition cannot be represented by the supported visual grammar. Inspect
                    or export its complete JSON. Unsupported behavior cannot be published.
                  </CardContent>
                </Card>
              )}
            </TabsContent>
            <TabsContent
              value={owner === "catalog" ? "json" : "markdown"}
              forceMount
              className="mt-5 space-y-4 data-[state=inactive]:hidden"
            >
              {owner === "knowledge" ? (
                <LiveMarkdown
                  id={id}
                  credentials={credentials}
                  onSaved={state.refresh}
                  onPending={setLivePending}
                />
              ) : (
                <>
                  <label htmlFor="draft-content" className="sr-only">
                    {owner === "catalog" ? "Canonical playbook JSON" : "Markdown document"}
                  </label>
                  <Textarea
                    id="draft-content"
                    value={content}
                    onChange={(event) => {
                      setContent(event.target.value);
                      setDirty(true);
                    }}
                    className="min-h-[460px] bg-white font-mono text-xs leading-6"
                    spellCheck={false}
                  />
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    download(
                      `${text(baseDraft.title) || "draft"}.${owner === "catalog" ? "json" : "md"}`,
                      content,
                      owner === "catalog" ? "application/json" : "text/markdown",
                    )
                  }
                >
                  <Download />
                  Export {owner === "catalog" ? "JSON" : "Markdown"}
                </Button>
                {owner === "catalog" && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        try {
                          JSON.parse(content);
                          download(
                            "playbook.ts",
                            `import { definePlaybook } from "@aa/catalog/builder";\n\nexport const playbook = definePlaybook(JSON.parse(${JSON.stringify(content)}));\n`,
                            "text/typescript",
                          );
                        } catch {
                          setLocalError(new Error("Enter valid JSON before exporting TypeScript."));
                        }
                      }}
                    >
                      Export TypeScript
                    </Button>
                    <Button
                      variant="outline"
                      disabled={command.pending}
                      onClick={async () => {
                        try {
                          const result = await command.run("/catalog/validate", {
                            definition: JSON.parse(content),
                          });
                          setReceipt(result);
                        } catch (error) {
                          if (error instanceof SyntaxError) setLocalError(error);
                        }
                      }}
                    >
                      <ShieldCheck />
                      Validate definition
                    </Button>
                  </>
                )}
              </div>
            </TabsContent>
            <TabsContent value="revision" className="mt-5 space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle>Freeze an exact candidate</CardTitle>
                  <CardDescription>
                    Review immutable owner-derived bytes before submitting a revision or publishing
                    a version.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button disabled={dirty || livePending || command.pending} onClick={freeze}>
                    <ShieldCheck />
                    Freeze review candidate
                  </Button>
                  {dirty && (
                    <p className="text-xs text-amber-700">
                      Save your local draft changes before creating a candidate.
                    </p>
                  )}
                  {candidate && (
                    <>
                      <Details value={candidate} title="Exact immutable candidate" />
                      <div className="flex flex-wrap gap-3">
                        <CommandForm
                          title="Submit revision"
                          description={`Submit candidate ${text(candidate.id)} at the observed submitted head. Submission does not adopt the change into a run.`}
                          path={`${base}/submit`}
                          credentials={credentials}
                          defaults={{
                            candidateId: candidate.id,
                            expectedHead: state.data?.submittedHead,
                          }}
                          fields={[]}
                          onDone={(result) => {
                            setReceipt(result);
                            state.refresh();
                          }}
                        />
                        {owner === "catalog" && (
                          <CommandForm
                            title="Publish organization version"
                            description="Publish this exact candidate as an immutable version for future admissions."
                            path={`/catalog/playbooks/${id}/publish`}
                            credentials={credentials}
                            defaults={{
                              candidateId: candidate.id,
                              expectedHead: state.data?.submittedHead,
                            }}
                            fields={[]}
                            onDone={(result) => {
                              setReceipt(result);
                              state.refresh();
                            }}
                          />
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
          {receipt && (
            <div role="status" className="mt-5 space-y-2">
              <Status value={receipt.status ?? (receipt.valid === true ? "valid" : "recorded")} />
              <Details value={receipt} title="Latest durable receipt" />
            </div>
          )}
        </>
      )}
    </>
  );
}
