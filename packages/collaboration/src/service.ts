import { randomUUID } from "node:crypto";
import {
  DefinitionError,
  digest,
  type Json,
  jsonSchema,
  normalizeDefinition,
} from "@aa/catalog/definition";
import { DomainError } from "@aa/platform/contracts";
import type { CommandMeta, ContextStore, RecordEnvelope, Transaction } from "@aa/platform/store";
import * as Y from "yjs";
import {
  applyGraphCommand,
  type GraphCommand,
  graphDefinition,
  graphDocument,
  graphSnapshot,
  graphWriteSet,
  writesOverlap,
} from "./graph.ts";

export interface Draft {
  title: string;
  kind: "markdown" | "playbook";
  epoch: string;
  sequence: number;
  submittedHead: number;
  stateBase64: string;
  conflicts: string[];
  pendingDependencies: boolean;
}
export interface Candidate {
  documentId: string;
  epoch: string;
  sequence: number;
  digest: string;
  content: Json;
  validationProfile: string;
}
export interface Revision extends Candidate {
  candidateId: string;
  submissionSequence: number;
}
interface DraftOperation {
  documentId: string;
  epoch: string;
  sequence: number;
  actorId: string;
  operationId: string;
  updateBase64: string;
  baseSequence: number;
  writeSet: string[];
}
export function domainValidation<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      error instanceof DefinitionError ? error.code : "validation_error",
      error instanceof Error ? error.message.slice(0, 2000) : "Invalid content",
      400,
    );
  }
}
function decode(value: string, max = 4 * 1024 * 1024): Buffer {
  if (value.length > Math.ceil(max / 3) * 4)
    throw new DomainError("collaboration_limit", "Collaborative payload exceeds bounds", 413);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || bytes.length > max)
    throw new DomainError("invalid_update", "Expected canonical padded base64", 400);
  return bytes;
}
export function draftDocument(draft: Draft): Y.Doc {
  const doc = new Y.Doc();
  domainValidation(() => Y.applyUpdate(doc, decode(draft.stateBase64)));
  return doc;
}
const pending = (doc: Y.Doc) => !!doc.store.pendingStructs || !!doc.store.pendingDs;
function content(doc: Y.Doc, kind: Draft["kind"], validate = true): Json {
  if (kind === "playbook") return jsonSchema.parse(graphDefinition(doc, validate));
  if ([...doc.share.keys()].some((name) => name !== "markdown"))
    throw new DomainError(
      "invalid_update",
      "Markdown updates may only change the Markdown text",
      400,
    );
  const text = doc.getText("markdown");
  if (
    text
      .toDelta()
      .some(
        (part: { insert?: unknown; attributes?: unknown }) =>
          typeof part.insert !== "string" || part.attributes !== undefined,
      )
  )
    throw new DomainError(
      "invalid_update",
      "Markdown embeds and formatting attributes are unsupported",
      400,
    );
  const result = text.toString();
  if (Buffer.byteLength(result) > 512 * 1024)
    throw new DomainError("collaboration_limit", "Markdown exceeds 512 KiB", 413);
  return result;
}
export class CollaborationService {
  constructor(public readonly store: ContextStore) {
    if (!["catalog", "knowledge"].includes(store.context))
      throw new Error("Collaboration belongs to Catalog or Knowledge");
  }
  async create(meta: CommandMeta, title: string, kind: Draft["kind"], initial: unknown) {
    return this.store.command(meta, async (tx) => {
      if ((kind === "playbook") !== (this.store.context === "catalog"))
        throw new DomainError("owner_mismatch", "Draft kind does not belong to this owner", 400);
      const doc =
        kind === "playbook"
          ? domainValidation(() => graphDocument(normalizeDefinition(initial)))
          : new Y.Doc();
      if (kind === "markdown") {
        if (typeof initial !== "string")
          throw new DomainError("validation_error", "Markdown must be text", 400);
        doc.getText("markdown").insert(0, initial);
        content(doc, kind);
      }
      return tx.put<Draft>("draft", randomUUID(), {
        title,
        kind,
        epoch: randomUUID(),
        sequence: 0,
        submittedHead: 0,
        stateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
        conflicts: [],
        pendingDependencies: false,
      });
    });
  }
  async read(organizationId: string, id: string) {
    return this.store.read(organizationId, async (tx) => {
      const draft = await tx.require<Draft>("draft", id);
      const doc = draftDocument(draft.data);
      let materialized: Json | null = null;
      const diagnostics: string[] = [];
      try {
        materialized = content(doc, draft.data.kind, false);
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : "Conflicted draft");
      }
      return {
        ...draft,
        data: {
          ...draft.data,
          content: materialized,
          diagnostics,
          ...(draft.data.kind === "playbook" ? { graph: graphSnapshot(doc) } : {}),
        },
      };
    });
  }
  list(organizationId: string) {
    return this.store.read(organizationId, (tx) => tx.all<Draft>("draft"));
  }
  private epoch(draft: RecordEnvelope<Draft>, epoch: string) {
    if (draft.data.epoch !== epoch)
      throw new DomainError(
        "stale_epoch",
        "Rebuild your replica from the current owner epoch",
        409,
        "never",
        draft.data.sequence,
      );
  }
  private async saveUpdate(
    tx: Transaction,
    draft: RecordEnvelope<Draft>,
    doc: Y.Doc,
    baseSequence: number,
    writeSet: string[],
    update: Buffer,
  ) {
    const stateBase64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
    decode(stateBase64);
    const sequence = draft.data.sequence + 1;
    const updated = await tx.put(
      "draft",
      draft.id,
      { ...draft.data, sequence, stateBase64, pendingDependencies: pending(doc) },
      draft.version,
    );
    await tx.put<DraftOperation>("draft_update", randomUUID(), {
      documentId: draft.id,
      epoch: draft.data.epoch,
      sequence,
      actorId: tx.meta.actorId,
      operationId: tx.meta.operationId,
      updateBase64: update.toString("base64"),
      baseSequence,
      writeSet,
    });
    return updated;
  }
  update(meta: CommandMeta, id: string, body: { epoch: string; updateBase64: string }) {
    return this.store.command(meta, async (tx) => {
      const draft = await tx.require<Draft>("draft", id);
      this.epoch(draft, body.epoch);
      if (draft.data.kind !== "markdown")
        throw new DomainError(
          "semantic_command_required",
          "Graph updates require owner-derived semantic commands",
          400,
        );
      const doc = draftDocument(draft.data);
      const update = decode(body.updateBase64, 512 * 1024);
      domainValidation(() => {
        Y.applyUpdate(doc, update);
        content(doc, draft.data.kind);
      });
      return this.saveUpdate(tx, draft, doc, draft.data.sequence, ["markdown"], update);
    });
  }
  replace(
    meta: CommandMeta,
    id: string,
    body: { epoch: string; expectedSequence: number; content: unknown },
  ) {
    return this.store.command(meta, async (tx) => {
      let draft = await tx.require<Draft>("draft", id);
      this.epoch(draft, body.epoch);
      if (draft.data.sequence !== body.expectedSequence) {
        const proposal = await tx.put("draft_conflict", randomUUID(), {
          documentId: id,
          actorId: meta.actorId,
          baseSequence: body.expectedSequence,
          proposal: body.content,
          reason: "stale_replacement",
          resolved: false,
        });
        draft = await tx.put(
          "draft",
          id,
          { ...draft.data, conflicts: [...draft.data.conflicts, proposal.id] },
          draft.version,
        );
        return { status: "conflict" as const, draft, conflictId: proposal.id };
      }
      let doc: Y.Doc;
      if (draft.data.kind === "playbook") {
        doc = domainValidation(() => graphDocument(normalizeDefinition(body.content)));
        draft.data.epoch = randomUUID();
      } else {
        if (typeof body.content !== "string")
          throw new DomainError("validation_error", "Markdown replacement requires text", 400);
        doc = draftDocument(draft.data);
        doc.getText("markdown").delete(0, doc.getText("markdown").length);
        doc.getText("markdown").insert(0, body.content);
        content(doc, "markdown");
      }
      const saved = await this.saveUpdate(
        tx,
        draft,
        doc,
        body.expectedSequence,
        ["document"],
        Buffer.from(Y.encodeStateAsUpdate(doc)),
      );
      return { status: "accepted" as const, draft: saved };
    });
  }
  graph(
    meta: CommandMeta,
    id: string,
    body: { epoch: string; baseSequence: number; command: GraphCommand },
  ) {
    return this.store.command(meta, async (tx) => {
      const draft = await tx.require<Draft>("draft", id);
      this.epoch(draft, body.epoch);
      if (draft.data.kind !== "playbook")
        throw new DomainError("owner_mismatch", "Semantic graph commands require a playbook", 400);
      if (body.baseSequence > draft.data.sequence)
        throw new DomainError("invalid_cursor", "The base cursor is ahead of the owner", 409);
      const writes = graphWriteSet(body.command);
      const history = (
        await tx.all<DraftOperation>("draft_update", { documentId: id, epoch: body.epoch })
      ).filter((item) => item.data.sequence > body.baseSequence);
      if (
        history.some(
          (item) =>
            item.data.writeSet.includes("document") || writesOverlap(writes, item.data.writeSet),
        )
      ) {
        const conflict = await tx.put("draft_conflict", randomUUID(), {
          documentId: id,
          actorId: meta.actorId,
          proposal: body.command,
          baseSequence: body.baseSequence,
          competingOperations: history.map((item) => item.data.operationId),
          reason: "concurrent_semantic_intent",
          resolved: false,
        });
        const saved = await tx.put(
          "draft",
          id,
          { ...draft.data, conflicts: [...draft.data.conflicts, conflict.id] },
          draft.version,
        );
        return { status: "conflict" as const, draft: saved, conflictId: conflict.id };
      }
      const doc = draftDocument(draft.data);
      const vector = Y.encodeStateVector(doc);
      try {
        domainValidation(() => {
          applyGraphCommand(doc, body.command);
          graphDefinition(doc, false);
        });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        const conflict = await tx.put("draft_conflict", randomUUID(), {
          documentId: id,
          actorId: meta.actorId,
          proposal: body.command,
          baseSequence: body.baseSequence,
          competingOperations: [],
          reason: "invalid_semantic_intent",
          detail: error.message,
          resolved: false,
        });
        const saved = await tx.put(
          "draft",
          id,
          { ...draft.data, conflicts: [...draft.data.conflicts, conflict.id] },
          draft.version,
        );
        return { status: "conflict" as const, draft: saved, conflictId: conflict.id };
      }
      return {
        status: "accepted" as const,
        draft: await this.saveUpdate(
          tx,
          draft,
          doc,
          body.baseSequence,
          writes,
          Buffer.from(Y.encodeStateAsUpdate(doc, vector)),
        ),
      };
    });
  }
  resolveConflict(meta: CommandMeta, id: string, conflictId: string, expectedSequence: number) {
    return this.store.command(meta, async (tx) => {
      const draft = await tx.require<Draft>("draft", id);
      if (draft.data.sequence !== expectedSequence || !draft.data.conflicts.includes(conflictId))
        throw new DomainError(
          "stale_conflict",
          "Review the exact current conflict before resolving",
          409,
        );
      const conflict = await tx.require<{ documentId: string; resolved: boolean }>(
        "draft_conflict",
        conflictId,
      );
      if (conflict.data.documentId !== id)
        throw new DomainError("not_found", "Conflict unavailable", 404);
      await tx.put(
        "draft_conflict",
        conflictId,
        { ...conflict.data, resolved: true, resolvedBy: meta.actorId },
        conflict.version,
      );
      return tx.put(
        "draft",
        id,
        { ...draft.data, conflicts: draft.data.conflicts.filter((key) => key !== conflictId) },
        draft.version,
      );
    });
  }
  candidate(meta: CommandMeta, id: string, body: { epoch: string; expectedSequence: number }) {
    return this.store.command(meta, async (tx) => {
      const draft = await tx.require<Draft>("draft", id);
      this.epoch(draft, body.epoch);
      if (draft.data.sequence !== body.expectedSequence)
        throw new DomainError(
          "stale_draft",
          "The owner draft changed before candidate creation",
          409,
          "never",
          draft.data.sequence,
        );
      if (draft.data.conflicts.length || draft.data.pendingDependencies)
        throw new DomainError(
          "draft_conflict",
          "Resolve draft conflicts and missing update dependencies before review",
          409,
        );
      const value = domainValidation(() => content(draftDocument(draft.data), draft.data.kind));
      return tx.put<Candidate>("candidate", randomUUID(), {
        documentId: id,
        epoch: draft.data.epoch,
        sequence: draft.data.sequence,
        digest: digest(value),
        content: value,
        validationProfile:
          draft.data.kind === "playbook"
            ? "agents-assemble.playbook/1"
            : "agents-assemble.markdown/1",
      });
    });
  }
  submit(meta: CommandMeta, id: string, body: { candidateId: string; expectedHead: number }) {
    return this.store.command(meta, async (tx) => {
      const draft = await tx.require<Draft>("draft", id);
      const candidate = await tx.require<Candidate>("candidate", body.candidateId);
      if (candidate.data.documentId !== id)
        throw new DomainError("not_found", "Candidate unavailable", 404);
      if (draft.data.submittedHead !== body.expectedHead)
        throw new DomainError(
          "head_conflict",
          "The submitted head changed after preview",
          409,
          "never",
          draft.data.submittedHead,
        );
      if (draft.data.kind === "playbook")
        domainValidation(() => normalizeDefinition(candidate.data.content));
      const revision = await tx.put<Revision>("revision", randomUUID(), {
        ...candidate.data,
        candidateId: candidate.id,
        submissionSequence: draft.data.submittedHead + 1,
      });
      const saved = await tx.put(
        "draft",
        id,
        { ...draft.data, submittedHead: revision.data.submissionSequence },
        draft.version,
      );
      await tx.emit(`${this.store.context}.revision_submitted`, saved, {
        documentId: id,
        epoch: candidate.data.epoch,
        submissionSequence: revision.data.submissionSequence,
        revisionId: revision.id,
        digest: revision.data.digest,
        candidateId: candidate.id,
      });
      return revision;
    });
  }
  getRevision(organizationId: string, id: string) {
    return this.store.read(organizationId, (tx) => tx.require<Revision>("revision", id));
  }
  history(organizationId: string, id: string, cursor: number) {
    return this.store.read(organizationId, async (tx) => {
      const draft = await tx.require<Draft>("draft", id);
      if (cursor > draft.data.sequence)
        throw new DomainError("invalid_cursor", "Cursor is ahead of owner history", 409);
      return {
        cursor: draft.data.sequence,
        items: (await tx.all<DraftOperation>("draft_update", { documentId: id }))
          .filter((item) => item.data.sequence > cursor)
          .sort((a, b) => a.data.sequence - b.data.sequence),
      };
    });
  }
}
