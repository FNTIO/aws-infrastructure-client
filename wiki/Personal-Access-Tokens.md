A personal access token lets a script, a CI job, a command-line tool or a remote development machine act as you, limited to the scopes you pick. It is the per-user counterpart of a [service user](API-Integration): it never holds more than you do, and it stops working when you revoke it, when it expires, or when your account is disabled or deleted.

The feature is off unless the deployment sets `personalAccessTokens.enabled` (see [[Configuration Reference]]). The discovery document (`GET /api/.well-known/infra-client`) says whether it is on.

## Create one

In the portal: the user menu → **Access tokens** → **Create token**. Give it a name, the scopes it needs and an expiry (at most the deployment's `maxLifetimeDays`, 90 by default). An `aws` or `api` token can be limited to some of your roles. Copy the token when it is shown: it is displayed once and only a hash of it is stored.

| Scope | What it may do |
| --- | --- |
| `aws` | List your accounts and roles, get credentials and console links |
| `network` | Get enrollment keys for your own devices, list and remove your devices |
| `shares` | Share ports of your devices, list and stop your shares |
| `api` | Everything you can do in the portal, admin actions included while you are an admin |

## Use it

```bash
curl -H "Authorization: Bearer $INFRA_CLIENT_TOKEN" https://<portal host>/api/tokens/current
curl -H "Authorization: Bearer $INFRA_CLIENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"accountNumber":"123456789012","role":"ReadOnly"}' https://<portal host>/api/credentials
```

`GET /api/tokens/current` tells a tool who it acts as and what it may do. A call outside the token's scopes answers `403` with `"code": "TOKEN_SCOPE"`; a revoked, expired or unknown token answers `401`. Credentials carry `expiration`; reuse them until shortly before it instead of vending on every run.

A remote machine can join the private network with an **ephemeral** key (`POST /api/network/device-key` with `{"ephemeral": true}`): the control plane removes the device 30 minutes after it goes offline. A dev share can be bound to one device by name (`"device"` on `POST /api/network/shares`), so it opens the port on that machine only; see [[Private Network]]. A machine that enrolls again under the same name while its previous device still exists gets a suffixed name on the network (the share keeps working, its link does not): remove the old device first (`DELETE /api/network/devices/{siteId}/{name}`).

## Keep it safe

- Give each tool its own token with the fewest scopes it needs, and a short expiry. Tokens cannot create or revoke tokens; managing them needs your signed-in session.
- An `api` token of an admin can do what the admin can, including creating service users and inviting people — credentials that outlive the token. Give automation `aws`, `network` or `shares` unless it really administers the portal.
- Revoke a token you no longer need (or one that leaked) on the Access tokens page; it stops on its next request. Admins see and revoke every user's tokens on Users → Access tokens.
- The bell warns before a token expires. Activity rows written through a token name it.

Reference: the package README, [Personal access tokens](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#personal-access-tokens), and the routes under the `Tokens` tag in [openapi.yaml](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/openapi.yaml).
