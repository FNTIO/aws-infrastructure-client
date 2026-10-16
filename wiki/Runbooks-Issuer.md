The credential issuer: rotating its signing keys and the 0.1.8 move onto CloudFront. Index: [[Runbooks]].

## Signing-key rotation (issuer)

Driven entirely from `issuer.keyVersions` / `issuer.signerVersion` in
`config/project.ts` — every listed version is published in the JWKS;
`signerVersion` signs. Order and waits are load-bearing:

1. **Introduce:** `keyVersions [1] → [1, 2]`, signer stays 1. Deploy; curl the
   JWKS and confirm two keys.
2. **Wait 10+ minutes** — STS caches the JWKS; flipping early means fresh
   tokens can hit a cached one-key JWKS and fail.
3. **Flip:** `signerVersion 1 → 2`. Deploy; vend a role end-to-end.
4. **Retire (later):** `keyVersions [1, 2] → [2]`. Deploy; JWKS back to one
   key, vend once more.

Version 1 maps to the original key's CloudFormation logical id, so adopting
versioning replaced nothing.

Since 2026-09-08 the JWKS is a static object the deploy regenerates
(`Custom::OidcIssuerDocuments`, see "Issuer on S3 + CloudFront"), served
through CloudFront with a 5-minute cache — "deploy" in the steps above means
the new JWKS is live within 5 minutes of the stack finishing, well inside
the 10-minute wait. The same cache means a *retired* key's public key can
still be served for up to 5 minutes after the retiring deploy finishes —
in a key-compromise response, count those minutes (STS caches the JWKS on
its side for a similar period anyway).

Two facts a full drill of the four phases confirms: STS honors the flip well
inside the 10-minute wait, and **retiring a version orphans its KMS key**
under `prod: true` (RETAIN) — schedule the orphan's deletion by hand
(`aws kms schedule-key-deletion`; cancelable until the waiting period ends
with `aws kms cancel-key-deletion`) after confirming nothing verifies against
it, or leave it; it costs ~$1/month.

## Issuer on S3 + CloudFront — migration from API Gateway

The issuer (`https://issuer.<zone>`) serves two files: the OIDC discovery
document and the JWKS. Until 2026-09-08 a Lambda behind an API Gateway HTTP
API served them — exactly what Security Hub APIGateway.8 (a public
`$default` route) and APIGateway.11 (an HTTP-API domain cannot carry the
enhanced TLS policies) graded. Neither file needs an API: the discovery
document is fixed, and the JWKS only changes when a signing key rotates,
which is already a deploy. So the deploy now generates both
(`Custom::OidcIssuerDocuments`, `lambdacode/issuer/publish.ts`) into a
private S3 bucket that a small CloudFront distribution serves on the same
hostname. No route, no API Gateway domain, nothing to grade — and no Lambda
in STS's path, no runtime KMS call, one service fewer.

**What does not change:** the issuer URL, the `iss` claim, the KMS signing
keys (same CloudFormation logical ids, same key policies) and therefore
every target account's trust — nothing moves on their side. Route 53 points
the same hostname at CloudFront instead of API Gateway. IAM validates the
issuer's TLS certificate against its own trusted-CA library (an
Amazon-issued cert before and after), so the OIDC providers' thumbprints
play no part either.

**What changes:** the issuer's ACM certificate moves from CredsStack (hub
region) to `WebCertStack` (us-east-1 — CloudFront's rule), so WebCertStack
exists on every deployment — **every clone now needs us-east-1
bootstrapped**, even one that runs without `web` and with WAF off — and
CredsStack depends on it. With WAF on, a third web ACL `<prefix>-issuer`
fronts the issuer distribution (CloudFront.6), **observe-only**: its managed
rules COUNT and log, never block (see "What deploys"). The issuer Lambda's
error/throttle alarms go away — nothing runs per request; the outside-in
canary stays, now follows `jwks_uri` and requires the active signing key in
the JWKS, and is the alarm that matters. Any change to the publisher's code
republishes the objects (its bundle hash is a property of the custom
resource). The retired API's and Lambda's two log groups are RETAINed by
CloudFormation — delete them by hand (below).

### Zero-downtime — how the one deploy sequences it

CloudFormation performs the migration inside a single stack update, in the
order a hand migration would use:

1. `WebCertStack` (first, as a dependency) mints the us-east-1 certificate.
   Same domain, same account → ACM reuses the validation CNAME the old cert
   already has in the zone, so validation is immediate.
2. `CredsStack` creates the bucket, runs the publisher (documents written),
   and creates the distribution — CloudFormation waits until it is deployed
   worldwide (5–10 minutes).
3. The A record keeps its logical id, so it is an **in-place** alias update
   from API Gateway to CloudFront; it depends on the documents resource, so
   DNS only flips once the files exist. An AAAA record is added.
4. Cleanup phase, last: the HTTP API, its custom domain, the API mapping,
   the issuer Lambda and the old regional certificate are deleted.

A failure anywhere before step 4 rolls back to the untouched API Gateway
path. Expect about 15 minutes.

### Before pushing it

- us-east-1 is bootstrapped (it is, on every deployment with WAF or `web`).
- Push from a clean, current tree — not on top of unrelated half-done work.
- Not during a rotation: `keyVersions` / `signerVersion` unchanged in the
  same deploy.

### Verify — before any client gets 0.1.8

From a laptop (public DNS, like STS):

```bash
H=issuer.<zone>
dig +short $H                                  # CloudFront IPs now; `dig AAAA` answers too
curl -sI https://$H/.well-known/openid-configuration | grep -iE '^(HTTP|content-type|cache-control|x-cache)'
curl -s  https://$H/.well-known/openid-configuration | jq .   # issuer == https://$H, jwks_uri under it
curl -s  https://$H/.well-known/jwks.json | jq '.keys[] | {kid, alg, use}'   # one entry per keyVersions
curl -sI https://$H/ | head -1                 # 200: the root page (CloudFront.1)
```

Then a **real vend**: sign in to the portal and get credentials for a role
(desktop app or the web dialog), or `cd frontend && npm run e2e` — its
"vend credentials from a role card" test vends against the live API. An
`aws sts get-caller-identity` with the vended credentials is the proof: STS
fetched the new JWKS to accept the token. The `IssuerHealth` alarm must stay
OK (it probes the same URL every minute).

Post-deploy checks:

- The ACM validation CNAME for the issuer host is still in the zone. ACM
  uses one CNAME per domain + account across regions, and whether
  CloudFormation removes it together with the old cert is nothing to rely
  on either way; the new cert needs it for its yearly renewal:

  ```bash
  aws acm list-certificates --region us-east-1 --query "CertificateSummaryList[?DomainName=='$H'].CertificateArn" --output text
  aws acm describe-certificate --region us-east-1 --certificate-arn <arn> --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
  dig +short CNAME <that Name>          # must answer with that Value
  ```

  If it is gone, re-create it: ACM (us-east-1) → the certificate → "Create
  records in Route 53". (ACM also emails the account contacts through AWS
  Health when a renewal fails, ~45 days before expiry.)
- The old regional certificate is gone:
  `aws acm list-certificates --region <hub region>` must not list the issuer
  host. If CloudFormation left it behind as "in use" during cleanup, delete
  it once nothing lists it: `aws acm delete-certificate --certificate-arn <arn>`.
- Delete the two orphaned log groups (CloudFormation retains log groups):
  `aws logs describe-log-groups --log-group-name-prefix CredsStack-Issuer`
  → the `…IssuerApiAccessLogs…` and `…IssuerFunctionLogs…` groups →
  `aws logs delete-log-group --log-group-name <name>` for each.
- Security Hub: the APIGateway.8/.11 findings archive themselves once their
  resources are gone (existing suppressions can stay). A new
  **CloudFront.17** finding appears for the issuer distribution — suppress
  it like the web one ("Accepted findings").

### Republish by hand

The three objects are written only by the deploy. A change to the
publisher's code republishes them on its own (its bundle hash is a property
of `Custom::OidcIssuerDocuments`); if the bucket was ever emptied by hand,
invoke the publisher directly with a Create-shaped event — the bucket name
and key ids are CredsStack resources:

```bash
aws cloudformation describe-stack-resources --stack-name CredsStack \
  --query "StackResources[?starts_with(LogicalResourceId,'IssuerBucket')||starts_with(LogicalResourceId,'IssuerSigningKey')].[LogicalResourceId,PhysicalResourceId]" --output table
aws cloudformation describe-stack-resources --stack-name CredsStack \
  --query "StackResources[?ResourceType=='AWS::Lambda::Function'&&starts_with(LogicalResourceId,'IssuerPublisher')].PhysicalResourceId" --output text
aws lambda invoke --function-name <that function> --cli-binary-format raw-in-base64-out \
  --payload '{"RequestType":"Create","ResourceProperties":{"Bucket":"<bucket>","Issuer":"https://issuer.<zone>","KeyIds":["<key id>"]}}' /dev/stdout
```

CloudFront serves the new objects within 5 minutes.

### Rollback

`git revert` the migration commit and push: CloudFormation rebuilds the HTTP
API path (new API, domain, regional certificate, Lambda) and flips the
record back in place — the same sequence in reverse, about 10 minutes.
Nothing in any target account changes either way.

### Cost

No API Gateway or Lambda charges any more; the distribution and bucket sit
inside the free tiers at issuer traffic (STS fetches are cached for 5
minutes). The WAF ACL is the existing one — no new ACL charge.
