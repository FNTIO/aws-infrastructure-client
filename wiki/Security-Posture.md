The portal's trust rests on one fixed string: the OIDC issuer host. Every workload account's IAM OIDC provider and every target role's trust policy name that host, so it is decided once, before the first deploy, and never re-derived or changed; the deployment README's worked example is `issuer.portal.example.com`. Around that core the package ships AWS WAF, Security Hub FSBP compliance by construction, logging with redaction, and a `prod` knob for deletion and termination protection. This page summarizes the posture and links to the runbooks for key rotation, the issuer migration and restore.

## Trust model

Identity is proven cryptographically. The API mints a KMS-signed web-identity JWT and calls `AssumeRoleWithWebIdentity`; the target role trusts the issuer URL, never the hub account directly, and the hub's API role holds no `sts:AssumeRole`. The issuer URL derives from `issuer.domainName` in the project config and there is deliberately no override knob, so trust cannot drift from it; because the host no longer changes when `CredsStack` is rebuilt, target-account stacks only need redeploying when roles or accounts change. Each trust policy pins both the audience and a role-scoped subject (`<account>/<role>/*`), so a leaked token works against exactly one role in one account; [[Access Model]] covers the rollout order. Target roles carry a `MaxSessionDuration` of 12 hours, and the per-role session length an admin sets in the app is the effective limit.

Since 2026-09-08 the issuer is static: the deploy writes the discovery document and JWKS into a private S3 bucket that a CloudFront distribution serves on the stable host, so nothing runs when STS fetches them. A once-a-minute canary fetches the discovery document the way STS does and follows `jwks_uri`; any failure that would break vending throws and alarms to the ops topic.

Sign-in tokens live in the browser's localStorage. The app pages send an enforced Content-Security-Policy that allows the app itself, the region's Cognito API and the hosted-UI domain and nothing else, so an injected script has nowhere to send them. **Plugins are trusted code**: a plugin page is a same-origin iframe and runs with the signed-in user's full authority; its assets are served under an enforced policy that lets the page load from and talk to the portal only. Install plugins as you would ship portal code (see [[Runbooks-Plugins]]). A deleted or demoted admin loses admin routes at once: their sessions are ended and admin routes re-check the directory once a minute per API container, so an already-issued token cannot be used for the rest of its hour.

Runbooks: [Cross-account: trust a second account](Access-Model#cross-account-trust-a-second-account) and [Sub-pinning](Access-Model#sub-pinning--role-scoped-trust).

## What ships on by default

**WAF.** Three WAFv2 web ACLs from the `WebAcl` construct, on unless `waf: { enabled: false }`:

| Web ACL | Stack, region | Protects |
| --- | --- | --- |
| `<prefix>-web` | `WebCertStack`, us-east-1 | The app's CloudFront distribution: pages and `/api/*` |
| `<prefix>-api` | `CredsStack`, hub region | The vending API's REST stage, so direct execute-api hits are inspected too |
| `<prefix>-issuer` | `WebCertStack`, us-east-1 | The issuer distribution. Observe-only: every rule in COUNT, because STS is its only client and a false positive would fail every vend with no alarm |

Rules: a per-IP limit on `/api/*` (web ACL only, `waf.rateLimit`, default 5000 per 5 minutes, sized for an office NAT); a per-token limit keyed on the `authorization` header (API ACL only, `waf.perTokenRateLimit`, default 2000 per 5 minutes, a ceiling per token rather than a user quota); and the AWS managed `AmazonIpReputationList`, `KnownBadInputsRuleSet` and `CommonRuleSet`, with five Common body and user-agent rules in COUNT because real traffic (data-URI logos, bulk imports, service-user clients) trips them. Blocked and counted requests log to `aws-waf-logs-<prefix>-*` with 3-month retention and the `authorization` and `cookie` headers redacted; sampling is off. About $26 per month per deployment. The API stage also throttles at 25 rps with a burst of 50.

**By construction, any config.** ERROR-level execution logs and X-Ray on the API stage; both CloudFront distributions HTTPS-only with the `TLSv1.2_2021` viewer policy and Origin Access Control on their buckets; a pinned Cognito password policy and an explicit `mfa` choice (a password-only pool fails at synth until it picks one); on-demand DynamoDB; the VPN VPC with its default security group stripped, REJECT-only flow logs and only 443 open; Fargate tasks non-privileged, without credential env vars, with logs on every container; encrypted EFS with per-site access points; the Headscale ALB with a single TLS 1.3 listener; key-scoped `kms:Sign`; Node 22 Lambdas; SSL-only buckets and topics; 3-month log retention on every Lambda the package writes (the framework functions CDK adds for the `Custom::FirstAdmin` and `Custom::HeadscaleApiKey` providers keep CloudWatch's never-expire default).

**With `prod: true`.** Termination protection on every hub stack, PITR, deletion protection on the tables, the user pool and the ALB, EFS automatic backups, Container Insights on the control-plane cluster. A sandbox fails these on purpose.

**Opt-in.** `loginMethods.threatProtection: true` (Cognito PLUS plan, per-MAU cost) and `containerInsights: true` on a connector.

**Desktop.** The Electron shell only loads `https://` backends and confines in-view navigation to the backend's origin plus Cognito; anything else opens externally.

Full lists: [What deploys (default on)](Security-Posture#what-deploys-default-on) and [FSBP coverage](Security-Posture#fsbp-coverage), both under [Security posture](Security-Posture#security-posture--waf--security-hub-cspm). Consumer summary: [Security Hub](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#security-hub).

## Accepted findings

These FSBP controls fail as shipped and are suppressed once per hub account and region (workflow status Suppressed, with the reason as the note). The deploy cannot do it: automation rules and control changes are administrator-only, and a client's hub account is usually a member under a delegated Security Hub administrator.

| Control | Resource | Why it cannot pass |
| --- | --- | --- |
| CloudFront.17 | web and issuer distributions | Signed URLs or cookies would lock users out of the login page and STS out of the JWKS |
| APIGateway.2 | the `creds-api` stage | Backend client certificates exist for HTTP backends; the only integration is a Lambda proxy, and a stage certificate expires yearly with no rotation |
| CloudFront.4 | web and issuer distributions | Origin failover needs two origins; each has one bucket |
| EC2.21 | the VPN VPC's default NACL | A replacement NACL leaves the default one unassociated and fails EC2.16 instead; nothing listens on 22 or 3389 |
| SecretsManager.1, .4 | `<prefix>/headscale-apikey-<site>` | No rotation Lambda; rotation is a manual stamped redeploy |
| KMS.3 | a retired issuer signing key | Fires only during the 7 to 30 days a rotated-out key waits for deletion |

Cost knobs not built (the six VPC interface endpoints behind EC2.10, .55, .56, .57, .58 and .60, ECS.2) also fail as shipped and are suppressed as "cost knob". Account-level controls (Config, CloudTrail, GuardDuty, the IAM password policy and similar) belong to the client's own baseline. APIGateway.8 and .11 disappeared with the issuer migration. Procedure and CLI: [Accepted findings](Security-Posture#accepted-findings-cannot-pass-inside-this-product).

## Signing-key rotation

Rotation is driven from `issuer.keyVersions` and `issuer.signerVersion` in the project config: every listed version is published in the JWKS and `signerVersion` signs. Four deploys, in order: introduce the new version; wait at least 10 minutes for STS's JWKS cache; flip the signer and vend end to end; retire the old version later. The JWKS is regenerated by the deploy and served through CloudFront with a 5-minute cache, which also means a retired public key can still be served for up to 5 minutes. Under `prod: true` a retired version orphans its KMS key; schedule its deletion by hand. Runbook: [Signing-key rotation](Runbooks-Issuer#signing-key-rotation-issuer).

## Issuer on S3 and CloudFront

The 2026-09-08 migration (package 0.1.8) replaced the issuer's Lambda and API Gateway HTTP API with static objects behind CloudFront. Unchanged: the issuer URL, the `iss` claim, the KMS keys and therefore every target account's trust. Changed: the issuer certificate moved to `WebCertStack` in us-east-1, so every deployment now bootstraps that region, and the retired API's two log groups are deleted by hand. CloudFormation sequences the move inside one stack update (certificate, bucket and documents, distribution, in-place DNS flip, cleanup) and rolls back to the old path on any failure before cleanup. Verify afterwards with a real vend. Runbook: [Issuer on S3 + CloudFront](Runbooks-Issuer#issuer-on-s3--cloudfront--migration-from-api-gateway), with [Zero-downtime](Runbooks-Issuer#zero-downtime--how-the-one-deploy-sequences-it), [Verify](Runbooks-Issuer#verify--before-any-client-gets-018) and [Rollback](Runbooks-Issuer#rollback).

## Backup and restore

`prod: true` keeps point-in-time recovery on every table, but DynamoDB restores only to a new table, never in place, so a real recovery is a copy-back: restore to a side table (any point in the last 35 days), verify counts and rows, copy the lost items into the live table, delete the side table. The restored copy comes back with TTL and PITR disabled and without tags or alarms, so never promote it to be the live table; the stack owns the original name that every by-name contract uses. Runbook: [Restore from backup (PITR)](Runbooks-Operations#restore-from-backup-pitr).

## Federated sign-in (SSO)

With `loginMethods.federation` set, the pool trusts the customer's OIDC issuer for the listed providers; the client secret lives in Secrets Manager and reaches the pool only as a CloudFormation dynamic reference, never the repo or the template. The providers sit on a dedicated app client that allows only the code flow and token refresh, and that client alone may write the mapped claims — Cognito's self-service API on a local session cannot, so the customer's identifier on a user is always the provider's word. Nobody signs in without an invite: a federated identity is linked to the invited user with that email, and an unknown email is refused by the pre-sign-up trigger, so a corporate login can never create a grant-less stray user. Access ends with the corporate account — a disabled account cannot obtain a new token, and the existing session runs out at the refresh token's 12-hour wall. Multi-factor authentication for federated users is the provider's job (conditional access); the pool's `mfa` setting keeps applying to local sign-ins only, which is what Security Hub Cognito.5 evaluates. The mapped claims are permanent pool attributes (Cognito cannot rename or remove them) and ride the portal's own ID token, so audit rows and the admin directory read in the customer's identifiers. One trust assumption is the provider's: a federated identity is matched to an invited user by the email the provider asserts, so the provider must only ever assert addresses it owns — a guest account in the tenant asserts its own external address, never an employee's. That is the same assumption every SSO integration makes, and it is why the pool trusts one tenant-specific issuer, never a multi-tenant one. Runbook: [Federated sign-in (SSO)](Runbooks-Users#federated-sign-in-sso).

## Hardening checklist

The product owner's production-readiness checklist, which a deployment walks before handover, covers Cognito user pool deletion protection (under `prod`), a VPN lifecycle that needs no hands, WAF on CloudFront and the API, a full security review over the whole diff before handover (still open), rate limiting on the vend API, and the desktop shell loading only trusted HTTPS domains; it also notes two open decisions, an MFA policy for password users and threat protection. Related: [[Runbooks]] and [[Deploy and Upgrade]].

## Security posture — WAF + Security Hub CSPM

Written after the first client deployment ran AWS Security Hub CSPM
(Foundational Security Best Practices) against a stock deployment, then
widened on 2026-09-08 to the whole FSBP control set. The package passes every
applicable control it can by construction; the rest are cost knobs, by-design
exceptions to suppress per deployment (steps below), or account-level
controls that belong to the client's own baseline — all listed under
"FSBP coverage" at the end of this section.

### What deploys (default on)

Three WAFv2 web ACLs, built by the `WebAcl` construct
(`packages/infra-client/lib/constructs/web-acl.ts`):

| Web ACL | Stack / region | Protects | Security Hub control |
| --- | --- | --- | --- |
| `<prefix>-web` | `WebCertStack`, **us-east-1** (the only region WAF accepts for CloudFront) | the app's CloudFront distribution — pages and `/api/*` | CloudFront.6 |
| `<prefix>-api` | `CredsStack`, hub region | the vending API's REST stage, so direct execute-api hits are inspected too | APIGateway.4 |
| `<prefix>-issuer` | `WebCertStack`, **us-east-1** | the issuer's CloudFront distribution (discovery document + JWKS). **Observe-only**: the same managed rule groups, every one in COUNT — it logs what it would have blocked and never blocks, because AWS STS is the issuer's only client and a false positive there fails every vend in every target account with no alarm (the canary is not STS). No rate rule. Its own log group, `aws-waf-logs-<prefix>-issuer`. | CloudFront.6 |

Rules, in order:

1. **Per-IP rate limit — web ACL only.** `waf.rateLimit` requests to
   `/api/*` per source IP per 5 minutes (default 5000), answered with HTTP
   429 + `Retry-After: 60`. Static assets don't count. One office NAT is one
   IP, so the default is sized for an office, not a person (a 100-seat
   morning login is roughly 1300 API calls). The API ACL has no per-IP rule
   on purpose: behind CloudFront the only per-viewer IP WAF offers there is
   the client-writable `X-Forwarded-For`, which an attacker can rotate to
   bypass or set to a victim's IP to lock an office out; direct execute-api
   hits stay bounded by the stage throttle (25 rps / 50 burst).
2. **Per-token rate limit — API ACL only.** `waf.perTokenRateLimit` API
   requests per bearer token per 5 minutes (default 2000), same 429 answer.
   The aggregation key is the `authorization` header value, i.e. the Cognito
   token: nobody can land in another caller's bucket (tokens are signed),
   and a request with no `authorization` header is not evaluated by this
   rule at all (WAF skips a request that lacks a key component). It lives on
   the API stage only — every `/api/*` call from CloudFront lands there
   anyway, direct execute-api callers (service users) are seen only there,
   and a CloudFront copy would be a second counter that can disagree with
   the first. Every request on the stage is an API call (the path starts
   with the stage name), so there is no path scope-down. Read the name
   literally: a ceiling per **token**, not a per-user quota — a browser
   session keeps one ID token for up to an hour and each refresh starts a
   new bucket; a service user can mint a fresh client-credentials token at
   any time and start over. What it buys: a leaked or runaway token cannot
   hammer the API unbounded (at the 25 rps stage throttle, 2000 calls is
   80 s of saturation per 5 minutes, then nothing) and one token cannot
   starve everyone else for the rest of the window. It is **not** flood
   protection — junk tokens each get their own bucket and die with a 401 at
   the API, which is what the per-IP rule and the stage throttle are for.
   Sizing: the default sits above every burst the product itself makes on
   one token — a bulk UI action over a few hundred rows, an import-CLI run
   (one call per promote/group; its 429 backoff cannot outlast a WAF block,
   which holds until the trailing five-minute count drops under the limit),
   a Playwright run (300–500 calls in 30 s) — while a person's real rate is
   a few calls a minute. Rate rules react within roughly 30 seconds.
3. AWS managed `AmazonIpReputationList`, `KnownBadInputsRuleSet` and
   `CommonRuleSet`. Five Common rules run in COUNT (logged, never blocked)
   because real traffic trips them — the four body rules
   (`SizeRestrictions_BODY`: 8 KB, but data-URI logos go to 64 KB and
   bulk-import batches are bigger; `GenericRFI_BODY`: any `https://` in
   free text or `branding.logoUrl`; `GenericLFI_BODY` and
   `CrossSiteScripting_BODY`: SVG markup in a logo, HTML or `../` in a
   description) and `NoUserAgent_HEADER` (service-user clients such as .NET
   `HttpClient` send none). Every body is still shape-validated by the API
   and capped at 100 KB by `express.json`; the URL, query-string, cookie and
   header rules block as shipped. The list is `COMMON_RULES_COUNT_ONLY` in
   `web-acl.ts` — widen it only with a recorded reason.

Blocked and counted requests log to `aws-waf-logs-<prefix>-web` (us-east-1)
/ `-api` (hub region), 3-month retention, `authorization` and `cookie`
headers redacted; allowed traffic isn't logged and WAF request sampling is
off (samples are stored unredacted). That satisfies Security Hub WAF.11;
WAF.10 and WAF.12 pass by construction. Each rate rule also publishes a
CloudWatch metric under its name (`RateLimit`, `TokenRateLimit`) in the
`AWS/WAFV2` namespace, so a blocked-count graph per rule is one click.

**Cost:** 3 ACLs × $5 + 11 rules × $1 = about **$26/month** per deployment,
plus $0.60 per million requests per ACL (an `/api/*` call passes both, so
about $1.20/M there). Logs are negligible at portal traffic.

**Config** (`ProjectConfig.waf`, optional — omit for the defaults):

```ts
waf: { enabled: true, rateLimit: 5000, perTokenRateLimit: 2000 },
```

FNTIO's own dev deployment sets `perTokenRateLimit: 3000`: the Playwright
suite (frontend/e2e) replays one login for 300–500 API calls per run, and a
debugging session runs it several times inside five minutes. A clone
without such a client keeps the default.

**Triage.** A user gets a 403 the app can't explain → read the
`aws-waf-logs-*` group for that path (`-web` in us-east-1 first — CloudFront
inspects before the origin); the log line names the rule. A 429 with
`Retry-After` is a rate rule, and the log line names which: `RateLimit` —
raise `waf.rateLimit` if a shared IP is legitimately over it;
`TokenRateLimit` — one token made more than `waf.perTokenRateLimit` calls
in 5 minutes: a script or runaway client, or a legitimately large import —
for the import, raise the limit and put it back after (it is global, not
per client). A person does not get there.

**Consequences for a clone.** `WebCertStack` exists on every deployment (it
also holds the issuer's certificate), so **us-east-1 must be bootstrapped**
("Install, test, deploy"); the CI preflight fails in seconds with the exact
command if it isn't. Existing deployments pick the ACLs up on their next
push — in-place updates, nothing replaced.

**Turning WAF off later** (`waf: { enabled: false }`): the push detaches
both distributions and deletes the API ACL, but the two CloudFront ACLs are
*retained*, not deleted — CloudFormation would otherwise try to delete them
while the distributions still reference them (WebCertStack deploys first)
and fail the whole update. After the push, delete the orphans by hand in
us-east-1:

```bash
aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1   # Id + LockToken of <prefix>-web and <prefix>-issuer
aws wafv2 delete-web-acl --scope CLOUDFRONT --region us-east-1 --name <prefix>-web --id <Id> --lock-token <LockToken>
aws wafv2 delete-web-acl --scope CLOUDFRONT --region us-east-1 --name <prefix>-issuer --id <Id> --lock-token <LockToken>
```

`WebCertStack` itself stays — the issuer's certificate lives there. Same
`delete-web-acl` at "Tear down".

### Accepted findings (cannot pass inside this product)

| Control | Resource | Why it cannot pass |
| --- | --- | --- |
| CloudFront.17 — CloudFront distributions should use trusted key groups for signed URLs and cookies | the web and issuer distributions (one finding each) | Fails for every distribution that does not serve private content through signed URLs/cookies. The portal is a public sign-in page plus a JWT-authenticated API, and the issuer is a public OIDC discovery document + JWKS that AWS STS must fetch unauthenticated; signed cookies would lock users out of the login page and STS out of the JWKS. |

_APIGateway.8 and APIGateway.11 (the issuer's HTTP API route and custom
domain) were on this list until 2026-09-08. The issuer is static S3 +
CloudFront now and neither resource exists — see "Issuer on S3 +
CloudFront". Existing suppressions can stay; the findings archive themselves
once the resources are gone._

Suppress them per hub account + region, by hand. The deploy can't: Security
Hub automation rules and control changes are administrator-only, and a
client's hub account is usually a *member* under a delegated Security Hub
administrator (the first client deployment is — deploy-side automation rules
were tried and reverted on 2026-09-08). The finding's workflow status is the
one path that works in every account:

1. Security Hub → **Findings** → filter `Compliance security control ID` =
   the control id (CloudFront.17, in us-east-1 — one finding per
   distribution) → open our resource's finding → Actions →
   Workflow status → **Suppressed**, note = the reason above. Security Hub
   keeps that status across re-evaluations; only a replaced resource (a new
   finding) needs it again. Same from a shell:

   ```bash
   aws securityhub get-findings --region <region> \
     --filters '{"ComplianceSecurityControlId":[{"Value":"CloudFront.17","Comparison":"EQUALS"}],"RecordState":[{"Value":"ACTIVE","Comparison":"EQUALS"}]}' \
     --query 'Findings[?Compliance.Status==`FAILED`].[Id,ProductArn]' --output text
   aws securityhub batch-update-findings --region <region> \
     --finding-identifiers Id=<Id>,ProductArn=<ProductArn> \
     --workflow Status=SUPPRESSED --note Text="<reason>",UpdatedBy=infra-client
   ```

A standalone or Security Hub administrator account can do it once for good
instead:

2. **Controls** → the control → **Disable control** (top right) when nothing
   else in the account needs it (a dedicated hub account), reason = the row
   above. It stops generating findings for the whole account.
3. Other resources DO need it: **Automations** → **Create rule** → criteria
   `Compliance security control ID` = the control id AND `Resource ID`
   contains the distribution id →
   automated action **Set workflow status → Suppressed**, note = the reason →
   **Create rule**. Rules apply to new and updated findings, so the existing
   FAILED one flips on its next evaluation (within 24 h).

### FSBP coverage

Checked against the FSBP control list as published on 2026-09-08 (Security
Hub adds controls a few times a year — re-check the list when a client
reports a new finding). Test: `lib/__tests__/security-hub-fsbp.test.ts`
locks the by-construction rows down.

**Passes by construction, any config:**

| Control(s) | How |
| --- | --- |
| APIGateway.1, .3 | `creds-api` stage: ERROR-level execution logs into the group API Gateway manages itself (no retention set; the volume is near zero) and X-Ray tracing (a gateway segment only — no Lambda has active tracing) |
| APIGateway.4, CloudFront.6, WAF.10, WAF.12 | the two web ACLs above |
| APIGateway.8, .9, .11 | not applicable since 2026-09-08 — the issuer has no HTTP API, route or API Gateway domain any more (static S3 + CloudFront, "Issuer on S3 + CloudFront") |
| CloudFront.1, .3, .9, .10, .12, .13, .15 | both distributions (app + issuer): default root object, HTTPS only, HTTPS + TLS 1.2 to the API origin, OAC on the buckets, `TLSv1.2_2021` viewer policy |
| CloudFront.7, .8 | the issuer distribution always (custom cert + SNI); the app distribution only WITH the `web` block — without it those two fail for the app; run with `web` |
| Cognito.3, Cognito.5 | pinned password policy; a password-only pool must set `mfa` explicitly — synth fails naming the two ways out, so the config always describes the pool |
| DynamoDB.1 | on-demand tables |
| EC2.2, .6, .15, .18, .19 | default SG stripped (explicit, not the cdk.json flag), REJECT-only flow logs (3 months), subnets never auto-assign public IPs (tasks request theirs), only 443 open to the internet |
| ECS.3, .4, .8, .9, .10, .18 | Fargate task definitions: no host PID, non-privileged, no credential env vars, awslogs on every container, latest platform, EFS in-transit encryption |
| EFS.1, .3, .4, .8 | encrypted state file system, per-site access points with a root directory and POSIX user |
| ELB.1, .4, .12, .13, .17, .18 | the Headscale ALB has ONE listener (443, `TLS13-1-2-Res-2021-06`, no port-80 redirect any more), drops invalid headers, defensive desync mode, two AZs |
| S3.9, CloudFront.5 | since 0.5.0: the web, issuer and plugin-assets buckets send server-access logs, and both distributions standard logs, into `DataStack`'s `AccessLogsBucket` (90-day expiry, kept on teardown with `prod`). That bucket is the one that logs nowhere: AWS's own S3.9 text says to suppress its finding, and CloudFront's logging writes with an ACL grant, so an S3.12 finding on it is suppressed the same way |
| KMS.1, .2, .3, .5; Lambda.1, .2, .5; S3.2, .3, .5, .6, .8, .12, .13; SNS.4; IAM.1, .21; CloudFormation.4 | key-scoped `kms:Sign` only, named principals, Node 22, VPC Lambdas in two AZs, private bucket with SSL-only policy + a lifecycle rule, SSL-only topic, no customer managed policies, CDK's CloudFormation execution role |

**Passes with `prod: true`** (the production-hardening knob): CloudFormation.3
(termination protection on every hub stack), DynamoDB.2 (PITR), DynamoDB.6
(deletion protection; `deletionProtection: false` on one `AppTable` overrides
it — set that one deploy before removing a table for good), Cognito.6 (pool
deletion protection), ELB.6 (ALB deletion protection), EFS.2/EFS.7 (automatic
backups — sandbox recovery points would outlive a destroyed stack for 35
days), ECS.12 (Container Insights on the control-plane cluster;
`network.containerInsights` overrides either way, and "off" is emitted
explicitly so it really turns off). A sandbox (`prod: false`) fails all of
these on purpose — it is meant to be disposable.

**Opt-in knobs:**

| Control | Knob | Cost / caveat |
| --- | --- | --- |
| Cognito.4 (and Cognito.1 for NIST/PCI users) | `loginMethods.threatProtection: true` (requires `mfa` set) | PLUS feature plan, ~$0.02 per monthly active user, no free tier. Blocks password sign-ins with known-leaked passwords (not the SRP flow scripts may use — SRP never sends the password); risky sign-ins step up to TOTP only if the user enrolled, never a hard block. Re-run the e2e login flows after flipping it. Turning it off again is untested: if Cognito refuses the plan downgrade, delete the pool's risk configuration by hand first |
| ECS.12 on a connector | `containerInsights: true` on `ConnectorStack` / `TailnetConnector` | per-metric cost in the workload account |

**Cost knobs NOT built — fail as shipped, suppress with "cost knob":**

| Control | What it would take |
| --- | --- |
| EC2.10, .55, .56, .57, .58, .60 | six interface endpoints in the VPN VPC (EC2, ECR API, ECR Docker, SSM, SSM Contacts, SSM Incidents) at ~$7.30 each per AZ per month ≈ $88/month |
| ECS.2 | the Fargate tasks need a public IP because the VPC has no NAT gateway (~$32/month + data); private subnets + NAT (or the endpoints above) would clear it |

**Accepted by design — suppress with the reason** (rows 1–3 are the table
above; the steps are the same):

| Control | Resource | Why it cannot pass |
| --- | --- | --- |
| APIGateway.2 | the `creds-api` stage | Backend-auth client certificates exist for HTTP backends. The only integration is a Lambda proxy invoked through the AWS API — nothing to authenticate — and a stage certificate would expire every 365 days with no rotation. |
| CloudFront.4 | the web and issuer distributions | Origin failover needs two origins; each has exactly one bucket. |
| EC2.21 | the VPN VPC's default NACL | The default NACL allows everything; a replacement NACL that excludes 22/3389 leaves the default one unassociated, which fails EC2.16 instead. Nothing in the VPC listens on 22 or 3389 and every SG is closed. |
| SecretsManager.1, .4 | `<prefix>/headscale-apikey-<site>` | No rotation Lambda yet; rotation is the manual `-c headscaleKeyRotation=<stamp>` redeploy ("Headscale admin ops"). |
| KMS.3 | a retired issuer signing key | Fires only for the 7–30 days a rotated-out key waits for deletion ("Signing-key rotation"). |
| ECR.2 | the Headscale mirror repository (`network.mirrorImages`) | The mirror re-copies the pinned tag on every deploy and on a rollback; an immutable repository answers that with `ImageTagAlreadyExistsException` and can leave `NetworkStack` in `UPDATE_ROLLBACK_FAILED`. The tag is digest-pinned in code, which is what immutability would protect. |

**Account-level — the client's baseline, not the product's:** Account.1,
Config.1, IAM.4–8, CloudTrail.1/2/4/5, GuardDuty.\*, Inspector.\*, Macie.\*,
EC2.7/.172/.182, S3.1, Route53.2 (query logging on the client's own hosted
zone). Workload accounts: `TargetAccountStack` creates only an OIDC provider
and roles with AWS managed policies — no FSBP control evaluates those; pass
`terminationProtection: true` in its props if CloudFormation.3 matters there
(the runbook's occasional destroy-and-redeploy of RolesStack then needs it
lifted first).

**Upgrade notes for existing deployments** (all in-place updates): the ALB's
port-80 listener is deleted (clients only ever received https URLs); the VPN
VPC's default security group loses every rule (nothing in the product uses
it — anything hand-attached to it for debugging loses connectivity); the REST
stage gains ERROR-level execution logging + tracing; `prod` deployments gain
termination/deletion protection — see "Tear down". A password-only config
(`loginMethods: { password: true }` with no `mfa`) now fails at synth until
it chooses `mfa: "optional" | "required"` — that is Security Hub Cognito.5
made explicit, and `"optional"` changes nothing for existing users.

**Issuer migration (2026-09-08, package 0.1.8):** the first deploy after
upgrading moves the issuer from API Gateway to S3 + CloudFront inside one
CloudFormation update. Read "Issuer on S3 + CloudFront" before pushing it,
and verify with a real vend afterwards.
