How another system talks to the portal: the same HTTP API the web app uses, called with a service user's token. A tool that should act as one person, with only some of their access, uses a [[personal access token|Personal Access Tokens]] instead. The contract is [openapi.yaml](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/openapi.yaml) (OpenAPI 3.1, shipped in the package); this page is the walkthrough around it.

## 1. Create a service user

In the portal, as an admin: Users → Service users → **Add service user**, and tick its scopes: `aws` to list its roles and get AWS credentials, `network` to enroll machines on the private network, `shares` to share their ports, `admin.read.all` to read every administration route, `admin.write.all` for every administration route including changes (it implies the reads). Copy the client id and the client secret; the secret is shown once. Grant it roles and network resources the way you would a person (Users → the service user → Roles / Network resources). The scopes can be changed on its panel later and hold from its next call. The headless vend-and-join sequence for a machine is on the [[Service users runbook|Runbooks-Service-Users]].

## 2. Get a token

Service users use the OAuth `client_credentials` grant against the deployment's Cognito domain. The domain is the `hostedUiDomain` in `https://<portal host>/config.json`.

```bash
curl -s -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=client_credentials&scope=api/invoke" \
  https://<auth domain>/oauth2/token
```

The answer carries an `access_token` valid for one hour. Request a new one when it expires; there is no refresh token for this grant.

## 3. Call the API

```bash
curl -H "Authorization: Bearer $TOKEN" https://<portal host>/api/admin/users
```

Every route is under `https://<portal host>/api/`. A system that only needs AWS credentials calls `POST /api/credentials` with `{ "accountNumber": "…", "role": "…" }` for a role granted to it and receives keys for that role's session length. A route outside the service user's scopes answers `403` with `code: "TOKEN_SCOPE"`; the `/admin` routes need `admin.read.all` (reads) or `admin.write.all` (everything). An `admin.write.all` service user manages users and service users like a human admin.

## What to expect

- **Errors are JSON**, `{ "message": "…" }`: 401 no or bad token, 403 no grant on a vend, 404 the thing addressed does not exist, 409 already exists or already decided, 400 malformed input, 501 a feature the deployment did not enable, 502 an AWS call behind the route failed.
- **Lists come whole unless you ask for a page.** Catalog-sized routes (`/accounts`, `/admin/accounts`, `/admin/users`, `/requests/catalog`, `/admin/groups/{id}/roles`, …) serve one contract: `?q=&filter[key]=a,b&sort=&limit=&cursor=` → `{ items, nextCursor, total, facets }`. `limit` turns paging on (up to 200 per page); without it every route answers its whole list as before. `q` is a substring match, each `filter[key]` is any-of and keys AND together, `sort` takes a `-` prefix for descending, and `nextCursor` is opaque — pass it back unchanged, and start over without it when the query changes. Each route's description in the OpenAPI spec names its sort keys and facets.
- **Temporary access** uses the presets 1, 12, 24, 72, 168 and 720 hours; omit the duration for long-term.
- **Bulk routes** (`/admin/users/bulk`, `/admin/grants/bulk`, `/admin/grants/bulk-revoke`, `/admin/users/bulk-delete`) always answer 200 with a per-row result, so one bad row never fails the batch.
- **Rate limits.** Each token gets `waf.perTokenRateLimit` requests per five minutes (2,000 by default), and each source IP 5,000 on the web domain; over the limit the answer is 429 with `Retry-After`. Back off rather than retry immediately.
- **Audit.** Vends by a service user appear on the Activity page under its name.

## Keeping it safe

- Rotate the secret from the service user's row: the replacement works alongside the old one until you remove the previous secret, so a system can switch without downtime. Delete the service user when the integration is retired.
- Service users are reviewed once a year in the Requests queue; an admin confirms the automation is still needed.
- The spec is the contract. FNTIO's development repo keeps a Postman collection generated from it for manual exploration; if you build a client, generate it from `openapi.yaml`.
