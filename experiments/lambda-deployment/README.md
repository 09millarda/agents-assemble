# Lambda deployment prerequisite archive (throwaway)

Decision [#15](https://github.com/09millarda/agents-assemble/issues/15).
This archive records prerequisites only. It contains no deployment application,
workflow or passing deployment/rollback evidence. Never import it as production code.

Run the read-only recorder with Python 3 and an authenticated `gh`:

```sh
python3 preflight.py > prerequisites.json
```

It inspects executable availability, AWS configuration profile names and selected
GitHub repository metadata. It prints no credential values. GitHub request
failures remain explicit; they are not interpreted as an empty configuration.
No STS call, dispatch, AWS provisioning or deletion occurs. The repository is
the planning repository, not the dedicated deployment fixture repository still
to be selected. Absence here does not establish absence in other accounts/repos.

The mainline research/experiment plan describes required sandbox inputs and
future observations. All real provider acceptance cases remain unexercised.
