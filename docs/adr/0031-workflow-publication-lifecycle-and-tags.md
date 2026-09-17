# Workflow publication lifecycle and tags

Status: Accepted.

Workflow definitions have a server-managed lifecycle status: `draft` or `published`. Creation always produces a Draft workflow, ordinary edits preserve the current status, and explicit publish/unpublish commands move the definition between those states. Publishing runs the complete workflow validation. Only Published workflows may be enabled for projects or used to start new runs.

Unpublishing is an atomic catalog operation that changes the definition to Draft and removes it from every project's enabled-workflow list. Existing runs are unaffected because each run executes its frozen workflow snapshot. Workflow deletion remains physical removal; Deleted is not stored as a third status.

Workflows also carry a normalized list of user-assigned tags. Tags are trimmed, lowercased, and deduplicated, with at most 20 tags and at most 50 characters per tag. Catalog search matches workflow names case-insensitively by substring. Status filters, repeated tag filters, and name search are combined with AND semantics before stable cursor pagination; pagination links retain the active filters.
