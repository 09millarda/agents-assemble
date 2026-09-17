import { useState } from "react";
import { X } from "lucide-react";
import {
  MAX_WORKFLOW_TAG_LENGTH,
  MAX_WORKFLOW_TAGS,
  normalizeWorkflowTags,
} from "@factory/workflow";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";

export function WorkflowTagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [value, setValue] = useState("");

  function commitValue(): void {
    const nextTags = normalizeWorkflowTags([...tags, value]);
    if (
      nextTags.length <= MAX_WORKFLOW_TAGS &&
      nextTags.every((tag) => tag.length <= MAX_WORKFLOW_TAG_LENGTH)
    ) {
      onChange(nextTags);
      setValue("");
    }
  }

  function removeTag(tagToRemove: string): void {
    onChange(tags.filter((tag) => tag !== tagToRemove));
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1">
            {tag}
            <button
              type="button"
              aria-label={`Remove workflow tag: ${tag}`}
              onClick={() => removeTag(tag)}
              className="rounded-full hover:bg-black/10"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={value}
        aria-label="Workflow tags"
        placeholder="Add a tag, then press Enter or comma"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commitValue();
          }
        }}
        onBlur={commitValue}
      />
    </div>
  );
}
