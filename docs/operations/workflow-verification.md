# Workflow rebuild verification — 2026-09-15

## Verified locally

| Boundary | Evidence |
| --- | --- |
| Workspace checks | `pnpm exec turbo run test typecheck build` passed all 24 tasks. Later focused checks cover the final daemon and database test refinements. |
| Containers | `docker compose build api coordinator portal-site` passed for all three changed services. |
| API contract | OpenAPI generation and contract checks pass with the workflow, activity-template, run, document, interaction, recipient, and notification resources. |
| Durable execution | Eight coordinator tests passed against a newly migrated isolated Postgres database, including actual Node DBOS and Bun API/WebSocket processes. Hard coordinator termination restores a pending question; duplicate answers/approvals preserve one progression; frozen settings and exact document revisions cross the socket boundary. |
| Storage outage | A real Node DBOS regression survives 25 unavailable-store reads, then consumes the queued cancellation. A lost save response reuses the same message and execution. |
| Cutover and ownership | Eight database tests pass. Each destructive cutover/lease fixture uses its own temporary database. Archive checksums/counts, immutable snapshots/documents, competing coordinator rejection, and fatal lease loss are covered. |
| Daemon | Real temporary Git repositories and filesystem journals test separate retained worktrees, pinned commits, excluded original-checkout edits, setup failure logs, duplicate commands, cancellation, and recovery. Real process tests cover exclusive Linux `flock` ownership and release after a crash. |
| Codex | Local Codex 0.154.0 successfully discovers models and runs an isolated requirements interview with `gpt-5.6-luna`/low. A separate app-server resumes the same session and produces structured acceptance criteria. Lost native request identities pause for recovery instead of silently starting another turn. |
| Publication | Git/GitHub boundary tests cover ordinary hooks/push, changed reviewed content, interrupted creation, matching PR identity/base, and persisted title/body/draft intent. Exact accepted-findings revisions are included independently of configurable PR body inputs. |
| Portal | Real Chrome smoke: start with no prompt, close/reopen test portal tabs, restore pending question/session/transcript, answer, inspect document revision 1, request changes, inspect revision 2 with producer identity, approve revision 2, and observe completed status. The daemon in this UI test is a socket boundary substitute. |
| Push failures | Real database/API tests expose delivery rejection and preserve completed run state. A late expiry for an old subscription cannot deactivate its replacement. Web Push and service-worker boundary tests verify notification identities, payloads, click destinations, and recipient separation. |

## External acceptance still outstanding

- **Closed-tab OS push delivery and click-through:** Chrome notification permission was requested, but its native permission prompt was unavailable to the automation surface. No actual subscription or OS notification delivery was established. Reopening the portal successfully is separate evidence and does not establish push delivery. Repeat with permission granted, all portal tabs closed, and two independently enrolled desktop browsers.
- **Real GitHub publication:** no disposable target repository was supplied, so no remote branch or PR was created. Repeat the publication/reconciliation smoke against the explicitly selected disposable repository using existing `gh` authentication.

The existing application database was not migrated. Only isolated test databases received the replacement schema. Follow [the cutover procedure](workflow-execution.md#existing-database-cutover) to stop old writers, archive and verify their data, and replace the deployed schema.
