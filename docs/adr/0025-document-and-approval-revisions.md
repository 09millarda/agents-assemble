# Immutable run-local documents and approvals

Status: Accepted.

A run freezes its complete workflow definition and configured activity settings. Activity Templates create independent copies. At each activity execution, selected Context Document inputs bind to concrete immutable revisions; outputs record their producing execution and consumed revisions. Required Markdown headings and an explicit outcome are validated before a handoff; malformed output remains visible as an execution error.

An approval identifies exact output revisions. Request changes resumes the producer conversation with feedback and creates new output revisions, giving the next approval a new interaction identity. A repeated or stale interaction response cannot advance a run. Publication approval also identifies reviewed code content; changes after review require review again. Documents are read-only in the browser and raw HTML rendering is disabled. Document selection controls supplied context, without promising isolation from other information in the worktree.

Accepting unresolved findings binds their exact document revisions. Publication includes those contents even when the configured PR body inputs omit the review documents.
