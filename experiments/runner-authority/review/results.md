# Independent authentication review result

**52/52 final boundary cases passed; zero failed.** The review supports the bounded conditional protocol decision. It does not certify the trusted physical observer or a production enrollment/daemon implementation.

The final reviewed `fixture.py` SHA-256 is `28eced26fa319f7676ec400c00ee1e1707c423309fc3dbc8c7f49f1129cc68dd`. The hash captured before import and the file hash checked after the run match. Results are in `boundary-results.json`; run them with:

```sh
python3 review/probe_boundary.py
```

The reviewer wrote `raw_https.py` separately and sent every examined operation through its Python standard-library HTTPS client to the actual loopback mTLS server. Fixture helpers provisioned temporary credentials and controlled administrative/verifier state; the tests did not invoke the fixture's request client, receipt validator or admission validator directly. Certificate and private-key runtime files were temporary and are not part of these results.

## Repaired findings

Source inspection identified a missing selected-writer ownership check in recovery: a request whose top-level tenant matched its peer could still name a writer from another tenant. The fixture now verifies the selected writer's deployment/organization/runner before admission. Parent review also identified missing current host/boot/journal/profile checks; these now apply to the destination and remain shared across rotated credentials.

The initial parser normalized alternate wire encodings without enforcing its documented canonical-wire requirement. The fixture now rejects noncanonical whitespace/ASCII escaping/negative zero, unsupported fields and wrong typed fields, including Python's boolean/integer alias. Source fixes landed before the first independent invocation. **These are source-review discoveries followed by passing regression probes, not captured red network reproductions.** `first-regression-results.json` contains five early passing checks, overlapping the final suite; they must not be added to the final count as unique cases.

The final source additionally checks actual client-certificate validity during each request and records immutable acceptance time/authority metadata. An independent genuinely short-lived certificate test confirmed expiry rejection on the same established TLS socket.

## Final boundary coverage

- TLS rejects missing, untrusted and expired client certificates and an untrusted server CA. A trusted-CA but unenrolled leaf, substituted principal headers, wrong tenant and missing observer role are denied by the application.
- Fifteen raw malformed/canonical/type cases fail without changing Execution state, inbox or outbox. Valid receipt acceptance, exact replay and changed-payload conflict have the expected distinct outcomes.
- Revocation applies to a reused TLS connection; actual certificate expiry and application authority expiry block history/replay. An active rotated key can replay the original logical issuer's receipt and query its immutable history. Runner retirement also denies the rotated key.
- Rotation cannot bypass shared journal high-water or changed host, boot, journal or profile. Historical replay remains a query of an old fact rather than a fresh continuity claim.
- Cross-tenant recovery is denied. Unknown effects and quarantined evidence independently block recovery while historical verdicts remain queryable. Semantic rejection remains immutable after state changes. A fresh eligible admission charges once; replay cannot clear a live replacement, including a replacement with its own valid grant.
- The deliberate revocation race demonstrates the stated limit: an operation authorized before Fleet mutation can still commit, while the next operation is denied. This is an observed limitation, not a passed claim of instantaneous revocation.

## Remaining limits

Fleet snapshot authorization and Execution's local SQLite acceptance transaction are separate. No ordered Execution-local revocation gate or digest-bound authorization permit is implemented here. SQLite behavior is not a new validation of the PostgreSQL/transport/harness composition required by ADR 0003.

The observer, stopped-scope artifact and checkpoint verifier are controlled inputs. Authentication cannot establish truthful observation, complete physical writer scope, unobserved journal continuity, or provider-effect cancellation. Same-UID credential/journal compromise remains outside eligible automatic takeover. The separately tested grant parser checks fetched digest and bounded binding/schema, but its current interface does not compare a caller-supplied expected logical observer; this is not proof of the full native prelaunch contract. These limits remain explicit conditions of acceptance.
