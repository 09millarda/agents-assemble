# Hexagonal ports & adapters, feature-based layout, SOLID with expressive names

All business logic follows hexagonal layering (`domain <- application <- adapters <- infrastructure`) inside `features/<feature>/` directories, with single-responsibility modules and business-readable predicates (e.g. `canEstablishDaemonConnection()` instead of raw comparisons).

## Consequences

- Domain stays pure and unit-testable without Docker/network/LLM; I/O lives in adapters behind small focused ports.
- New integrations (new harness transport, new persistence adapter) mean new adapters, not domain rewrites.
