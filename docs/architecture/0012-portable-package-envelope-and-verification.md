# ADR 0012: portable package envelope and offline verification

Date: 2026-09-12
Status: **Accepted bounded envelope contract, supported by a disposable parser/catalog experiment. Production semantic validation and integrated admission remain unproved.**
Decision: [#17](https://github.com/09millarda/agents-assemble/issues/17) · Map: [#1](https://github.com/09millarda/agents-assemble/issues/1)
Prerequisites: [ADR 0010](0010-portable-community-publication.md), [ADR 0011](0011-open-source-licensing-and-edition-parity.md), [ADR 0002](0002-playbook-and-action-contract.md)

## Decision

Select a strict, versioned ZIP_STORED envelope containing canonical metadata and exact content-addressed blobs. Import verifies the entire pinned closure without extracting author paths, contacting an origin, resolving secrets or executing package code. Register content atomically in Catalog. Preserve immutable component identity separately from accumulating publisher evidence; evaluate that evidence against current local trust. Import supplies neither runtime bindings nor execution grants.

The selected envelope is `aa-package/1`. The experiment's embedded `aa-probe/1` definition/schema vocabulary is deliberately reduced and is **not** the production playbook wire schema. Production admission requires a supported, versioned semantic validator for every behavioral component under ADRs 0002/0007/0008. A verified archive cannot substitute for that validator. Unknown behavioral formats, schema keywords or unresolved references fail closed; passive storage, if offered, must remain visibly ineligible for execution.

## Bytes and identities

The only archive members are `manifest.json` and `blobs/<lowercase SHA-256>`. A logical file inventory belongs to each component; it does not control extraction destinations. Multiple components may reference one identical blob. Reject extra/unlisted blobs, missing blobs, duplicate member names, size/hash mismatches, duplicate logical paths and extraneous/unreachable components.

| Identity | Selected binding |
| --- | --- |
| Blob digest | SHA-256 of exact file bytes, including whitespace. |
| Component digest | SHA-256 of canonical descriptor bytes: origin, author version, kind/schema, entrypoint, file inventory, exact dependency digests, runtime slots, permission requirements, terms/notices, approved provenance and changelog. |
| Immutable identity | Issuing installation, organization/export origin, package and version label bind one component digest. Check every component, including transitive dependencies, against both the incoming closure and local Catalog. |
| Closure digest | SHA-256 of canonical `{root, components}` containing the root digest and sorted complete component-digest list. Each descriptor transitively pins its dependencies. |
| Transport digest | SHA-256 of the entire received archive. Archive order/timestamps and separately retained attestations may change this without changing component or closure identity. |

“Semantic identity” here means this normalized metadata and exact-content contract, not equivalence of arbitrary executable behavior. Whitespace changes in an opaque definition or instruction blob change its identity. Reformatting such a file requires a new reviewed candidate. Two organizations may share a blob digest without sharing publisher authority or redistribution rights; the origin-bearing descriptors are distinct.

Canonical metadata uses the [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785#section-3.2) serialization rules within a narrower domain: ASCII object keys, valid Unicode string values without normalization, and integer numbers in ±(2^53−1). Arrays preserve order; inventories and digest sets use their explicitly sorted order. Reject duplicate keys, floats, nonfinite values, lone surrogates and noncanonical incoming manifest bytes. Exact decimal or other unsupported metadata types require a declared future schema, rather than silent coercion. This restriction applies to envelope metadata; opaque resources keep their exact bytes and behavioral documents need their own supported validator.

## Bounded archive reader

Choose method-zero ZIP regular files with matching local/central metadata and CRC, contiguous non-overlapping byte extents, and a final directory/end record consistent with all observed entries. Reject encryption, compression, ZIP64, descriptors, extras, comments, split archives, unsupported flags/versions/attributes, directories/links/devices, prefixed/trailing bytes, gaps and contradictory local/central names, CRCs or lengths. CRC detects ordinary corruption; required SHA-256 checks establish content-address consistency. The [source comparison](../research/portable-package-sources.md) traces these mechanisms to PKWARE and Python documentation.

The initial profile deliberately trades compression and broad ZIP compatibility for a small, bounded reader. It does not accept arbitrary archives produced by every ZIP tool. Supported writers must emit this profile.

| Limit | Initial acceptance profile |
| --- | --- |
| Transport and total stored payload | 4 MiB |
| Archive entries | 64, including the manifest |
| Individual stored member | 512 KiB |
| Manifest | 256 KiB |
| Components | 32 |
| Files per component | 32 |
| Metadata JSON | Depth 32; 20,000 nodes; 65,536 UTF-8 bytes per string |
| Paths | Fixed archive names; lowercase ASCII logical segments, maximum 160 characters, no absolute/parent/backslash paths |
| Portable proofs | At most one selected proof per component on export; at most 32 accepted proofs per envelope |

These are conservative product limits exercised by boundary/rejection probes, not workload-derived capacities. Bound ingress before loading, validate nesting before recursive JSON decode, then validate structural budgets before traversing the graph. The finite component set bounds acyclic dependency depth; exact dependency sets prohibit repeated edges. Larger packages require an explicit compatibility/profile decision. Cumulative local storage/evidence quotas and production request isolation remain operational requirements beyond a single-envelope limit.

## Publisher evidence and trust

Optional Ed25519 proofs sign `agents-assemble/package-component/v1` followed by NUL and the 32-byte component digest. The digest binds origin/version and the transitive dependency pins. Proofs carry a local key identifier and canonical padded base64 signature. A local trust record, provisioned independently of the package, supplies the public key and allowed issuing installation/organization scope. This applies [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032#section-5.1.7) verification; it is not a key-distribution or federation protocol.

- Unsigned or unknown-key components remain explicitly unverified when local import policy permits them. An envelope cannot install its own trusted key or invent an execution grant.
- A recognized key outside its allowed scope or an invalid recognized signature rejects that incoming envelope. Noncanonical base64 also rejects: equivalent decoded bytes must not create distinct evidence identities through padding aliases.
- Verify each component independently. A verified root publisher's dependency selection does not authenticate those dependencies' publishers.
- Accumulate accepted evidence separately from immutable content. Signed replay can enrich a previous unsigned import; unsigned replay cannot erase evidence. A formerly unknown invalid claim cannot prevent a later valid proof from establishing locally verified attribution.
- Re-export selects one proof per component, preferring a currently verified, scoped key and using deterministic key ordering. It retains original evidence locally, omits invalid known-key evidence and ambiguous unknown-key claims, and never grows beyond the receiving proof budget. An export is not an exhaustive audit-history export.
- Recompute attribution against current local policy. A stored successful import does not imply current upstream revocation/freshness. Offline verification establishes only the configured local key binding. Show absent/stale advisory knowledge separately.

Origin conflict is checked independently of signature status. A URL, export alias or newly presented signature cannot overwrite different content at an existing immutable identity. A disputed/unverified collision needs explicit local review; importing it never silently replaces trusted content. Governing real issuer onboarding, rotation, revocation, namespace disputes and historical evidence retention remains to specify.

## Public candidates and private provenance

Catalog owns the stable mapping from private package identity to approved public or opaque export origin. Repeated exports reuse it. Importers cannot determine whether syntactically valid foreign identifiers or arbitrary prose are private; reject unsupported fields, but do not advertise a confidentiality classifier.

Construct a public candidate from selected files/fields throughout the closure. Keep the source mapping and unapproved private provenance in authorized local records. Replacing content or origins requires rebuilding component digests, dependency pins, definition references and the closure digest, then semantic validation and exact candidate approval. Preserve notices and declared capabilities without carrying runtime/environment bindings, secret-provider paths, concrete connections, transcripts or project artifacts.

An ancestry mapping must resolve the **complete approved origin/version/digest tuple**. Replacing only an ancestor's origin while retaining its private digest can name a nonexistent public version, because the descriptor digest includes origin. If no exact approved public mapping exists, pause candidate creation for explicit selection/redaction. Retain the original ancestry privately. The experiment demonstrates a supplied stable mapping and nonempty ancestry transformation; it does not prove a durable production origin allocator or arbitrary confidential-text detection.

Approval binds the exact candidate/closure, destination namespace and intended version under ADR 0010. It is separate from import integrity and signing. Another export of changed bytes cannot reset the source's immutable version identity or reuse the old approval.

## Local import and advisory boundaries

1. Read bounded bytes into nonpublic staging and verify the archive, exact inventory, supported schemas, closure and local trust/permission policy. No network fallback resolves a missing dependency.
2. In one Catalog-owned acceptance transaction, check all immutable identities and register the complete content, imported root and evidence. Rejection or precommit interruption leaves no partial visible version; postcommit uncertainty reconciles by exact root/operation identity.
3. Production object storage must make verified immutable blobs durably available before publishing references; orphan staging can be collected separately. Context-local outbox acceptance still follows ADR 0003. No cross-context transaction is introduced.
4. Preserve component origins/digests for dependency-level advisory matching. Signature verification does not create an advisory authority. Catalog/Execution quarantine propagation, independent holds and effective cutoffs remain ADR 0010's separate policy protocol.
5. Require local runtime/environment binding, capability review and admission grants before execution. Import never invokes hooks, renders active resources, retrieves author URLs or starts a harness.

Every component carries its terms, notice paths and a redistribution-permission record. The prototype uses synthetic allowed/denied/missing records and an Apache-2.0 allowlist; this is not the full ADR 0011 public license policy. Actual permissions, OSI eligibility/resource terms and license compatibility require separate review. This decision adds no LICENSE file and grants no third-party rights.

## Alternatives and evidence limits

Strict tar is viable but offers no decisive benefit here and needs similarly bounded path/link/duplicate handling. JSON/base64 simplifies container syntax while increasing binary size and decoding allocations. General ZIP compression adds expansion and parser complexity; it can be a later measured profile. Hosted signature/registry lookup on every import would defeat disconnected use. Embedded self-signed keys cannot establish issuer authority. See the [primary-source comparison](../research/portable-package-sources.md).

The [conformance report](../research/portable-package-conformance.md) records actual archive/cryptographic checks, two SQLite Catalogs, process termination/restart and independent adversarial repairs. SQLite proves the reduced transaction fixture only; ADR 0003 still selects PostgreSQL. Complete production definition semantics, opaque-origin persistence, durable distributed blob publication, authenticated publisher authorization, key governance, full legal permission policy, moderation/admission composition and release qualification remain unproved. This resolves #17 only; #11 and #15 remain independent frontier decisions.
