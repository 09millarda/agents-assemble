export type WorkflowStatus = "draft" | "published";

export const WORKFLOW_STATUSES = ["draft", "published"] as const;
export const MAX_WORKFLOW_TAGS = 20;
export const MAX_WORKFLOW_TAG_LENGTH = 50;

export function isWorkflowPublished(status: WorkflowStatus): boolean {
  return status === "published";
}

export function isWorkflowStatus(value: string): value is WorkflowStatus {
  return (WORKFLOW_STATUSES as readonly string[]).includes(value);
}

export function normalizeWorkflowTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

export function validateWorkflowTags(tags: string[]): string | null {
  const normalizedTags = normalizeWorkflowTags(tags);
  if (normalizedTags.length > MAX_WORKFLOW_TAGS)
    return "A workflow can have at most 20 tags";
  if (normalizedTags.some((tag) => tag.length > MAX_WORKFLOW_TAG_LENGTH))
    return "Workflow tags must be 50 characters or fewer";
  return null;
}
