# Retained worktrees and resumable Codex activity conversations

Status: Accepted. Replaces workflow execution details in [ADR-0021](0021-daemon-cwd-execution-and-git-gate.md).

Each Workflow Run receives a dedicated branch and retained worktree from a pinned commit on a selected local branch, defaulting to the project’s current branch. Uncommitted original-checkout changes stay outside the run. Selected document revisions are materialized outside tracked code; optional setup commands run in the worktree with persisted logs, and environment files are never copied automatically.

A Linux `flock` process lock protects each daemon state directory. Duplicate processes cannot share its execution journal. Unsupported locking or loss of the lock stops execution; the first release verifies daemon execution on Linux.

The workflow Codex adapter pins CLI 0.154.0 and uses the local app-server’s bidirectional stdio protocol, explicit per-turn model/effort settings, and structured completion. This is the daemon’s only harness execution path. Every execution starts a fresh thread; questions and revision requests remain in that execution’s persisted session. Capabilities are discovered and advertised only when implemented and available.

GitHub publication uses local `gh` authentication and Git credentials. Repository, push remote, and base resolve before execution. A durable publication intent and reviewed tree identity guard ordinary hooks, non-forced push, and PR creation. Recovery searches the remote branch and matching PR before creating anything again. Draft PRs are the starter default; retained worktrees remain available after completion or cancellation.
