import type { DocumentRevision } from "@factory/workflow";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ReadOnlyMarkdown({ content }: { content: string }) {
  return (
    <div className="run-markdown min-w-0 break-words">
      <Markdown skipHtml remarkPlugins={[remarkGfm]}>
        {content}
      </Markdown>
    </div>
  );
}

export function RunDocuments({
  documents,
  approvedRevisionIds = [],
}: {
  documents: DocumentRevision[];
  approvedRevisionIds?: string[];
}) {
  const documentIds = [
    ...new Set(documents.map((document) => document.documentId)),
  ];
  return (
    <section className="grid gap-3" aria-label="Run documents">
      <h2 className="text-lg font-semibold">Run documents</h2>
      {documentIds.length === 0 ? (
        <p className="text-sm text-slate-500">
          Generated documents will appear here with immutable revision history.
        </p>
      ) : null}
      {documentIds.map((documentId) => {
        const revisions = documents
          .filter((document) => document.documentId === documentId)
          .sort((first, second) => second.revision - first.revision);
        return (
          <section
            key={documentId}
            className="grid gap-2 rounded-lg border bg-white p-4"
          >
            <h3 className="font-semibold">{revisions[0]?.name}</h3>
            {revisions.map((revision, index) => (
              <details
                key={revision.revisionId}
                open={
                  index === 0 ||
                  approvedRevisionIds.includes(revision.revisionId)
                }
                className="rounded-md border"
              >
                <summary className="cursor-pointer bg-slate-50 p-3 text-sm">
                  Revision {revision.revision} · {revision.activityId}
                  {approvedRevisionIds.includes(revision.revisionId)
                    ? " · Approval includes this revision"
                    : ""}
                </summary>
                <div className="grid gap-3 p-4">
                  <dl className="grid gap-1 text-xs text-slate-500">
                    <div>
                      <dt className="inline font-medium">Revision: </dt>
                      <dd className="inline font-mono">
                        {revision.revisionId}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">
                        Producer execution:{" "}
                      </dt>
                      <dd className="inline font-mono">
                        {revision.executionId}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Created: </dt>
                      <dd className="inline">{revision.createdAt}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">
                        Consumed revisions:{" "}
                      </dt>
                      <dd className="inline font-mono">
                        {revision.consumedRevisionIds.join(", ") || "None"}
                      </dd>
                    </div>
                  </dl>
                  <ReadOnlyMarkdown content={revision.content} />
                </div>
              </details>
            ))}
          </section>
        );
      })}
    </section>
  );
}
