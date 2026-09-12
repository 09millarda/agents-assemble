# Agents Assemble

An open-source agent software factory: define how software work proceeds, run existing coding-agent harnesses on machines you control, and collaborate through your existing tools or a shared web workspace.

Users install and authenticate Codex or Claude locally, then install the Agents Assemble CLI and start its daemon. The daemon connects outward to their chosen Agents Assemble deployment and invokes those installed harnesses using their existing local accounts. Harnesses may contact their model providers directly; Agents Assemble does not supply model credentials or proxy inference.

**Status:** architecture discovery. This repository currently contains planning records, not a runnable application. The hosted service will charge per seat; self-hosting and personal-machine use will be free. The software license has not yet been selected.

The [GitHub architecture map](https://github.com/09millarda/agents-assemble/issues/1) is the single canonical index of decisions and unresolved questions.

- [Product charter](docs/product-charter.md): requirements, proposed terminology, and the two starting playbooks.
- [Domain context](CONTEXT.md): candidate ownership boundaries and architectural constraints.
- [Control plane and runner boundary](docs/architecture/0001-control-plane-and-runners.md): the first decision and its limits.
- [Playbook and action contract](docs/architecture/0002-playbook-and-action-contract.md): versioned definitions, structured execution, approval and recovery semantics; [illustrative definitions](docs/examples/playbook-contract.md).
- [Playbook conformance experiment](docs/research/playbook-conformance.md): retained grammar, evidence-backed amendments and limits from disposable mock authoring/recovery probes; production durability remains to validate.
- [Harness research](docs/research/harness-capabilities.md), [environment delivery](docs/research/environment-delivery.md), and [failure review](docs/research/runtime-failure-review.md): evidence supporting the first decision.

TypeScript, PostgreSQL, Hono, and OpenAPI are selected inputs. AWS is the first hosted deployment target. Core domain behavior must remain portable, with infrastructure and vendor integrations behind ports and adapters.
