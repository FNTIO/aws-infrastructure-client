Machine access to the API: what a service user is, creating one, rotating its secret. Index: [[Runbooks]].

## Service users — machine access to the API

A **service user** is a machine identity for automation (CI jobs, scripts,
another system): a Cognito **app client with a secret** using the OAuth
`client_credentials` flow. No human, no password, no Cognito groups. Its
access token's `sub` **is the client id**, so its grants are ordinary Access
rows under `user#<clientId>` — vending, listings, revocation, audit all work
unchanged.

**Every service user is an app admin** (decided 2026-08-20). The driving use
case: an external provisioning system creates AWS accounts (dev/staging/prod
per project) and must register them here — create accounts and roles, grant
groups — without a human clicking through the UI. Treat every client secret
as a **full app-admin credential** when deciding where it may be stored: a
holder can create users and service users, grant any role, and approve
requests. Deleting a service user locks it out on the **next request** (auth
requires its registry row to exist — issued tokens alone don't suffice), and
no caller — human or machine — can delete or demote the **last human admin**.

Mechanics (all in CDK / the API — nothing per-clone to set up beyond deploying
DataStack + CredsStack + WebStack):

- CredsStack owns a Cognito **resource server** `api` with the one custom scope
  `api/invoke`. Client-credentials tokens must carry a custom scope; this one
  doubles as the marker `services/tokenVerifier.ts` (which `auth.ts` and the
  plugin authorizer share) requires on access tokens. Humans' access
  tokens never carry it, and the verifier additionally requires a live registry
  row — so no other pool client can authenticate as a machine, and deletion
  revokes in practice despite tokens living 1 hour. `requireAdmin` accepts
  every such caller as an app admin: admin status stays in the signed token —
  group claim for humans, service scope for machines.
- The admin API (`serviceUsersService`) creates/deletes the app clients at
  runtime (`cognito-idp:CreateUserPoolClient`/`DeleteUserPoolClient`, scoped to
  the pool). Access tokens live **1 hour**.
- `auth.ts` stamps `lastUsedAt` on the registry row each time a service token
  authenticates — the UI's "Last used" column ("is this automation alive?").

### Add one (admin UI)

1. **Administration → Users → Service users tab → Add service user**, name it
   (lowercase/digits/hyphens, e.g. `github-actions-deploy`).
2. Copy the **client ID and secret from the shown-once screen** — Cognito
   cannot re-show a secret; once the panel closes, recovery = rotation.
3. Paste both into the automation's own secret store (e.g. GitHub repo →
   Settings → Secrets and variables → Actions).
4. Grant roles from its panel (same Grant/Revoke controls as a person;
   temporary grants work too).

The automation then exchanges the secret for tokens and calls the API:

```sh
TOKEN=$(curl -s -X POST https://auth.<domain>/oauth2/token \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d 'grant_type=client_credentials&scope=api/invoke' | jq -r .access_token)

curl -s https://<app-domain>/api/credentials \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"accountNumber":"…","role":"…"}' -H 'content-type: application/json'

# Admin API works too (service users are app admins), e.g. register an account:
curl -s https://<app-domain>/api/admin/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"accountNumber":"…","name":"…"}' -H 'content-type: application/json'
```

(The secret screen in the UI shows this curl pre-filled for the deployment.)

### Rotate a secret

Cognito can't regenerate a secret, so **rotate = replace with overlap**: a new
app client is created behind the same name, all grants are copied, and both
secrets work until the old one is removed. Rotate on: suspected leak, a
trusted holder leaving, a lost secret, or a client policy that demands it —
nothing expires on its own.

1. Panel → **Rotate secret** → copy the new client ID **and** secret (both
   values change — it's a new client underneath).
2. Update them in the automation's config.
3. When "Last used" shows the new client authenticating, press **Remove** on
   the previous client. Only one rotation can be in flight per service user.

Deleting a service user removes its client(s), all its grants, and the
registry row — running automations start failing immediately.

### Cost note (per clone)

Cognito bills M2M by usage only: ~$0.00225 per 1,000 token requests, on the
account hosting the user pool (the old $6/month per-app-client fee was
removed in Nov 2025). An automation fetching a token hourly costs well under
a cent per month — effectively free at this template's scale.
