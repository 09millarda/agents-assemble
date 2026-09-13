# Bounded local-controller live fixture, decision 15

The owner instructed us to execute the local-controller path using the existing AWS CLI login. This recreates the previously approved small Lambda fixture under a fresh prefix, using the prior $1 planning allowance and cleanup within 24 hours as bounds. No EC2/RDS/NAT/load balancer or persistent gateway hosting is provisioned.

- Account728616601473 (Proof of Concept), eu-west-1; prefix `aa-wf15l`.
- One private versioned AES256 S3 bucket `aa-wf15l-728616601473-eu-west-1-artifacts`; three retained known ZIPs, about 212KB total.
- Two CloudFormation stacks `aa-wf15l-staging` and `aa-wf15l-prod`, each containing seven resources: Lambda128MB/3second Node22 function, published version, live alias, HTTP API, default stage throttled1rps/burst2, invocation permission and one-day log group. No database/customer data in target apps.
- Two Lambda runtime roles and two independently scoped CloudFormation service roles. Bootstrap grants narrow to the actual API/function resources after creation; cleanup temporarily grants only required deletion access.
- One `aa-wf15l-controller` role, assumed only by the existing AccountFullAccessRole principal, with finite trust/mutation window and exact stack/function/artifact permissions. No GitHub AWS deployment role or direct deployment trust is created.
- Local PostgreSQL in a loopback-only disposable Docker container, separate owner roles/processes; local controller keeps its STS credentials in process memory. Preserve DB state/evidence while any operation is unresolved.
- Temporary Cloudflare Quick Tunnel to a loopback-only gateway; every claim/status request requires actual GitHub OIDC plus stored effect/run binding. No shell, filesystem, database or general AWS interface is exposed. Stop tunnel after jobs finish.
- At most the baseline creates plus staging/production promotion and two bad-health/restoration pairs, with identity-bound rejection probes and controlled post-request controller kills. Mutations keep the same stable logical effect and original CloudFormation change set on recovery.
- Existing artifact/template/runtime cost evidence remains the basis for this tiny target scope; $1 is a conservative planning allowance, not an AWS-enforced cap or observed bill. Cloudflare Quick Tunnel/public GitHub runners add no paid hosting selection.

Preparation is create-only and refuses existing named resources before writes. Receipts persist resource names/IDs, object versions and role inventory. `cleanup.py` revokes the local controller, deletes receipted stacks and artifact versions/bucket, then five roles. Verify absence independently and retain all fault/intervention evidence. Do not alter the older identity-only role/provider or retired workflows.
