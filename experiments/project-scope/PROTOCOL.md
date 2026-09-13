# Throwaway protocol

The controller is an experiment fixture, not a service implementation.

- `projects`, `execution`, and `integrations` have independently owned tables
  and inbox/outbox rows. The worker for one context writes only its own schema.
- The controller is the privileged fixture setup and transport relay. It reads
  a producer outbox and invokes a consumer worker, then acknowledges delivery
  using a separate connection.
- A worker can be killed before commit or immediately after commit. The latter
  deliberately leaves the producer outbox unacknowledged so redelivery tests
  the consumer inbox.
- Every message has a stable ID. An exact duplicate returns its stored outcome;
  a changed payload returns a conflict.
- Provider, harness, authorization, and cryptographic receipt behavior is
  represented only by explicit fixture payloads. No such fixture is presented
  as production evidence.

The database is local and disposable. Do not point `PGDATABASE` at an existing
application database.

