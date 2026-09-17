# Workflow run cancellation and deletion

Status: Accepted.

Cancellation is a distinct lifecycle request from Run Deletion: a run enters `cancellation-requested`, stops future dispatch, asks the daemon to stop active work, and reaches `cancelled` only after that work has stopped. Run Deletion is available only after a run is stopped, permanently removes the Factory-owned run history and local execution resources, returns no restore path, and never removes external Git commits, branches, or pull requests.
