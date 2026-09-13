import {
  CommandForm,
  Empty,
  ErrorNotice,
  itemList,
  Loading,
  PageHeading,
  ResourceCard,
} from "@/components/workspace";
import { type Credentials, text, useResource } from "@/lib/api";
import { DraftEditor } from "@/pages/draft";

export function Documents({
  id,
  credentials,
  organizationName,
}: {
  id?: string;
  credentials: Credentials;
  organizationName: string;
}) {
  const state = useResource("/knowledge/documents", credentials);
  if (id)
    return (
      <DraftEditor
        id={id}
        owner="knowledge"
        credentials={credentials}
        organizationName={organizationName}
      />
    );
  return (
    <>
      <PageHeading
        eyebrow={organizationName}
        title="Planning"
        description="Collaborate on Markdown with attributed, durable edits. Submit an immutable revision separately when scope is ready for review."
        action={
          <CommandForm
            title="Create document"
            description="Create a collaborative Markdown draft in this organization."
            path="/knowledge/documents"
            credentials={credentials}
            fields={[
              { name: "title", label: "Document title", required: true },
              { name: "content", label: "Initial Markdown", type: "textarea", required: true },
            ]}
            onDone={state.refresh}
          />
        }
      />
      <ErrorNotice error={state.error} />
      {state.loading && <Loading />}
      <div className="grid gap-4 lg:grid-cols-2">
        {itemList(state.data).map((document) => (
          <ResourceCard
            key={text(document.id)}
            resource={document}
            href={`#/documents/${text(document.id)}`}
          >
            <p className="text-xs text-slate-500">
              Acknowledged sequence {text(document.sequence)} · submitted head{" "}
              {text(document.submittedHead)}
            </p>
          </ResourceCard>
        ))}
      </div>
      {!state.loading && !state.error && !itemList(state.data).length && (
        <Empty title="Put your plan into words">
          Start a document for discovery, a specification, a review, or another intentional planning
          artifact.
        </Empty>
      )}
    </>
  );
}
