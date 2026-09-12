# Independent bounded protocol review

This review addresses decision #10. It is not a production security audit, physical observer attestation, or a new native-supervisor experiment. The independent reviewer read ADRs 0003, 0004 and 0005 and the decision question before inspecting the authenticated fixture.

## Requirements identified before implementation inspection

1. The authenticated sender comes from the TLS peer certificate and its immutable enrolled deployment/organization/runner binding. A payload issuer, certificate subject string, request header or matching digest is not an authenticated principal. A CA-valid but unenrolled certificate must be denied.
2. Enrollment/key status, credential expiry, observer role/profile and operation scope must be checked on each request, including reused TLS connections and history queries. A revoked connection cannot bypass authorization because its handshake previously succeeded.
3. Accepted historical receipt verdicts are immutable, but replay/query requires current transport authority. An actively rotated key may query only its same authorized runner history. Neither the receipt nor the returned verdict is a transferable new-work permission.
4. Semantic inbox identity must include deployment, organization, source runner, operation and stable request identity. An exact duplicate returns its old semantic verdict; payload changes conflict. Authorization errors need not be retained as domain inbox verdicts.
5. Journal replacement cannot discard old writer obligations or let a new incarnation attest a missing old scope. Server high-water rejects observable rollback, but cannot prove that local-only records were not rolled back or that an authenticated observer is honest about a claimed sequence. Same-UID credential theft, journal modification and false scope claims remain limitations.
6. A receipt must bind the exact stopped writer and supervision activation, observer profile and limitations. Authenticated subtree emptiness is insufficient while scope coverage is incomplete or launch/repopulation can occur. Stronger evidence requires a new receipt ID.
7. Recovery independently checks every required writer including the current replacement, unknown external effects, exact verified checkpoint/input binding, current generation, recovery class, finite grant, current authorization and budget. An accepted old receipt does not settle a newer writer.
8. Authority admission and Execution receipt/state/inbox/outbox commit are separate context-owned transitions. A Fleet read before Execution commit cannot prove instantaneous revocation. A production cutover needs a request-digest-bound authorization permit and ordered Execution-local revocation gate; revocation is effective only once the relevant gate acknowledges it. An already-authorized operation may finish before that cutover.
9. Accepted receipt history and current trust in that evidence are distinct. Compromise/quarantine can disqualify evidence from a future recovery while preserving its immutable original acceptance and query history. Credential retirement during normal rotation is not by itself proof that every old observation was false.
10. Runner-side server validation and audience/input/expiry validation are separate from service-side client authentication. Successful TLS client authentication alone does not prove that a daemon validates grants or serializes launch against its stop gate.

## Evidence boundary

The final independent network evidence is recorded in `results.md` and `boundary-results.json`: 52 cases passed against the final source hash. Any modeled supervisor, checkpoint verifier, enrollment administrator or storage behavior must be described as modeled; real mTLS enforcement does not upgrade those fixture claims into physical evidence.
