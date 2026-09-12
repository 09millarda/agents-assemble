# Bounded source audit and repair record

An independent research subagent reviewed `run.py` and its two vendored modules.
It did not run another native experiment and did not edit the fixture.

1. **Privileged evidence read:** the initial controller followed user-controlled
   artifact paths and republished parsed JSON into root evidence. A symlink could
   therefore disclose root-readable JSON. The final reader pins the workspace
   entry below a root-owned parent, uses directory-relative `O_NOFOLLOW` opens,
   refuses nonregular/non-native-owned files, bounds bytes and checks allowed
   top-level fields. Actual toy-sentinel symlink and root-owned-file cases pass.
   Neither case targets native account data or real credentials.
2. **Administrative helper routes:** NNP/sudo denial does not prove denial of
   privileged daemon requests. The final probe records a denied, valid
   `CPUWeight=100` mutation against its disposable system service. A separate
   same-UID/NNP probe successfully asks the user manager to launch a bounded
   sibling writer, which regains ordinary supplementary groups. This is a
   concrete coverage limitation, not proof that every privileged helper was tested.

The subagent rechecked these two fixes and found no remaining material issue in
that bounded audit. It did not certify the native harness sandbox, the host's
entire polkit policy, all IPC surfaces, root compromise resistance, complete
schema validation or a production protected service.

The controller also corrected a pre-native CLI role dispatch error and adapted
the full native observation into the unchanged #10 fixture's exact evidence
envelope before authenticated submission. Full observation records remain
separate from that canonical projection.

`archive/run-1` and `archive/run-2` preserve the superseded source and outcomes.
`archive/run-3` and the top-level evidence match the final executed source hashes.
`verification.json` records source checks, root-tree removal and browser model
checks. Browser controls are illustrative; none count as native evidence.
