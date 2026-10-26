Machine access to the API: what a service user is, its scopes, creating one, the headless vend-and-join flow, rotating its secret. Index: [[Runbooks]].

## Service users — machine access to the API

A **service user** is a machine identity for automation (CI jobs, scripts,
another system): a Cognito **app client with a secret** using the OAuth
`client_credentials` flow. No human, no password, no Cognito groups. Its
access token's `sub` **is the client id**, so its grants are ordinary Access
rows under `user#<clientId>` — vending, listings, revocation, audit all work
unchanged.

**What a service user may call is its scopes**, picked by the admin at
creation and changeable later: the three narrow ones a
[[personal access token|Personal Access Tokens]] has too, plus portal
administration split into read and write.

| Scope | Reaches | Give it to |
|---|---|---|
| `aws` | `GET /accounts`, `POST /credentials`, console links — for the roles granted to it | anything that needs AWS credentials: a VM agent, a CI job |
| `network` | `POST /network/device-key` (incl. `ephemeral: true`), list and remove its own devices | machines that join the private network headlessly |
| `shares` | create, list and stop shares of its devices | a machine that serves a port to teammates |
| `admin.read.all` | every `GET` under `/admin` — users, groups, accounts, requests, activity | a reporting or monitoring system |
| `admin.write.all` | every route under `/admin`, reads included — create users and service users, grant roles, approve requests | an external system that provisions the portal itself |

A service user holds `aws`, `network` and `shares` in any combination without
being an admin; the admin scopes are the admin credential, and
`admin.write.all` implies `admin.read.all`. Finer admin scopes
(`admin.write.users`, `admin.read.groups`, …) can be added later without
changing the shape. Treat each client secret according to its scopes: an
`admin.write.all` secret is a **full app-admin credential** (it can create
users and other service users, so a leak is not contained by deleting the one
client); an `aws` + `network` secret can only vend the roles and join the
networks granted to it. A route outside the scopes answers `403` with
`code: "TOKEN_SCOPE"`. Deleting a service user locks it out on the **next
request** (auth requires its registry row to exist — issued tokens alone don't
suffice), and narrowing its scopes holds from the next request the same way.
A service user created before scopes existed (2026-10) carries the full set
`aws`, `network`, `shares`, `admin.write.all`, which reaches the admin,
vending, device-key and share routes. Routes outside that table — requests,
notifications, preferences, a machine's own `/resources` listing, plugin
discovery — are no longer reachable by any service user, so an integration
that used them needs a person's session or a personal access token. No caller
— human or machine — can delete or demote the **last human admin**.

Mechanics (all in CDK / the API — nothing per-clone to set up beyond deploying
DataStack + CredsStack + WebStack):

- CredsStack owns a Cognito **resource server** `api` with the one custom scope
  `api/invoke`. Client-credentials tokens must carry a custom scope; this one
  doubles as the marker `services/tokenVerifier.ts` (which `auth.ts` and the
  plugin authorizer share) requires on access tokens. Humans' access
  tokens never carry it, and the verifier additionally requires a live registry
  row — so no other pool client can authenticate as a machine, and deletion
  revokes in practice despite tokens living 1 hour. The row also carries the
  **scopes**; `requireAuth` reads them on every request and refuses routes
  outside them with the shared route table (`services/tokenScopes.ts`), and
  `isAdmin` accepts a machine with `admin.write.all` on any method and with
  `admin.read.all` on `GET`/`HEAD` only. A row written before scopes existed
  has none and reads as the full set. Plugin routes are a separate layer: the
  plugin authorizer decides by the service user's `plugin#` grants, not by its
  scopes.
- The admin API (`serviceUsersService`) creates/deletes the app clients at
  runtime (`cognito-idp:CreateUserPoolClient`/`DeleteUserPoolClient`, scoped to
  the pool). Access tokens live **1 hour**.
- `auth.ts` stamps `lastUsedAt` on the registry row each time a service token
  authenticates — the UI's "Last used" column ("is this automation alive?").

### Add one (admin UI)

1. **Administration → Users → Service users tab → Add service user**, name it
   (lowercase/digits/hyphens, e.g. `github-actions-deploy`) and tick its
   **scopes** (table above). At least one; **Admin (read + write)** only for a
   system that administers the portal.
2. Copy the **client ID and secret from the shown-once screen** — Cognito
   cannot re-show a secret; once the panel closes, recovery = rotation.
3. Paste both into the automation's own secret store (e.g. GitHub repo →
   Settings → Secrets and variables → Actions).
4. Grant roles and network resources from its panel (same Grant/Revoke
   controls as a person; temporary grants work too). **Change scopes** on the
   panel edits the set later — it holds from the service user's next call.

The automation then exchanges the secret for tokens and calls the API:

```sh
TOKEN=$(curl -s -X POST https://auth.<domain>/oauth2/token \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d 'grant_type=client_credentials&scope=api/invoke' | jq -r .access_token)

curl -s https://<app-domain>/api/credentials \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"accountNumber":"…","role":"…"}' -H 'content-type: application/json'

# With admin.write.all the admin API works too, e.g. register an account:
curl -s https://<app-domain>/api/admin/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"accountNumber":"…","name":"…"}' -H 'content-type: application/json'
```

(The secret screen in the UI shows the token curl pre-filled for the deployment.)

### A machine that vends credentials and joins the network (headless)

The autonomous-VM case: an agent on a freshly provisioned machine needs AWS
credentials for its work and a place on the private network, with no person
and no desktop app. One service user with `aws` + `network`, granted the role
and the resources it needs:

```sh
TOKEN=$(curl -s -X POST https://auth.<domain>/oauth2/token \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d 'grant_type=client_credentials&scope=api/invoke' | jq -r .access_token)

# 1. AWS credentials for a granted role (expiration = the role's session length)
curl -s https://<app-domain>/api/credentials -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"accountNumber":"…","role":"…"}'

# 2. A one-shot enrollment key; ephemeral = the node disappears 30 min after it goes offline
KEY=$(curl -s https://<app-domain>/api/network/device-key -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"siteId":"<site>","ephemeral":true}')

# 3. Join with the Tailscale client, pointed at this deployment's control plane
sudo tailscale up --login-server "$(echo "$KEY" | jq -r .controlUrl)" \
  --authkey "$(echo "$KEY" | jq -r .key)" --hostname "$(hostname)"
```

The node reaches exactly the resources granted to the service user (ACLs are
rendered from its grants within about five minutes); `GET /api/network/devices`
lists its nodes and `DELETE /api/network/devices/<siteId>/<name>` removes one.
A VM that is torn down leaves an ephemeral node behind for at most 30 minutes.

### Rotate a secret

Cognito can't regenerate a secret, so **rotate = replace with overlap**: a new
app client is created behind the same name, all grants and the scopes are
copied, and both secrets work until the old one is removed. Rotate on: suspected leak, a
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
