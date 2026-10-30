People and admins: how the first admin comes to exist, how invitations work, and the command-line recipe behind the Users page. Index: [[Runbooks]].

## Add a user (and make one an admin)


### First admin — created by the deploy

`config.firstAdmin` makes the deploy itself bootstrap the one account nothing
else can (every later user is invited from the app):

```ts
firstAdmin: { email: "you@example.com" },
```

A `Custom::FirstAdmin` resource in CredsStack (handler:
`lambdacode/firstadmin/handler.ts`) runs on deploy and is idempotent against
the live pool:

- **No such user** → created in the `admins` group + the normal invite email
  (temporary password / set-password link, same template as UI invites).
- **Invite still unclaimed** → re-sent with a fresh temp password whenever the
  resource updates. The resource only runs when its properties change, so to
  force a re-send after the 7-day expiry, bump `firstAdmin.resend` (any
  number) and redeploy — or use the UI/CLI resend if another admin exists.
- **User already confirmed** (this deployment: `admin@example.com`
  predates the feature) → left untouched; only `admins` membership is kept.
- **Removing the block never deletes the user** — the resource's Delete is a
  no-op by design, and its IAM role cannot `AdminDeleteUser` at all. But
  don't read that as "the stack can't lose users": the user pool itself is
  RETAIN'd only when `prod: true`. With `prod: false`, destroying CredsStack
  (or a rollback that replaces the pool) deletes the ENTIRE pool — every
  user, passkey, and TOTP enrollment, first admin included. The issuer's KMS
  signing keys follow the same prod-only RETAIN rule.

Changing `firstAdmin.email` bootstraps the new address the same way and
leaves the old account alone (retire it from the Users page). The deploy
prints the address as the `FirstAdminEmail` output. The resource lowercases
the email before creating the user, so keep the config value lowercase to
match the account it makes.

#### SES coupling — the invite is sent DURING the deploy

With the `email` block set, the invite goes out through SES as part of the
CredsStack deploy — and a fresh account's SES sandbox delivers only to
verified recipients, so the very first invite is exactly the mail the sandbox
eats. Pick one BEFORE deploy #1:

- get SES production access first (see "Email deliverability" below), or
- verify the `firstAdmin.email` address as an SES identity (console →
  Identities → Create identity → Email address; recipient clicks the
  confirmation link), or
- omit `email` for deploy #1 — Cognito's default sender delivers to anyone
  (~50/day budget) — and add the block on a later deploy.

A failed send no longer rolls the deploy back: the handler falls back to
creating the user with `MessageAction: SUPPRESS`, and the
`FirstAdminInviteSent` output says which path ran — `sent`, or `suppressed`
meaning the account exists but no invite went out (resend from the Users
page once email works, or bump `firstAdmin.resend` and redeploy).

Timing: on a cold first deploy the invite can land minutes before the web
domain is live — CloudFront takes 15-30 min to go global. The link is valid
7 days; just wait for the site.

### Removing admin, deleting a user

Both end the person's sessions at once (`AdminUserGlobalSignOut`), and every admin route re-checks the
`admins` group against the directory once a minute per API container — so a removed admin cannot keep
using an already-issued token for the rest of its hour. Deleting also revokes every grant, closes the
person's open requests and ends the dev shares they own; the last remaining admin cannot be removed.

### Invite emails

The admin UI's Create user sends a Cognito invite whose look depends on
`config.web`:

- **Custom domain set**: the email is a **"Set your password" link**
  (`/login#inv={username}:{####}`) — the login page consumes the fragment,
  signs in with the embedded temp password, and lands the invitee straight
  on the set-password screen. The temp password is never shown. Desktop
  users continue from that page: **Open in the desktop app** under the card
  hands the invitation to the app (desktop/README.md "Deep links").
- **No custom domain**: plain text with the temporary password (the app's
  CloudFront URL can't be referenced from CredsStack without a stack cycle).

Both templates live on the user pool (CredsStack `userInvitation`);
**Send invite email** regenerates the temp password and reuses the same
template. Links/passwords expire after 7 days (pool policy) — after that,
send the invite email again. The API builds the same `#inv=` link itself
(`APP_URL`, from `config.web`; path-only without one) and returns it from
Create user only when the email is skipped (`sendEmail: false` →
`MessageAction: SUPPRESS`, still a temp password), for the admin to pass on.
**Copy sign-up link** on a pending user's panel sets a fresh temporary
password (`AdminSetUserPassword`, `Permanent: false`) — it replaces the
emailed one, and a later resend replaces it in turn.

**After any deploy that touches pool sign-in config or the invite flow,
run a live invite check** (unit tests mock AWS and can't see Cognito
reinterpret an unchanged call): invite a mailbox you own from the admin
UI, confirm the **invited** pill appears, the email arrives with a working
link (or temp password), and first sign-in reaches the set-password
screen. Then delete the test user. `createUser` must always pass a `TemporaryPassword`:
in a pool with passwordless factors enabled, omitting it births the user
CONFIRMED with no password, no invite state, and a password-less invite
email (this silently broke invites between 2026-07-20 and 2026-08-13).

```bash
POOL=<UserPoolId>
aws cognito-idp admin-create-user --user-pool-id $POOL --username tester@example.com --message-action SUPPRESS
aws cognito-idp admin-set-user-password --user-pool-id $POOL --username tester@example.com --password 'Test1234!' --permanent
# admin only:
aws cognito-idp admin-add-user-to-group --user-pool-id $POOL --username tester@example.com --group-name admins
```

Get a token, then call the API:

```bash
JWT=$(aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id <UserPoolClientId> \
  --auth-parameters USERNAME=tester@example.com,PASSWORD='Test1234!' \
  --query 'AuthenticationResult.IdToken' --output text)

# admin: register an account + a role, then list the catalog
# (the admin UI's Accounts page now does all of this too — curl is optional)
curl -s -X POST "<ApiUrl>admin/accounts" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"accountNumber":"<ACCT>","name":"sandbox"}'
curl -s -X POST "<ApiUrl>admin/accounts/<ACCT>/roles" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"roleName":"SandboxReadOnly","roleArn":"arn:aws:iam::<ACCT>:role/SandboxReadOnly"}'

# user: vend credentials (needs an Access row for this user → role, see below)
curl -s -X POST "<ApiUrl>credentials" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"accountNumber":"<ACCT>","role":"SandboxReadOnly"}'
```

Grant a user (their Cognito `sub`, from `admin-get-user`) permission to assume a
role via the admin API:

```bash
curl -s -X PUT "<ApiUrl>admin/accounts/<ACCT>/roles/SandboxReadOnly/grants/<sub>" \
  -H "Authorization: Bearer $JWT"
```

## Passkey or email code disappeared for one user

Check whether the user has an authenticator (TOTP) enrolled before anything else. Cognito offers a user with MFA configured the password alone in choice-based sign-in — passkey and email code are withheld for that user on every device, not just the one they enrolled on. This is Cognito's rule, not the portal's; the Authenticator dialog says so when they turn it on.

```bash
aws cognito-idp admin-get-user --user-pool-id <pool-id> --username <email> --query 'UserMFASettingList'
```

`["SOFTWARE_TOKEN_MFA"]` means enrolled. The user picks one lane: keep the authenticator and sign in with password + code, or turn it off under **Authenticator (MFA)** in the profile menu (or an admin uses **Reset MFA** on the user panel) and the other methods come back on the next sign-in. If nothing is enrolled, read on.

## Only the password is offered

The sign-in page lists what Cognito offers for that attempt. With `loginMethods.threatProtection` on, Cognito scores every attempt; on an attempt it applies an MFA action to, choice-based sign-in offers only the password — passkey and email code disappear for that attempt, even for a user who has both. The package allows Medium risk (a new network) and applies "MFA if configured" only at High, so this is rare; when a user reports it:

1. Read the user's recent attempts and their scores (times are UTC):

   ```bash
   aws cognito-idp admin-list-user-auth-events --user-pool-id <pool-id> --username <email> --max-results 10 \
     --query 'AuthEvents[].{t:CreationDate,risk:EventRisk.RiskLevel,ip:EventContextData.IpAddress,id:EventId}' --output table
   ```

2. If the attempts are the user's own, mark them valid — Cognito lowers the risk it assigns to later sessions with the same characteristics (it is not instant):

   ```bash
   aws cognito-idp admin-update-auth-event-feedback --user-pool-id <pool-id> --username <email> \
     --event-id <event-id> --feedback-value Valid
   ```

   The same is available in the Cognito console under the user's event history ("Set as valid").

3. The user can always sign in by password meanwhile; the other methods return once the score drops. A user with TOTP enrolled is asked for it on a High-risk attempt.

## Federated sign-in (SSO)

One-time per identity provider, per deployment. After this, staff sign in with their corporate account, portal access ends when that account is disabled, and the identifier the customer's other systems key on (an employee id — Entra's `oid` claim, say) reads on the user record, in the portal's own token and on every audit row. Configuration reference: [`loginMethods.federation[]`](Configuration-Reference#loginmethodsfederation). Entra ID is the worked example below; any OIDC provider works the same way.

### How it fits the existing pool

Nothing is replaced. The pool gains one identity provider per entry, the SPA client offers it next to the local methods, and Cognito's own hosted endpoints on `authDomainName` do the redirect dance (authorize → provider → `/oauth2/idpresponse` → the app's `/auth/callback`, PKCE code flow). A federated user ends up with the same tokens as a password user; grants, groups, vending and the 12-hour session cap are untouched.

Cognito treats every federated identity as a new person by default. The portal keeps "admins decide who gets in": an invite links the invited email to each configured provider, so the first federated sign-in lands on the invited user's `sub`; users invited before federation existed (or whose provider spells the email in another case) are linked by the pre-sign-up trigger on their first attempt, which costs them one automatic extra hop through the provider. An email nobody invited is refused with "Your account isn't set up here yet" — no stray pool user is ever created.

MFA for federated users is the provider's job (conditional access); the pool's `mfa` setting keeps applying to local sign-ins only. See [Security Posture](Security-Posture#federated-sign-in-sso).

### Register the portal at the provider (Entra ID)

1. Decide the claim keys first. They become `custom:<key>` attributes and **cannot be renamed or removed** once the pool has them — the same class of decision as `resourcePrefix`.
2. Entra admin center → App registrations → New registration. Single-tenant. Platform **Web**, redirect URI `https://<authDomainName>/oauth2/idpresponse` (the deploy prints it as the `FederationRedirectUri` output of WebStack; on a deployment without the `web` block it is the Cognito prefix domain). Leave ID tokens on.
3. Certificates & secrets → New client secret. Copy the **value** (shown once) and note the expiry — Entra caps it at 24 months; put the date in your calendar.
4. Token configuration → Add optional claim → ID → `email`, `given_name`, `family_name`. `oid` is always present in v2.0 tokens. API permissions: `openid`, `profile`, `email` (User.Read is fine; grant admin consent so users are not prompted).
5. Overview → copy the Application (client) ID and the Directory (tenant) ID. The issuer is `https://login.microsoftonline.com/<tenant id>/v2.0`.
6. Put the secret in Secrets Manager, in the deployment's region, as a plain string:

   ```bash
   aws secretsmanager create-secret --region <region> \
     --name <resourcePrefix>/idp/ExampleCorp --secret-string '<the value from step 3>' \
     --query ARN --output text
   ```

7. Add the block to `loginMethods` and deploy (push `main`):

   ```ts
   federation: [
     {
       name: "ExampleCorp",
       label: "Example Corp",
       type: "oidc",
       issuerUrl: "https://login.microsoftonline.com/<tenant id>/v2.0",
       clientId: "<application (client) id>",
       clientSecretArn: "arn:aws:secretsmanager:<region>:<account>:secret:<prefix>/idp/ExampleCorp-XXXXXX",
       attributeMapping: { givenName: "given_name", familyName: "family_name" },
       claims: { gid: { from: "oid", maxLen: 128, label: "Employee id" } },
     },
   ],
   ```

   Entra only sends `email` for accounts that have a mail attribute; for tenants where it is empty, map `email: "preferred_username"` (the UPN) and invite users by their UPN.

8. Invite users with the address the provider asserts, lowercase (the pool's sign-in name is case-sensitive; a provider that spells it differently still gets in, at the cost of one extra hop on the first sign-in). With a provider configured, the invite email leads with "Sign in with <label> — you don't need a password" and keeps the set-password link underneath for local users (one template serves both). Existing users need nothing — they are linked on their first federated sign-in. Changing a user's email in the portal moves their federated link to the new address. Invited people who only ever sign in through the provider never set a local password; the Users page stops calling them "invited" once they have been in.
9. Test: open the login page in a private window, click **Sign in with Example Corp**, complete the provider's sign-in, land on Accounts. On the Users page the mapped claim shows under the user's email once they have signed in through the provider; the next credential vend shows it on Activity (and in the CSV export).

### Rotate the client secret

1. New secret at the provider (both stay valid until you remove the old one).
2. `aws secretsmanager put-secret-value --secret-id <arn> --secret-string '<new value>' --query VersionId --output text`
3. Set `clientSecretVersionId` in the block to that version id and deploy. Without the pin, CloudFormation does not re-read the secret because nothing about the provider resource changed.
4. Remove the old secret at the provider once a sign-in has succeeded on the new one.

### Remove a provider

Delete its block and deploy. Linked identities are dropped with the provider; the users themselves, their grants and their local sign-in methods stay. The custom attributes remain on the pool (Cognito cannot remove them) and simply stop being written.

### Desktop app

The shell keeps the sign-in in-view only on the provider's hosts — see [`allowedHosts`](Configuration-Reference#loginmethodsfederation) for the rule. A provider that bounces through another host (a tenant's own ADFS, `login.live.com` for personal Microsoft accounts) needs it listed, or the sign-in opens in the system browser and never returns.

### What federated users cannot do

A federated session's tokens carry no Cognito self-service scope, so the Passkeys and Authenticator (MFA) items are hidden for it: those factors belong to the provider. A user who also has a local password can still manage them after a local sign-in.

### Troubleshooting

- **"Your account isn't set up here yet"** — no invited user has the email the provider asserted. Invite that address (lowercase), or check which address the provider sends (Entra: `email` vs `preferred_username`).
- **The first sign-in bounced once and then worked** — expected for users invited before the provider existed: the trigger linked the identity and the page re-ran the flow.
- **Deploy fails creating the provider** — Cognito could not fetch `<issuerUrl>/.well-known/openid-configuration`, or the `iss` in the document differs from `issuerUrl`. Use the tenant-specific v2.0 issuer, never `common`.
- **Sign-in works but the claim is empty** — the provider did not send the claim (Entra: add it under Token configuration), or the value exceeded `maxLen`.

