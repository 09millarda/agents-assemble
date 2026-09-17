---
name: intention-revealing-code
description: Write intention-revealing code with declarative orchestration, small business predicates, and verb-first services. Use when writing or reviewing application logic, naming functions, or eliminating raw comparisons at call sites.
---

# Intention-Revealing Code

Code reads as the business story, not the mechanics. Call sites declare *what* is decided; helpers hide *how*.

## Orchestration reads declaratively

Top-level functions are a flat sequence of named steps. Prefer `if (canStreamChatToDaemon(daemon, message))` over `if (x < y)`.

## Predicates ask business questions

- Name boolean helpers `canX`, `isX`, or `hasX`: `canPollDeviceAuthorization`, `isDaemonReachable`, `hasModelRunnerAvailable`, `isCursorValid`.
- Predicates live in the domain (or shared kernel for cross-feature rules) and are unit-tested with known-good literals.
- No raw comparisons, key parsing, or string surgery at call sites. One comparison per predicate, hidden behind the name.

## Services are verbs with one job

- Name use cases `verbNoun`: `listDaemons`, `requestDeviceAuthorization`, `approveDeviceAuthorization`, `encodeCursor`.
- One file, one concept. More than one reason to change means split the module.
- Application services take ports, return domain types or `Result`. Mapping to wire shapes happens at the adapter edge only.

## Adapters name the technology

`WebSocketDaemonConnectionAdapter`, `DrizzleDaemonRegistryAdapter`, `HonoDaemonRoutesAdapter`, `HttpDeviceAuthorizationAdapter`. A reader knows the mechanism from the name alone.

## Refactor toward names

When a condition, loop, or transformation needs a comment, extract it and give it the comment's name. When two blocks look alike, the shared idea gets a named function and both call it.
