# Protected observer prerequisite probe

Throwaway evidence for [decision #11](https://github.com/09millarda/agents-assemble/issues/11).
This directory contains a read-only environment probe, **not an observer prototype**.

```sh
python3 preflight.py --output preflight.json
```

The probe reads tool versions, user identity and cgroup-v2 availability, asks the
existing sudo policy whether `true` can run without interaction, and records every
command result. It does not modify sudo policy, create users, install services,
read native account files, launch a model turn, or create a writer. It writes only
the requested output file. A successful administrative check would merely allow
operator/environment review; it would not prove observer protection.

The retained run lacks noninteractive administrative access. Protection, native
login compatibility, retained-scope recovery and authenticated receipt delivery
remain untested. This is a missing experiment prerequisite, not evidence that a
protected observer is infeasible. Automatic takeover remains ineligible.

Only this probe and its nonsensitive observations belong on the scratch branch.
The source comparison and pending experiment plan belong in planning records.
