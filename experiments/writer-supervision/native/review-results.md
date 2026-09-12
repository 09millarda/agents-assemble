# Independent native evidence review

Archive checks: **69/69**. Optional original-workspace checks: **14/14**. This review made **zero native requests**; it inspected **four recorded native runs**, each with one `turn/start`. These counts are separate.

Both graceful runs report an interrupted turn while their identified writer is still alive. Both App Server kill runs retain the writer and increasing heartbeat bytes. Whole-unit stop ends the known writer in every record. Both delegated runs additionally record `populated 0` for unchanged payload inodes **37264** (kill) and **37829** (graceful), while each original shim activation remains active, and write scoped receipts before outer cleanup.

Entry-point source hashes match retained bytes: original plain probe `fbe6684eb186a2fc99fa81e7800c9a9d77d89b158ba094676576850c2e083f56`; delegated probe `7080348b288322dc96406fcab604ce1cda5e51747177eabef4557910d60cbf21`. Supporting-source and evidence hashes are captured in the JSON at review time.

Important limits:

- The two plain runs show known-writer exit after unit stop; ENODEV or missing cgroup metadata is not a direct subtree-empty observation.
- Both delegated native runs record actual payload populated=0. No daemon/controller-death or runtime-deadline native run is retained here.
- The receipt concerns the payload; the trusted shim is deliberately still alive outside it. It does not prove whole-unit, whole-host, arbitrary-writer or external-effect quiescence.
- The receipt file is flushed and fsynced before outer cleanup, but its newly created directory entry is not directory-fsynced; crash-durable receipt creation was not established.
- The recorded sourceSha256 binds each probe entry point. client.py and delegated_supervisor.py have review-time hashes only; original run records did not attest those supporting bytes.
- pidfd_open occurs after numeric-PID snapshots. Held pidfds prevent later reuse confusion but not an acquisition race; matching writer startTicks/namespace in subsequent snapshots supports the recorded instance, not a generic restart/reopen guarantee.
- The shim stays in its unit root and source does not enable domain controllers. No cgroup.subtree_control value was captured. A future profile should separate supervisor/payload subgroups if enabling domain controllers.
- The shim launches once and never restarts but does not journal launch intent or stop the payload on controller loss; RuntimeMaxSec bounds the entire unit without guaranteeing an emptiness receipt.
- The local fixture receipt lacks ADR assignment/generation/journal identity and authenticated transport provenance; it cannot independently authorize production replacement admission.
- Same-UID control/daemon escape, input tampering, other authorized writers, external effects and kernel/manager failure are outside this trusted local fixture claim.
