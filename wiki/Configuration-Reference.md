`config/project.ts` is one exported `ProjectConfig` object, the only place a deployment's specifics live. This page is written from the TSDoc on that interface (a package test fails when a top-level field has no row here) and lists every block and field as declared in [`project-config.d.ts`](https://unpkg.com/browse/@fntio/infra-client@latest/dist/lib/project-config.d.ts) (the package's shipped types) and the types it imports, with the default or fallback for each optional field and the checks the package runs at synth time. For a complete worked example, see [The config file](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#the-config-file) in the package README.

## How the config is consumed

`bin/app.ts` passes the object to `addAccessPortal(app, { project, resourcePrefix, sites })`, which creates the hub stacks: `DataStack`, `CredsStack`, `WebCertStack` (always, in `us-east-1`), `WebStack`, and `NetworkStack` when `network` is set. `resourcePrefix` is `PROJECT.resourcePrefix ?? DEFAULT_RESOURCE_PREFIX`; `sites` must come from `resolveSites(project.network)` whenever `network` is set, and `addAccessPortal` refuses to synth otherwise. `rolesByAccount` drives one `TargetAccountStack` per workload account, and the `connectorVpcs` under each site drive one `ConnectorStack` per VPC. The web app's runtime `config.json` (branding, login methods, and so on) is generated from the same object during the deploy. `addAccessPortal` also accepts `webAssetPath` to serve a web bundle other than the one in the package.

Values that would fail at deploy or at runtime are rejected at synth with a plain error. The checks are noted per field below.

## Deployment identity

| Field | Required | What it controls |
| --- | --- | --- |
| `projectName` | required | Display name users see in invite emails, the desktop app, the sidebar and the browser tab. Must be non-empty (synth check). |
| `env.account`, `env.region` | required | The hub account and region, explicit so nothing depends on which credentials run the synth. Permanent. |
| `prod` | required | `true` = production hardening: tables (with point-in-time recovery and deletion protection), the user pool and the issuer signing keys are retained on teardown; every hub stack gets termination protection and the VPN load balancer deletion protection. |
| `alertEmail` | required | Ops alert recipient(s) for alarms and the issuer canary: one address or a list of addresses, each with its own subscription. AWS emails every address a subscription confirmation on the first deploy; an unconfirmed address gets nothing. An empty list, a non-address or a `change-me` placeholder fails at synth. |
| `resourcePrefix` | optional, default `infra-client` | Prefix of every by-name cross-account resource. Lowercase slug, letter-first, at most 15 characters (synth check). Set once before the first deploy; renaming breaks all of them. |

## `issuer`

Permanent: `https://<domainName>` is baked into every workload account's trust. Only `keyVersions` and `signerVersion` may change later (key rotation).

| Field | Required | What it controls |
| --- | --- | --- |
| `hostedZoneId`, `zoneName` | required | The Route 53 zone the issuer record is written into. `zoneName` must not end with a dot (synth check). |
| `domainName` | required | The issuer hostname. Must be `zoneName` or a subdomain of it (synth check). |
| `keyVersions` | optional, default `[1]` | Every listed key version is published in the JWKS. No duplicates (synth check). |
| `signerVersion` | optional, default `1` | The key version that signs; must be in `keyVersions` (synth check). |

## `loginMethods`

The first-auth factors the sign-in page offers. Changeable later. The block below is the same one the package README and the sample app show, with every field present; copy it and change values rather than picking fields.

```ts
  loginMethods: {
    password: true, // always on: Cognito requires it
    passkey: true, // Touch ID / Windows Hello / security keys; needs the `web` block
    emailOtp: true, // passwordless one-time code by email
    mfa: "optional", // TOTP on password sign-ins, "optional" | "required"; a password-only pool must set it
    threatProtection: false, // Cognito threat protection (PLUS plan, about $0.02 per active user); needs mfa
    federation: [], // your own OIDC provider(s): wiki Runbooks-Users, "Federated sign-in (SSO)"
  },
```

| Field | Required | What it controls |
| --- | --- | --- |
| `password` | optional; `false` fails at synth | Password sign-in. Cognito requires it, so it is always on. |
| `passkey` | optional | WebAuthn: Touch ID, Face ID, Windows Hello, security keys. Requires the `web` block, because passkeys bind to the custom web domain (synth check). |
| `emailOtp` | optional | Passwordless one-time code by email. |
| `mfa` | optional (`"optional"` or `"required"`); mandatory when password is the only first factor | TOTP second factor for password sign-ins. Passwordless factors are never challenged. A password-only pool must set it (synth check). |
| `threatProtection` | optional | Cognito threat protection in full-function mode: blocks password sign-ins with known-leaked passwords, allows Medium-risk sign-ins, and steps High-risk sign-ins up to MFA (if the user enrolled; the user is emailed when `email` is set). Needs `mfa` set (synth check). PLUS feature plan, about $0.02 per monthly active user. On an attempt Cognito applies MFA to, only the password is offered — [[Runbooks-Users]], "Only the password is offered". |
| `federation` | optional | Sign in with the customer's own identity provider (OIDC), one entry per provider — see the table below. Local methods stay available underneath (Cognito requires password). Runbook: [Federated sign-in (SSO)](Runbooks-Users#federated-sign-in-sso). |

### `loginMethods.federation[]`

One Cognito OIDC identity provider per entry, at most two (Cognito links at most five identities to one user, and a provider may use two — synth check). Entra ID is the worked example; Okta, Ping, Keycloak and Google Workspace fit the same block, only `issuerUrl`, the scopes and the claim names differ. `type: "saml"` is reserved and fails at synth until it is built.

The providers get their own app client (code flow only, no local sign-in on it). It is the only client allowed to write the mapped claims, so a local session can never set the identifier the customer trusts; the local client reads them into its tokens for linked users.

| Field | Required | What it controls |
| --- | --- | --- |
| `name` | required; letters, digits and `-`, 3–32 characters, unique, not a Cognito-reserved name (synth check) | The Cognito provider name: what the login page asks for and the prefix of auto-created usernames. Treat as permanent — renaming orphans every linked identity. |
| `label` | optional; default `name` | The sign-in button text ("Sign in with …"). |
| `type` | required, `"oidc"` | Provider protocol. |
| `issuerUrl` | required, plain `https://` URL (synth check) | The provider's issuer exactly as its discovery document states it; Cognito fetches `<issuerUrl>/.well-known/openid-configuration` at deploy, so it must be reachable from AWS. For Entra use the tenant-specific v2.0 issuer, never `common`. |
| `clientId` | required | The app registration's client id. |
| `clientSecretArn` | required, a full Secrets Manager ARN in the deployment's region (synth check) | Where the client secret lives, as a plain string (not JSON). CloudFormation resolves it at deploy; the value is never in the repo or the template. |
| `clientSecretVersionId` | optional | Pin a secret version after rotating it — CloudFormation only re-reads the secret when the provider resource changes. |
| `scopes` | optional; default `openid profile email`; must include `openid` (synth check) | OAuth scopes requested from the provider. |
| `attributeMapping` | optional; `email` defaults to `"email"` and cannot be emptied (synth check) | Standard Cognito attributes (camelCase: `email`, `givenName`, `familyName`, `preferredUsername`, …) → the provider claim that fills them. Email is the key that links a federated sign-in to the invited user. |
| `claims` | optional; keys 1–20 chars of `a-z 0-9 _`, at most 50 across all providers (synth check) | Custom claims copied onto the user as `custom:<key>` and into the portal's ID token. Each: `from` (the provider claim, e.g. Entra's `oid`), `maxLen` (1–2048, default 256), `label` (shown in the admin directory and Activity). **Permanent for the pool's life** — Cognito can neither rename nor remove custom attributes. |
| `allowedHosts` | optional; hostnames only (synth check) | Extra hosts the provider's sign-in may redirect through (a tenant's own ADFS, `login.live.com`). The desktop app keeps the sign-in in-view on the issuer's host, these hosts, and any subdomain of them; anything else opens in the system browser and the flow never returns. This row is the one place that rule is defined. |

## `branding`

Required, but may be `{}`. First impression only; admins restyle in the app afterwards. The project name comes from `projectName`.

| Field | Required | What it controls |
| --- | --- | --- |
| `logoUrl` | optional; omitted = letter mark from `projectName` | Square logo image. An `https://` URL or a `data:image/` URI of at most 64000 characters (synth check). |
| `logoFile` | optional; not together with `logoUrl` (synth check) | A local image file used as the logo, so nothing has to be hosted publicly: `.svg`, `.png`, `.jpg`, `.webp` or `.gif`, up to about 47 KB (synth check). Read at synth and embedded in the web app's config; a relative path resolves from the directory `cdk` runs in. |
| `primaryColor` | optional | Main color: `#rgb` or `#rrggbb` hex, or `"mono"` (synth check). |
| `primaryHoverColor` | optional; darkened primary if omitted | Hover shade, hex color (synth check). |
| `accentColor` | optional | Accent color, hex (synth check). |
| `companyName` | optional | Company name for the `company` modes of `brandShow`. |
| `brandShow` | optional; `logo-and-project` when `logoUrl` is set, else `project` | Which of logo, project name and company name the brand row shows: `logo`, `project`, `company`, `logo-and-project`, `logo-and-company`. A mode naming the logo or the company requires that value (synth check). |

## `rolesByAccount`

Required. A map from 12-digit workload account id to the roles `TargetAccountStack` deploys there. It must match the roles registered in the portal's Accounts page; roles live cross-account, so CDK cannot verify that. Adding roles later is fine; renaming a deployed role is not, because the name is pinned into the trust policy. A key that is not a 12-digit account id fails at synth when its `TargetAccountStack` is created (the check is on that stack's `env.account`; the map itself is not validated).

Each entry is a `TargetRoleSpec`:

| Field | Required | What it controls |
| --- | --- | --- |
| `roleName` | required | The IAM role name. Must match the portal catalog; immutable once anything vends against it. |
| `managedPolicies` | required | What the vended credentials may do; any `IManagedPolicy`. |
| `description` | optional | The IAM role description. |
| `maxSessionDuration` | optional, default 12 hours | IAM cap on vended sessions (1h to 12h). The per-role session length an admin sets in the portal is the effective limit. |

`InfraClientRoles` ships three ready specs with frozen names: `READ_ONLY` (`InfraReadOnly`, AWS `ReadOnlyAccess`), `POWER_USER` (`InfraPowerUser`, `PowerUserAccess`) and `FULL_ADMIN` (`InfraFullAdmin`, `AdministratorAccess`). They are plain data: spread one and change `roleName` and `description` for a variant.

## Optional feature blocks

### `firstAdmin`

The deploy creates this account in the admins group (idempotently, never deleted) and emails a set-your-password link; the `CredsStack.FirstAdminInviteSent` output reports the result. Removing the block later never deletes the account.

| Field | Required | What it controls |
| --- | --- | --- |
| `email` | required | Lowercase, a real mailbox. A non-address or a `change-me` placeholder fails at synth. |
| `resend` | optional | Bump to re-send an unclaimed invite on the next deploy. |

### `email`

Portal mail (codes, invites, resets) from your own domain via SES; DKIM, SPF and DMARC records are created for you. Omit it for Cognito's built-in sender (about 50 a day, spam-prone). Needs SES production access in the hub account.

| Field | Required | What it controls |
| --- | --- | --- |
| `hostedZoneId`, `zoneName` | required | The zone the DNS records go into; `zoneName` must not end with a dot (synth check). |
| `fromAddress` | required | The sender. Must be an address under `zoneName` (synth check). |
| `fromName` | optional | Display name shown next to the address in mail clients. |
| `dmarcReportEmail` | optional; default the first `alertEmail` | DMARC aggregate-report recipient. Use an address under `zoneName`: a recipient on another domain needs an authorizing TXT record on its own zone or receivers drop the reports, and synth warns about it. |

### `web`

The app on `domainName`, sign-in on `authDomainName`. Omit to run on the CloudFront and Cognito default hosts. Required when `loginMethods.passkey` is on.

| Field | Required | What it controls |
| --- | --- | --- |
| `hostedZoneId`, `zoneName` | required | The zone the records go into; no trailing dot (synth check). |
| `domainName` | required | The app's public URL. Must be `zoneName` or a subdomain of it (synth check). |
| `authDomainName` | required | The sign-in domain. Must be a subdomain of `domainName`, so its parent resolves for Cognito (synth check). |

### `waf`

WAF on CloudFront and the API, on by default (about $26 a month). Turning it off later leaves an orphan to delete by hand. Each limit must be an integer from 10 to 2000000000 (synth check).

| Field | Required | What it controls |
| --- | --- | --- |
| `enabled` | optional, default `true` | `false` = no web ACLs at all. |
| `rateLimit` | optional, default 5000 | `/api/*` requests per client IP per 5 minutes before CloudFront answers 429. One office NAT is one IP, so size for the office. |
| `perTokenRateLimit` | optional, default 2000 | API requests per bearer token per 5 minutes before the API's WAF answers 429; a ceiling on a runaway or leaked token, sized above the product's own bulk bursts. |

### `apiThrottle`

The vending API's stage throttle: the deployment-wide ceiling on requests per second across every caller (people, service users, tokens, the import CLI) and on direct `execute-api` hits that bypass CloudFront's WAF. It is not a per-caller limit; that is `waf.perTokenRateLimit`. One page load is 10 to 15 API calls, so size it for everyone opening the portal at once. Each field is a synth-checked integer within API Gateway's own account ceilings.

| Field | Required | What it controls |
| --- | --- | --- |
| `rateLimit` | optional, default 100 | Sustained requests per second for the whole stage (1 to 10000). |
| `burstLimit` | optional, default 200 | Requests the stage absorbs at once above the sustained rate (1 to 5000). |

### `dashboard`

How every user's dashboard is laid out. Optional; absent = `auto`. Set here, like every deployment-wide choice; there is no switch on the admin Accounts page. See [[Admin Guide]], "Dashboard layout".

| Field | Required | What it controls |
| --- | --- | --- |
| `layout` | optional, default `auto` | `auto`: a user gets Main / Favorites / Recent and the search once they hold an account an admin took off the Main section, and the plain list until then. `sections`: everyone gets the sections. `plain`: nobody does (synth check). The per-account **Show in the Main section** flag still decides what sits in Main. |

### `network`

Per-site VPN control planes. Omit it and no `NetworkStack` deploys and the portal shows no Network pages. A site is one routing domain; site ids are permanent once anything enrolls. See [[Private Network]].

| Field | Required | What it controls |
| --- | --- | --- |
| `hostedZoneId`, `zoneName` | required | The zone; no trailing dot (synth check). |
| `subdomain` | required | Sites live at `<site>.<subdomain>.<zoneName>` behind one wildcard certificate and record, so adding a site changes neither. Must be a DNS label (synth check). |
| `sites` | required, at least one | Keyed by site id: lowercase DNS label, letter-first, at most 20 characters (synth check). |
| `mirrorImages` | optional, default `false` | Run the control servers from a copy of the Headscale image in the hub's own registry, made at deploy, so a task restart never depends on the public registry being reachable. Turning it on or off restarts each control server once, and it needs `npm install cdk-ecr-deployment` in your project. Connector stacks take the same switch as the `mirrorImages` prop. See [Private Network](Private-Network#images-from-your-own-registry). |
| `containerInsights` | optional, default = `prod` | CloudWatch Container Insights on the control-plane cluster; a few dollars a month. |
| `devShares` | optional, off | `{ enabled, maxDurationHours?, allowGroupTargets?, maxActiveSharesPerOwner? }`: users share one local port with teammates on the same site (the desktop app runs the relay). `maxDurationHours` 1 to 72, default 8 (synth check) — a longer request is clamped to it, so set 72 when shares should outlive a weekend; `allowGroupTargets` default true; `maxActiveSharesPerOwner` — how many live shares one user may hold — 1 to 200, default 10 (synth check). See [[Private Network]]. |

Each site is a `SiteConfig`:

| Field | Required | What it controls |
| --- | --- | --- |
| `displayName` | optional, falls back to the id | Human-facing name; editable any time. |
| `accounts` | required, at least one | 12-digit account ids. An account belongs to exactly one site (synth check across sites). |
| `connectorAccounts` | optional | Accounts, or role ARNs for least privilege, that may mint machine keys for this site's connectors. Each must belong to `accounts` (synth check). |
| `connectorVpcs` | optional | VPCs joined via `ConnectorStack`, keyed by account id (must appear in `accounts`), each with `vpcId` and `routes`. Routes must be IPv4 CIDRs and must not overlap between VPCs of the same site (synth check). Add `region` (an AWS region name, synth check) when the VPC is not in the hub's region: `ConnectorStack` deploys there, and the hub gets a small relay so grant-driven security-group rules and DNS re-resolution keep working for that account. Omit it otherwise. An account with several VPCs lists them, `[{ vpcId, routes }, { vpcId, routes, name: "sandbox" }]`, every entry but one carrying a `name` (letters and digits, letter-first, at most 10, unique per account; synth check). The name suffixes that VPC's connector hostname (`connector-<account>-<name>`), its stack id and its SG-manager and resolver function names — set it once. |
| `splitDns` | optional | Private domain to that VPC's resolver IPs (CIDR base + 2). Bare IPv4 addresses only (synth check). |
| `albPriority` | optional, 100 to 989 | Override only if two site ids hash-collide; synth tells you. Never renumber a deployed rule. |

### `audit`

The activity log behind the admin Activity page — every credential vend, access change, request decision, catalog and user change, VPN session and refused admin call. Optional; omit for the defaults.

| Field | Required | Meaning |
|---|---|---|
| `retentionDays` | optional; default `400`; 30–3650 (synth check) | How long each activity row is kept. The default outlasts the yearly access review, which reads a role's usage from this log. Existing rows keep the retention they were written with. |

### `plugins`

Customer plugins — independently built UIs and Lambda routes a deployment registers from its own CDK app (`addAccessPortal(app, { …, plugins: [definePlugin(…)] })`). Optional. Off or absent = no plugin runtime is created and any plugin permission rows stay dormant; registrations passed while it is off fail at synth. Always present, on or off: the plugin catalog table.

| Field | Required | What it controls |
| --- | --- | --- |
| `enabled` | required when the block is present | `true` provisions the plugin runtime — see [Plugins](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#plugins) in the package README for what a deploy creates and the install/update/remove lifecycle. |
| `discoveryRefreshSeconds` | optional, default `60` | How often a signed-in portal re-reads which plugin pages the user may open. Integer between 15 and 300 (synth check). |

### `personalAccessTokens`

Personal access tokens: every user creates scoped, revocable tokens (`api`, `aws`, `network`, `shares`) for scripts, CI jobs and command-line tools that act as them. Optional; absent or `enabled: false` = no token is accepted and the UI hides the feature. Always present, on or off: the tokens table. See [[Personal Access Tokens]].

| Field | Required | What it controls |
| --- | --- | --- |
| `enabled` | required when the block is present | `true` reaches the API (tokens accepted, `POST /tokens` open, discovery says `personalAccessTokens.enabled`) and `config.json` (the Access tokens page). |
| `maxLifetimeDays` | optional, default `90` | The longest expiry a user may give a token. Integer between 1 and 365 (synth check). |

### `accountDimensions`

Tenant / project / stage on every account, for deployments with hundreds or thousands of them. Optional; absent = no dimensions anywhere, which is what every deployment had before. The naming rule is fixed: the first hyphen-separated segment of an account's name is the tenant, the last is the stage, and everything between is the project (`acme-data-platform-prod`; `acme-prod` has no project; a name without a hyphen gets none and shows as `unclassified`). The values are read off the name **once, when the account is registered** (admin UI, `POST /admin/accounts`, the import), stored on the catalog row, and edited by an admin afterwards — renaming an account never changes them. They filter the dashboard, the admin Accounts page, the request form and the group editor; they never decide access. Turning the block on for an existing catalog needs the backfill in the deployment README ("Account dimensions").

| Field | Required | What it controls |
| --- | --- | --- |
| `enabled` | required when the block is present | `true` reaches the API (dims stored at registration, facets on the lists) and `config.json` (filters in the UI). `false` validates the block and does nothing. |
| `labels` | optional | What the UI calls each dimension: `{ tenant?, project?, stage? }`, 1 to 30 characters each (synth check). Default "Tenant", "Project", "Stage". |
| `stages` | optional | Stage value → role-card silhouette, `{ "<stage>": "prod" \| "staging" \| "dev" \| "sandbox" }`, on top of the built-in map (`prod`/`live` → prod, `staging`/`test`/`qa`/`uat` → staging, `dev` → dev, `sandbox` → sandbox). Keys are lower-case letters and digits as they appear in names (synth check); an unlisted stage is a sandbox. |

## Other synth-time checks

- `addAccessPortal` fails when `network` is set but no `sites` were passed.
- `TargetAccountStack` fails when `env.account` is not a 12-digit account id.
- `webIdentityPrincipal` fails when the provider's issuer is a CloudFormation token; pass the provider from `createIssuerProvider()` or import one by ARN.
- `AccessPortalHub.controlUrl()` fails unless `fromAttributes()` was given `network: { zoneName, subdomain }`.

## Sample apps

Single-file CDK apps written the way a consuming developer writes them, in [`samples/`](https://github.com/FNTIO/aws-infrastructure-client/blob/main/samples/README.md):

| Sample | Shows |
| --- | --- |
| [01-hub-and-targets.ts](https://github.com/FNTIO/aws-infrastructure-client/blob/main/samples/01-hub-and-targets.ts) | The whole landscape: typed config to hub stacks, plus a stack per workload account and per connector VPC |
| [02-target-account-quickstart.ts](https://github.com/FNTIO/aws-infrastructure-client/blob/main/samples/02-target-account-quickstart.ts) | `TargetAccountStack` with `InfraClientRoles`, spread-tweaked and custom specs |
| [03-target-account-custom-roles.ts](https://github.com/FNTIO/aws-infrastructure-client/blob/main/samples/03-target-account-custom-roles.ts) | `createIssuerProvider` and `webIdentityPrincipal` on a hand-built `iam.Role` |
| [04-connector-quickstart.ts](https://github.com/FNTIO/aws-infrastructure-client/blob/main/samples/04-connector-quickstart.ts) | `ConnectorStack` wired entirely from `AccessPortalHub.fromAttributes` |
| [05-connector-in-existing-stack.ts](https://github.com/FNTIO/aws-infrastructure-client/blob/main/samples/05-connector-in-existing-stack.ts) | `TailnetConnector` and `SgManager` composed into an existing stack with your own `IVpc` |

They are illustrations; synthesizing or deploying them needs real accounts, zones and VPC ids.
