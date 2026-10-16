Day-two operations: backups, email deliverability, the custom web domain, debugging. Index: [[Runbooks]].

## Restore from backup (PITR)

`prod: true` keeps point-in-time recovery on every table, but DynamoDB can
only restore **to a new table** — never in place — so a real recovery is a
copy-back, not a switch. Rehearsed 2026-08-31 on the Access table (84/84
items verified, ~1 min for a small table; large tables take much longer):

1. **Restore to a side table** (any point in the last 35 days):
   ```bash
   aws dynamodb restore-table-to-point-in-time \
     --source-table-name <live table name> \
     --target-table-name restore-<name>-<date> \
     --use-latest-restorable-time     # or --restore-date-time <ISO>
   ```
2. **Verify** before touching anything live: `scan --select COUNT` on both
   tables and spot-check the rows you care about.
3. **Copy back what was lost** into the live table (script BatchWriteItem /
   PutItem from the side table). Don't try to swap the table into the stack:
   the stack owns the original table name, and replacing the resource is
   CloudFormation surgery that loses the name every by-name contract uses.
4. **Delete the side table** when done — and know the restore drops table
   settings: the copy comes back with **TTL and PITR DISABLED** (verified),
   no tags, no alarms. Irrelevant for a copy-back source; fatal if you tried
   to promote it to be the live table.

For the Audit table, restored rows keep their `expiresAt` values, so TTL
resumes correctly once rows are copied back into the live (TTL-enabled) table.

## Email deliverability — Cognito via SES

All Cognito email (OTP sign-in codes, password resets, invites) is sent
through SES from the project's own domain, fully authenticated so it lands in
inboxes instead of spam. Driven by the optional `email` block in
`config/project.ts`; omit it to fall back to Cognito's built-in sender
(~50 emails/day **account-wide** — OTP + resets + all users share that
budget — and poor deliverability). When that cap is hit, Cognito refuses the
send and no user is created; the invite form and each failed row of a bulk
invite say so and point here.

What one `email` block provisions:

- **DataStack** — an SES domain identity for `zoneName`, plus every DNS
  record in the hosted zone automatically:
  - 3 DKIM CNAMEs (receivers verify each mail's signature against these)
  - custom MAIL FROM `mail.<zoneName>`: MX + SPF TXT (authorizes SES's
    servers to send for the domain)
  - `_dmarc.<zoneName>` TXT, policy `quarantine`, aggregate reports to
    the first `alertEmail` (override with `email.dmarcReportEmail`)
- **CredsStack** — the user pool's `EmailConfiguration` flips to
  `DEVELOPER` (SES) sending from `fromAddress`.

The identity deliberately lives in DataStack, not CredsStack: Cognito rejects
an *unverified* identity, and SES verification is async (usually minutes after
the DKIM records publish). DataStack deploys first and survives a CredsStack
rollback, so the race self-heals on a re-run.

Per-deployment setup (template clones):

1. Set the `email` block in `config/project.ts` — the zone + a `fromAddress`
   under it. `fromAddress` must be under `zoneName` (synth enforces this).
2. Push to `main` (or `cdk deploy DataStack CredsStack`). If CredsStack fails
   with an "email identity not verified" error, SES hadn't finished verifying
   yet — wait ~5 minutes and re-run the deploy; DataStack keeps the identity.
3. **SES sandbox:** a fresh account can only send *to* verified addresses —
   Cognito codes to anyone else are silently dropped. Either verify each test
   user's address (SES console → Identities → Create identity → Email
   address, recipient clicks the confirmation link), or request production
   access for real users: SES console → Account dashboard, or
   `aws sesv2 put-account-details --mail-type TRANSACTIONAL --website-url
   <app-url> --use-case-description "<what/volume/recipients>"
   --production-access-enabled`. Approval is usually <24 h; poll with
   `aws sesv2 get-account` (`ReviewDetails.Status` goes `PENDING`→`GRANTED`).
4. Verify: request an email OTP; the code should arrive from `fromAddress`,
   and Gmail's "Show original" should say SPF/DKIM/DMARC all `PASS`.

## Custom web domain

Optional: serve the app on a friendly domain instead of the raw CloudFront
URL, with sign-in on a subdomain of it. Configured entirely by the `web`
block in `config/project.ts`:

```ts
web: {
  hostedZoneId: "Z…",                        // the project's Route 53 zone
  zoneName: "portal.example.com",
  domainName: "portal.example.com",      // the app (zone apex here)
  authDomainName: "auth.portal.example.com", // Cognito domain (sign-in is in-app since 2026-08-11)
},
```

What it creates: `WebCertStack` in **us-east-1** (CloudFront and Cognito only
accept certs from that region) holding one DNS-validated ACM cert for both
names, plus — in `WebStack` — the CloudFront alias + A/AAAA records, the
Cognito **custom** auth domain (replacing `creds-<acct>.auth.<region>…`), and
its alias record. Constraints enforced at synth: `domainName` must be in the
zone, and `authDomainName` must be a **child of `domainName`** — Cognito
refuses a custom auth domain whose parent doesn't resolve, and the app's own
alias record satisfies that (the stack orders record-then-domain for the same
reason).

Per-clone setup (one time, before the first push with `web` set):

1. Bootstrap us-east-1 in account A — the command and why CI can't run it
   are under "Install, test, deploy"; already done on any deployment that
   has deployed with WAF on (the default), since that is the same stack.
   Everything else about the domain deploys from config alone.
2. Push (or `cdk deploy WebStack`). First deploy is slow: ACM validates the
   cert via Route 53 records it writes itself (~minutes), and the Cognito
   custom domain can take ~15 min to go live globally.
3. Verify: the app loads at `https://<domainName>` and signs in at its own
   `/login` (no redirect off the app since 2026-08-11). `config.json`'s
   `hostedUiDomain` still shows the custom auth domain (it flows from
   `hostedUiDomain.baseUrl()` automatically — kept for the desktop shell's
   nav allowlist, not for sign-in).

Cutover notes: the raw CloudFront URL stays registered as a callback/logout
URL so old tabs and the desktop shell keep working; sessions don't survive
the auth-domain switch (the Cognito cookie lives on the old domain) — users
just sign in again. The issuer host (`issuer.…`) is untouched — this feature
never touches cross-account trust.

## Debugging

- **Logs:** CloudWatch → `/aws/lambda/CredsStack-VendingApiHandler…`. Each request logs a
  JSON trail (`request` → `requireAuth` → `ALLOWED`/`DENIED` → `SUCCESS`). Cross-stream:
  Logs Insights `filter @message like /DENIED/`.
- **Stale 401s:** the API is CloudFront-fronted; a cached `401` can linger after auth
  changes. Add `?n=123` to bypass. A 401 with `x-amzn-errortype` and **no**
  `x-powered-by: Express` came from API Gateway, not the app.
