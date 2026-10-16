# @fntio/infra-client

A self-hosted AWS access portal, delivered as CDK stacks and constructs. Your
team signs in to a web app under your own domain, gets short-lived credentials
for the AWS accounts and roles you allow, and optionally reaches private
resources (databases, internal web servers) over a built-in VPN. Everything
runs inside your own AWS accounts.

This package is the whole product. You write one small CDK app, point it at a
typed config object, and deploy. Nothing is built on your machine: the Lambda
code is prebundled and the web app is already compiled.

- [What is in the tarball](#what-is-in-the-tarball)
- [Requirements](#requirements)
- [Install](#install)
- [Your deployment project](#your-deployment-project)
- [The config file](#the-config-file)
- [The app file](#the-app-file)
- [Deploy](#deploy)
- [Upgrade](#upgrade)
- [Decisions you make once](#decisions-you-make-once)
- [Security Hub](#security-hub)
- [Activity log](#activity-log)
- [Public API](#public-api)
- [Plugins](#plugins)
- [Plugin permissions](#plugin-permissions)
- [Bring your own web build](#bring-your-own-web-build)
- [HTTP API](#http-api)
- [License](#license)

## What is in the tarball

```
fntio-infra-client-<version>.tgz
└── package/
    ├── package.json
    ├── README.md                   this file
    ├── CHANGELOG.md                what each version changed
    ├── LICENSE                     Elastic License 2.0
    ├── openapi.yaml                the portal's HTTP API contract (OpenAPI 3.1)
    ├── dist/                       compiled stacks + constructs, with .d.ts types
    │   └── index.js                the import surface: import { ... } from "@fntio/infra-client"
    └── assets/
        ├── api/                    the portal API Lambda, prebundled
        │   ├── index.js
        │   └── vendor_modules/     its runtime dependencies (express and friends)
        ├── issuer-publish/         writes the OIDC discovery document + JWKS to the issuer bucket at deploy time
        ├── issuer-canary/          issuer health probe (alarms)
        ├── reapproval/             standing-access review sweeps
        ├── firstadmin/             creates the first admin during the deploy
        ├── federation-presignup/   SSO: Cognito pre-sign-up trigger that links a first federated sign-in to the invited user
        ├── plugin-authorizer/      plugins: the shared REQUEST authorizer on every plugin route
        ├── plugin-catalog/         plugins: writes each registered plugin's catalog record at deploy time
        ├── headscale-apikey/       VPN control-plane bootstrap
        ├── sg-manager/             VPN: per-resource security-group automation
        ├── tailnet-resolver/       VPN: in-VPC DNS for private names
        ├── keyminter/              VPN: device and connector key minting
        ├── acl-reconciler/         VPN: grants → network ACLs
        ├── invoke-relay/           VPN: the reconciler's relay to SG-managers and resolvers in another region
        └── web/                    the built web app (index.html, main-*.js, styles)
```

Every Lambda folder is a single `index.js` that CDK uploads as-is when you
synthesize. `assets/web` is served by `WebStack`; the `config.json` the app
reads at runtime is generated from your config during the deploy, so the
tarball never contains another deployment's values.

Source code (`.ts`) is not in the package. The compiled stacks in `dist/`
are readable as shipped (browse them at
[unpkg.com/browse/@fntio/infra-client/](https://unpkg.com/browse/@fntio/infra-client/));
the target-account stack a security team usually wants to read is
`dist/lib/target-account-stack.js` with `dist/lib/constructs/target-account-trust.js`.

## Requirements

- **Node.js 20 or newer** and the AWS CDK CLI on the machine you deploy from.
- **`aws-cdk-lib` 2.263 or newer and `constructs` 10.x** in your project.
  Both are peer dependencies; the install step below adds them.
- **A hub AWS account** with administrator credentials. The portal, sign-in,
  credential issuer, and optional VPN control plane deploy here.
- **A Route 53 hosted zone** in the hub account for a domain or subdomain you
  control, for example `access.acme.com`. The app, the sign-in page, the
  issuer, and the VPN all get names under it.
- **CDK bootstrap in two regions** of the hub account: your deploy region and
  `us-east-1`. CloudFront only accepts certificates and WAF web ACLs from
  `us-east-1`, so a small certificate stack always deploys there (the
  credential issuer's certificate lives in it).
- One workload account per set of roles you want to hand out, each with its
  own credentials for the deploy.

Two AWS-side approvals take up to a day. File them before the first deploy:

- **Lambda concurrency raise** in the hub account. Fresh accounts cap
  concurrent executions at 10, and the deploy's own custom resources can hit
  that.

  ```bash
  aws service-quotas request-service-quota-increase \
    --service-code lambda --quota-code L-B99A9384 --desired-value 1000
  ```

- **SES production access** in the hub account, only if you set the `email`
  block. In the SES sandbox, mail reaches verified addresses only, and the
  first-admin invite is sent during the deploy.

## Install

### From npm

```bash
mkdir acme-access && cd acme-access
npm init -y
npm install @fntio/infra-client aws-cdk-lib constructs
npm install -D typescript ts-node @types/node aws-cdk
```

Public package, no token. Pin the exact version in `package.json` if your
deployments are rolled out deliberately; `npm install @fntio/infra-client@<version>`
is the upgrade.

### From a tarball

Every version is also attached to its GitHub Release as
`fntio-infra-client-<version>.tgz` on
[FNTIO/aws-infrastructure-client](https://github.com/FNTIO/aws-infrastructure-client/releases),
for deployment repositories that vendor dependencies. Commit it and depend on
it with a `file:` spec; CI installs it like any other dependency.

```bash
mkdir vendor && cp ~/Downloads/fntio-infra-client-<version>.tgz vendor/
npm install ./vendor/fntio-infra-client-<version>.tgz aws-cdk-lib constructs
```

`package.json` then carries
`"@fntio/infra-client": "file:vendor/fntio-infra-client-<version>.tgz"`.
Upgrading is replacing the file and the version in that line; moving to the
registry is swapping the `file:` spec for a semver range.

## Your deployment project

```
acme-access/
├── package.json
├── cdk.json
├── tsconfig.json
├── bin/app.ts             the CDK app: hub stacks + one stack per workload account
├── config/project.ts      everything specific to your deployment, typed
└── vendor/                the tarball, only if you vendor it
```

`cdk.json`:

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/app.ts",
  "context": {
    "@aws-cdk/aws-iam:minimizePolicies": true,
    "@aws-cdk/core:defaultCrossStackReferences": "strong"
  }
}
```

`tsconfig.json` needs `"module": "commonjs"`, `"target": "ES2022"`,
`"strict": true`, `"esModuleInterop": true`, and `"types": ["node"]`.

## The config file

`config/project.ts` is one exported `ProjectConfig` object. Every field is
typed and documented in your editor. Values that would fail at deploy time
(a trailing dot on a zone name, an account id that is not 12 digits, an
overlapping VPC range between two sites) fail at synth with a plain error.

```ts
// config/project.ts
import * as iam from "aws-cdk-lib/aws-iam";
import { InfraClientRoles, type ProjectConfig } from "@fntio/infra-client";

const ZONE = { hostedZoneId: "Z0ABC12DEF34GH", zoneName: "access.acme.com" };

export const PROJECT: ProjectConfig = {
  projectName: "Acme Access",

  // The hub account. Explicit on purpose: nothing depends on whose
  // credentials run the synth.
  env: { account: "111122223333", region: "eu-central-1" },

  // true = tables (with point-in-time recovery and deletion protection), the
  // user pool, and the issuer signing keys are RETAINED on teardown, and every
  // hub stack gets termination protection. Use true for anything real.
  prod: true,

  // Ops alarms go here: one address or a list. AWS emails each address a
  // subscription confirmation on the first deploy. Click it or alarms go nowhere.
  alertEmail: "platform@acme.com",

  // Optional. Prefix for every by-name cross-account resource, 15 chars max.
  // SET ONCE before the first deploy; renaming later breaks all of them.
  // Default "infra-client".
  resourcePrefix: "acme-access",

  // PERMANENT. https://<domainName> is baked into every workload account's
  // trust policy. Changing it later breaks credential issuing everywhere.
  // keyVersions / signerVersion default to [1] / 1; they exist for key rotation.
  issuer: { ...ZONE, domainName: "issuer.access.acme.com" },

  // Sign-in methods. Every field is listed so none is missed; the first three
  // are the choices users see on the sign-in page.
  loginMethods: {
    password: true, // always on: Cognito requires it
    passkey: true, // Touch ID / Windows Hello / security keys; needs the `web` block
    emailOtp: true, // passwordless one-time code by email
    mfa: "optional", // TOTP on password sign-ins, "optional" | "required"; a password-only pool must set it
    threatProtection: false, // Cognito threat protection (PLUS plan, about $0.02 per active user); needs mfa
    federation: [], // your own OIDC provider(s): wiki Runbooks-Users, "Federated sign-in (SSO)"
  },

  // Created in the admins group by the deploy and emailed a set-your-password
  // link. Lowercase, a real mailbox. Bump `resend` to re-send an unclaimed invite.
  firstAdmin: { email: "you@acme.com" },

  // Optional. All portal mail (codes, invites, resets) from your own domain
  // via SES; DKIM/SPF/DMARC records are created for you. fromAddress must be
  // under zoneName. Omit to use Cognito's built-in sender (about 50/day).
  email: {
    ...ZONE,
    fromAddress: "no-reply@access.acme.com",
    fromName: "Acme Access",
    dmarcReportEmail: "platform@acme.com",
  },

  // Optional. The app on domainName, sign-in on authDomainName, which must be
  // a child of domainName. Omit to run on the CloudFront and Cognito default hosts.
  web: {
    ...ZONE,
    domainName: "access.acme.com",
    authDomainName: "auth.access.acme.com",
  },

  // Optional. WAF on CloudFront and the API. ON by default (about $26/month);
  // rateLimit = /api/* requests per client IP per 5 minutes before a 429 (one
  // office NAT is one IP, so size for the office); perTokenRateLimit = API
  // requests per bearer token per 5 minutes — a ceiling on a runaway or
  // leaked token, sized above the product's own bulk bursts.
  waf: { enabled: true, rateLimit: 5000, perTokenRateLimit: 2000 },

  // Optional. How long the activity log keeps each row (30–3650 days).
  // Default 400, which outlasts the yearly access review.
  audit: { retentionDays: 400 },

  // First impression only. Admins can restyle in the app afterwards.
  // brandShow: "logo" | "project" | "company" | "logo-and-project" | "logo-and-company".
  branding: {
    logoUrl: "https://acme.com/logo.svg", // or logoFile: "assets/logo.svg", a local file (no public URL)
    primaryColor: "#0E7490",
    accentColor: "#F59E0B",
    companyName: "Acme",
    brandShow: "logo-and-project",
  },

  // The roles users can get, per workload account. Deployed by
  // TargetAccountStack (see the app file) and registered in the portal's
  // Accounts page. Role names are pinned into trust policies: never rename.
  rolesByAccount: {
    "444455556666": [
      InfraClientRoles.READ_ONLY,
      InfraClientRoles.FULL_ADMIN,
      {
        ...InfraClientRoles.READ_ONLY,
        roleName: "InfraAuditor",
        description: "Read-only for the external audit team.",
      },
    ],
    "777788889999": [
      {
        roleName: "BillingViewer",
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName("job-function/Billing"),
        ],
      },
    ],
  },

  // Optional. The private network. Omit it and no VPN stack deploys and the
  // portal shows no Network pages. One site = one routing domain; most
  // deployments need exactly one. Site ids are PERMANENT once a device enrolls.
  network: {
    ...ZONE,
    subdomain: "network", // sites live at <site>.network.access.acme.com
    // containerInsights: true, // CloudWatch Container Insights on the VPN cluster; defaults to `prod`
    sites: {
      main: {
        displayName: "Acme",
        // Every account belongs to exactly one site.
        accounts: ["444455556666", "777788889999"],
        // Accounts allowed to run a connector (machine keys only).
        connectorAccounts: ["444455556666"],
        // VPCs joined by ConnectorStack, keyed by account. Drives the deploy
        // and the per-site CIDR overlap check. Add `region` for a VPC outside
        // the hub's region.
        connectorVpcs: {
          "444455556666": { vpcId: "vpc-0abc1234def567890", routes: ["10.20.0.0/16"] },
          // Several VPCs in one account: a list, every entry but one named — the
          // name suffixes that connector's hostname, stack id and function names.
          // "444455556666": [
          //   { vpcId: "vpc-0abc1234def567890", routes: ["10.20.0.0/16"] },
          //   { vpcId: "vpc-0def5678abc123456", routes: ["10.50.0.0/16"], name: "sandbox" },
          // ],
        },
        // Private DNS names resolved inside that VPC (its resolver = CIDR base + 2).
        splitDns: { "corp.internal": ["10.20.0.2"] },
      },
    },
  },
};
```

The blocks at a glance:

| Block | Required | Changeable later | What it controls |
| --- | --- | --- | --- |
| `projectName`, `env`, `prod`, `alertEmail` | yes | `prod` and `alertEmail` yes; `env` no | Identity of the deployment |
| `resourcePrefix` | no | **no** | Names of every cross-account resource |
| `issuer` | yes | **no** (`keyVersions`/`signerVersion` yes) | The credential issuer host every account trusts |
| `loginMethods` | yes | yes | Password, passkey, email code, TOTP second factor, threat protection, federated sign-in |
| `firstAdmin` | no | yes | The admin account the deploy creates |
| `email` | no | yes | Portal mail from your own domain |
| `web` | no | add yes; change or remove **no** in practice | Custom app and sign-in domains; also the passkey relying-party id (a change orphans every registered passkey) and the us-east-1 certificate `WebStack` imports across regions |
| `waf` | no | yes | Web ACLs on CloudFront and the API |
| `audit` | no | yes (rows already written keep their retention) | Activity-log retention |
| `branding` | yes (may be `{}`) | yes | Logo and colors until an admin restyles in-app |
| `rolesByAccount` | yes | add yes, rename **no** | Roles per workload account |
| `network` | no | add sites yes, rename site ids **no** | The VPN |
| `plugins` | no | yes (remove registrations one deploy before turning it off) | The customer-plugin runtime |

## The app file

`bin/app.ts` turns the config into stacks. The hub stacks and one small stack
per workload account live in the same app; deploys pick stacks by name and
run with that account's credentials.

```ts
// bin/app.ts
import { App } from "aws-cdk-lib";
import {
  addAccessPortal,
  AccessPortalHub,
  ConnectorStack,
  DEFAULT_RESOURCE_PREFIX,
  resolveSites,
  TargetAccountStack,
} from "@fntio/infra-client";
import { PROJECT } from "../config/project";

const app = new App();
const resourcePrefix = PROJECT.resourcePrefix ?? DEFAULT_RESOURCE_PREFIX;
const { account, region } = PROJECT.env;

// Validates the sites (slugs, one site per account, CIDR overlap) and fails
// the synth with the reason. Required whenever `network` is set.
const sites = PROJECT.network ? resolveSites(PROJECT.network) : undefined;

// The hub: DataStack, CredsStack, WebCertStack (us-east-1), WebStack, and
// NetworkStack when `network` is set. Deploy these with hub credentials.
addAccessPortal(app, { project: PROJECT, resourcePrefix, sites });

// The same hub as cross-account stacks see it: every well-known name and ARN
// derives from these attributes, so you never assemble one by hand.
const hub = AccessPortalHub.fromAttributes({
  account,
  region,
  resourcePrefix,
  issuerDomain: PROJECT.issuer.domainName,
  network: PROJECT.network
    ? { zoneName: PROJECT.network.zoneName, subdomain: PROJECT.network.subdomain }
    : undefined,
});

// One stack per workload account: an OIDC provider trusting the hub's ISSUER
// (never the hub account) plus the listed roles. Nothing else. Deploy each
// with that account's credentials.
for (const [targetAccount, roles] of Object.entries(PROJECT.rolesByAccount)) {
  new TargetAccountStack(app, `AccessTarget-${targetAccount}`, {
    env: { account: targetAccount, region },
    issuerUrl: hub.issuerUrl!,
    roles,
  });
}

// One stack per connector VPC (VPN only). The site decides its control plane
// and which key minter it may call.
for (const site of sites ?? []) {
  for (const [connectorAccount, vpcs] of Object.entries(site.connectorVpcs)) {
    for (const vpc of vpcs) {
      const suffix = vpc.name ? `-${vpc.name}` : "";
      new ConnectorStack(app, `Connector-${connectorAccount}${suffix}`, {
        env: { account: connectorAccount, region: vpc.region ?? region },
        hub,
        site: site.id,
        vpcId: vpc.vpcId,
        routes: [...vpc.routes],
        name: vpc.name,
      });
    }
  }
}
```

Prefer to build the IAM roles yourself? Skip `TargetAccountStack`: create the
provider once with `createIssuerProvider(scope, id, issuerUrl)` and use
`webIdentityPrincipal(provider, roleName)` as `assumedBy` on any `iam.Role`.
The role's `roleName` must equal the name passed to `webIdentityPrincipal`;
the trust policy pins it. The same applies to the VPN: `TailnetConnector` and
`SgManager` compose into a stack you already own instead of `ConnectorStack`.

## Deploy

### 1. Bootstrap the hub account, both regions

```bash
export AWS_PROFILE=acme-hub
npx cdk bootstrap aws://111122223333/eu-central-1
npx cdk bootstrap aws://111122223333/us-east-1
```

### 2. Deploy the hub

Deploy by name. `--all` would also try the workload-account stacks with the
wrong credentials.

```bash
npx cdk deploy DataStack CredsStack WebStack            # WebCertStack deploys as a dependency
npx cdk deploy NetworkStack                             # only with a `network` block
```

The first run takes 15 to 30 minutes; certificate issuing and DNS dominate.
While it runs, confirm the SNS subscription that lands in `alertEmail`.

When it finishes, read the outputs:

- `CredsStack.FirstAdminInviteSent`: `sent` means check the first admin's
  inbox (the link is valid 7 days). `suppressed` means the account exists but
  the mail could not go out, almost always SES still in its sandbox; get
  production access or verify the address, then bump `firstAdmin.resend` and
  redeploy. `already-active` means nothing to do.
- `WebStack.WebUrl`: your portal.

Sign in. The first admin is offered a theme wizard; anything set there
overrides the deploy-time `branding` without a redeploy.

### 3. Connect a workload account

```bash
export AWS_PROFILE=acme-sandbox
npx cdk bootstrap aws://444455556666/eu-central-1        # once per account
npx cdk deploy AccessTarget-444455556666
```

Then, in the portal as an admin: **Accounts → Add account** with the account
number and a friendly name, and add the roles you just deployed. Role names
must match `rolesByAccount` exactly; the portal cannot verify them across
accounts. Grant yourself one role, click **Get credentials** on its card, and
run `aws sts get-caller-identity`. It should report the workload account.

### 4. Join a VPC to the VPN (optional)

```bash
export AWS_PROFILE=acme-sandbox
npx cdk deploy Connector-444455556666
```

The connector looks the VPC up at synth, so the command needs credentials for
that account. A VPC outside the hub's region (`connectorVpcs.<account>.region`)
deploys there, so bootstrap the account in that region first
(`npx cdk bootstrap aws://444455556666/eu-west-1`). An account's second VPC
carries a `name` in config and deploys as `Connector-444455556666-<name>`.
Back in the portal, register private resources (host and port)
on the **Network** page and grant them like roles. End users click
**Connect**; a guided setup installs the standard Tailscale client on first use.

### Tear down

`npx cdk destroy` per stack, in reverse order. With `prod: true` every hub
stack has termination protection and the VPN load balancer has deletion
protection, so lift both first:

```bash
aws cloudformation update-termination-protection --no-enable-termination-protection --stack-name <stack>
aws elbv2 modify-load-balancer-attributes --load-balancer-arn <arn> --attributes Key=deletion_protection.enabled,Value=false
```

The tables, user pool, and signing keys are retained and must be deleted by
hand (tables keep deletion protection until you turn it off), and so is the
VPN control plane's EFS file system (Headscale state): delete its mount
targets, then the file system. A removed VPN site also leaves its API-key
secret (`<prefix>/headscale-apikey-<site>`) in Secrets Manager on purpose;
delete it once nothing uses that site.

## Upgrade

```bash
npm install @fntio/infra-client@<version>                # vendored: replace the .tgz and the file: spec, then npm install
npx cdk diff DataStack CredsStack WebStack               # review before anything changes
npx cdk deploy DataStack CredsStack WebStack
```

Deploy the hub stacks together. The web app and the API version together, and
if one stack fails partway, some admin pages error until the failed stack
deploys cleanly. Browsers and the desktop app can keep an old web bundle
cached for a while; desktop users quit from the tray icon and relaunch.

Workload-account stacks rarely need redeploying. Their job is deliberately
frozen so hub upgrades do not cascade into every account. Redeploy one when
you add or change its roles.

### Upgrading to 0.1.17 — the activity log and pop-up notifications

Nothing to migrate: older vend rows are read in the new shape. The deploy
adds one index to the audit table (`byActor`); it rides the normal hub
deploy. The reconciler writes VPN session, firewall-rule and connector rows
only after a manual `NetworkStack` deploy (it needs the table and the
retention in its environment). Set `audit.retentionDays` if the 400-day
default is not what your policy says; rows already written keep the
retention they were written with. Desktop users get the pop-up changes
(Windows toasts, click-to-open, wake refresh, VPN-drop notice) with the next
desktop build; the web app works with older shells.

### Upgrading to 0.1.16 — several connector VPCs per account

`connectorVpcs.<account>` may be a list, every entry but one carrying a
`name`. A single VPC per account needs nothing. Deploy `NetworkStack` first
(its reconciler now addresses each VPC's SG-manager and resolver by name), and
when an account gains a second VPC redeploy its existing `Connector-<account>`
alongside the new `Connector-<account>-<name>`: the existing SG-manager learns
which VPC is its own and answers `other-vpc` for groups elsewhere.

### Upgrading to 0.1.8 — the issuer moves onto CloudFront

The credential issuer (`https://issuer.<your zone>`) is served from a
private S3 bucket behind CloudFront instead of an API Gateway HTTP API. The
hostname, the signing keys and every workload account's trust are unchanged;
the deploy migrates in one CloudFormation update (new endpoint first, DNS
flipped in place, the API deleted last — about 15 minutes). Before you
deploy it:

- `us-east-1` must be CDK-bootstrapped in the hub account even if you run
  without `web` and with WAF off — the issuer's certificate now lives in
  the us-east-1 companion stack. Step 1 of "Deploy" covers it.
- Do not combine it with a `keyVersions` / `signerVersion` change.

After it: fetch `https://issuer.<your zone>/.well-known/openid-configuration`
and `…/.well-known/jwks.json`, then get credentials for one role from the
portal — that is the real proof (STS read the new JWKS). Delete the old
regional ACM certificate if CloudFormation left it behind, and suppress the
new CloudFront.17 finding for the issuer distribution if you run Security
Hub ("Security Hub" below). With WAF on, a third web ACL `<prefix>-issuer`
appears — observe-only, it never blocks, about $8/month.

## Decisions you make once

| Value | Where | Why it is permanent |
| --- | --- | --- |
| Issuer hostname | `issuer.domainName` | In every workload account's trust policy |
| Resource prefix | `resourcePrefix` | Names every cross-account resource |
| Role names | `rolesByAccount[*].roleName` | Pinned into each role's trust condition |
| VPN site ids | keys of `network.sites` | The login hostname of every enrolled device and connector |
| Hub account and region | `env` | Everything else derives from it |

Everything else — branding, login methods, the list of sites and VPCs —
changes with a redeploy. The app's own web address (`web`) can be added
later, but changing or removing it orphans registered passkeys (see the
config table).

## Security Hub

Deployments pass the AWS Foundational Security Best Practices controls that
apply to their resources by construction, or with `prod: true`. A few are
deliberate cost trade-offs or by-design exceptions (CloudFront distributions
without origin failover or signed-URL key groups) that you suppress once per
account. The source repository's runbook lists every control and its status
under "Security posture" in the deployment README.

## Activity log

Every action that changes or uses access writes one row to the audit table:
who did it (a person, a service user, or `system:reapproval`,
`system:reconciler`, `system:deploy`, `system:expiry`), the action
(`object.verb`: `role.grant`, `request.approve`, `credentials.vend`,
`vpn.connect`, `admin.access`, …), whom or what it was about, the outcome
(`OK`, `DENIED`, `FAILED`) and a caller-safe reason. Group, cascade and bulk
changes also write derived rows per affected person (`access.gain`,
`access.lose`) from the same effective-access diff that produces the bell's
notices, linked to the primary row by a batch id — one per target, or one
per person carrying a `count` when a group or cascade change moves more than
five targets for them (the same threshold bundles the bell notice). The actor is bound per
request by the auth middleware and per job by the Lambda entry point; services
never take an actor parameter, so a row cannot name the wrong identity.

The log is advisory: nothing reads it to decide access. It is read by the
Activity page (`GET /admin/audit`, filters and a time cursor), by the yearly
review for a role's usage count, and by the setup checklist. Retention is
`audit.retentionDays` (30–3650, default 400). VPN sessions, firewall rules
and connector changes come from the reconciler's five-minute pass (five-minute granularity,
derived from Headscale's online state, so they cover every client). Refused
admin calls and refused plugin calls are rows too; anonymous 401s, reads and
preferences are not, and neither is a catalog or branding save that changes
nothing. A direct revoke whose access continues through a group names the
group(s) on its row. Name lists on a row (`affected`, `unchanged`) stop at 50
entries with the full count kept — the per-user rows carry every person;
reasons are cut at 300 characters and notes at 500. `GET /admin/access-report`
exports the current state the log explains: one CSV row per person and target
they hold.

## Public API

Everything a consuming CDK app needs is exported from the package root. Deep
imports into `dist/` are not part of the contract.

| Export | Kind | Use |
| --- | --- | --- |
| `ProjectConfig`, `SiteConfig` | types | Your config file |
| `addAccessPortal(scope, props)` | function | The hub stacks, written into your app |
| `AccessPortalHub.fromAttributes(attrs)` | class | The hub as cross-account stacks see it: `issuerUrl`, `controlUrl(site)`, `connectorKeyMinter(scope, site)`, `aclReconcilerPrincipal()`, `aclReconcilerRelayPrincipal()` (what an SG-manager or resolver outside the hub's region trusts) |
| `resolveSites(network)` | function | Validated, deploy-ready sites for `addAccessPortal` and `ConnectorStack` |
| `TargetAccountStack` | stack | Trust plus roles in a workload account |
| `InfraClientRoles`, `TargetRoleSpec` | constants, type | `READ_ONLY`, `POWER_USER`, `FULL_ADMIN`; plain data you can spread and tweak |
| `createIssuerProvider`, `webIdentityPrincipal` | functions | Hand-built roles trusting the issuer |
| `ConnectorStack` | stack | One VPC joined to the VPN (`name` tells an account's second VPC from its first) |
| `TailnetConnector`, `SgManager`, `TailnetResolver` | constructs | The connector pieces for a stack you already own |
| `DataStack`, `CredsStack`, `WebStack`, `WebCertStack`, `NetworkStack` | stacks | The hub stacks individually, if you need to reach into one |
| `WebAcl`, `WafConfig`, `WafLimits` | construct, types | The WAF pieces |
| `DEFAULT_RESOURCE_PREFIX`, `assertValidResourcePrefix`, the `*FnName` and `*RoleName` helpers | constants, functions | The raw by-name contracts, for consumers who need the names |

Opinionated only where the security model requires it: the trust conditions
(`aud` plus a role-scoped `sub` pin), role name equals the pinned name, the
`connector-<account>[-<name>]` hostname contract, and the well-known resource names.
Everything else is ordinary CDK. `TargetRoleSpec.maxSessionDuration` defaults
to 12 hours; the per-role session length an admin sets in the portal is the
effective limit.

## Plugins

Customer plugins are small apps a deployment bolts onto the portal: a
frontend of any framework shown in an iframe, Lambda routes behind the
portal's authorizer, and two permission levels (`user`, `admin`) granted from
the usual Users and Groups screens. The permission rules are in
[Plugin permissions](#plugin-permissions); this section is the deploy side.

**Trust model, before turning it on.** A plugin page is served from the
portal's own origin and framed without a sandbox (the design the epic
chose so the page can use the portal's session directly). That means an
installed plugin runs with the signed-in user's full authority: it could
read the portal's tokens, call any core API as that user, and on the
desktop reach the shell bridge. The `user`/`admin` permissions decide who
sees a plugin, not what its code may do. Install plugins you would trust
with the portal bundle itself, and review their dependencies the same way.
A Content-Security-Policy on `/plugin-assets/*` lets a plugin page load
from and talk to the portal only (no third-party scripts, no sending data
elsewhere); the app pages send their own enforced policy (the portal, the
region's Cognito API and the hosted-UI domain).

**Turn the feature on** with a `plugins` block in the config:

```ts
plugins: { enabled: true },            // discoveryRefreshSeconds: 60 by default (15–300)
accountDimensions: { enabled: true },  // tenant/project/stage off account names; labels + stage map optional (wiki: Configuration Reference)
```

`enabled: true` creates the `/api/plugins/…` route tree on the core API (the
core keeps every other `/api/*` path), the `/plugin-assets/*` CloudFront
behavior (same-origin framing allowed, no SPA rewrite), the discovery
settings the portal reads, and, per registered plugin, the asset upload and
the catalog record. Off or absent: none of that exists, and any plugin
permission rows stay dormant. The catalog table itself always exists, so
flipping the flag never adds or removes a cross-stack export. Registrations
passed while the flag is off fail at synth.

**Register a plugin** by passing `definePlugin(...)` results (from
`@fntio/infra-client-plugin-cdk`) to `addAccessPortal`:

```ts
addAccessPortal(app, { project, resourcePrefix, plugins: [parameters] });
```

Composing the stacks yourself? `resolvePlugins`, `PluginApi` and `PluginCatalogActivation` are exported; all
three live on the CredsStack side.

**What a deploy does, in order.** Handler factories run inside CredsStack and
each route becomes a gateway method under
`/api/plugins/<id>/accounts/{accountNumber}<path>`; the plugin's resource
carries the shared REQUEST authorizer as its default, so every method under it
is authorized by construction (result cache 0). The UI uploads to the plugin-assets bucket
(DataStack) under `<id>/<version>-<hash>/`, served as `/plugin-assets/…`; the
hash is the content hash, so changed bytes under the same version get a new
URL, and earlier revisions are never pruned. Last, a
`Custom::PluginCatalogRecord` in CredsStack writes the catalog row, after the
upload, the API stage and the plugin's methods. Because it depends on the
methods, CloudFormation also tombstones it *before* removing them. Rollback of
a failed activation restores the previous record through the same provider.

One routing fact to know. Express owns `/api/plugins` (every verb) and any
path under it that no registered method claims — an unknown plugin id, and an
unmatched path under a registered one, both reach the core app and get its
JSON 404. A plugin's handler is reachable only through a method it registered,
which is what stops an unknown route touching plugin code.

**Authorization.** The shared REQUEST authorizer
(`lambdacode/plugins/authorizer.ts`) runs on every plugin method with a zero
result cache. It verifies the bearer token with the verifier Express uses
(`services/tokenVerifier.ts`: a Cognito ID token for people; an access token
with the service scope plus a live registry row for service users, read
strongly consistently through `services/serviceUserRegistry.ts`), resolves the route
from the catalog by method and gateway resource template, takes the account
from the `{accountNumber}` path parameter, and asks `checkPluginPermission`.
Nothing the client names is trusted. Missing or invalid credentials: 401.
Authenticated but no available grant, an unknown route or method, a
malformed account or resource, a disabled or removed plugin: 403 (a `Deny`
on the invoked method ARN; `context.reason` says why). Signing keys or a
table unreachable: the gateway's 5xx. None of the three invokes the handler.
An allow is scoped to the exact method ARN and carries the typed context
(`PluginAuthorizerContextV1`: plugin, revision, route, account, required
permission, subject, principal type, correlation id), never a token. Every
decision is one JSON line in the authorizer's log group. Revocation limits:
a check that begins after a revoke completed sees it; a request already
authorized finishes; an accepted job runs until the plugin's own cancellation
rules stop it; there is no atomic snapshot across unrelated concurrent grant
edits.

Two more limits worth knowing. A deploy that adds a route makes the gateway
method live before the catalog record naming it: calls to the new route answer
403 `route-unknown` until the activation resource completes, which is why the
UI that uses a new route ships in the same deploy rather than ahead of it. And
the authorizer only reads, so a service user that calls nothing but plugin
routes never advances its `lastUsedAt`; the access reviews see it as unused
even while it works.

**Update, disable, remove, reinstall.** Changing the definition rewrites the
record with a new revision. `enabled: false` on a plugin keeps everything but
suppresses discovery and denies calls. Removing the registration tombstones
the record (labels kept, grant rows kept, holders noticed), then the routes
and assets go. Registering the same id again restores still-valid grants on
purpose. Records are owned by the CloudFormation stack that wrote them; a
different stack claiming an installed id fails the deploy with "already
installed by …" — if that is you after moving the activation to another stack,
delete the row from the catalog table by hand (`aws dynamodb delete-item`) and
redeploy. To switch the whole feature off, remove the registrations first (one
deploy), then set `enabled: false`; the table and bucket stay, with their
exports, so that second deploy cannot fail on an export in use.

**Handlers and IAM.** Plugin Lambdas live in the hub account and region and
run under the execution role you give them; core grants decide who may call
a route, your IAM decides what the handler may touch. Every Lambda that reads
the catalog also gets the Accounts table name and read access (the API
handler, the reapproval sweeper, the catalog provider) — `pluginRuntimeEnv`
and `grantPluginRuntimeRead` are exported for custom compositions.

**Packaging.** The compiled stacks import `@fntio/infra-client-plugin-sdk`,
which ships inside this package's tarball (bundled dependency), so a vendored
tarball install keeps working with no second package to fetch. A
plugin author's own code imports the SDK directly, so they install the plugin
tarballs too: every GitHub Release from v0.1.18 carries them beside this one.

## Plugin permissions

Customer plugins (Epic 5) hold their grants in the same Access table as roles,
as `plugin#<pluginId>#<accountNumber>#<user|admin>` rows on users and groups.
What such a row *means* is decided in one place, `lambdacode/api/services/pluginAccess.ts`:

- **Availability.** A row authorizes only while the plugin's catalog record is
  installed and enabled, the permission is declared by the plugin, and the
  account is both bound by the plugin and registered in the Accounts catalog.
  A row that fails any of these is *dormant*: visible and revocable in the
  grant editor, never authorizing, never renewable.
- **Implication.** `admin` includes `user` only when the plugin declares
  `user`. It is applied when capabilities are derived, never stored, so an
  admin grant is stored as admin and a user capability may cite it.
- **No bypass.** App admins and service users are ordinary principals here;
  a service user's grants live on its own `user#<clientId>` rows.
- **Notices.** Loss notices for plugins diff *available capabilities*, not
  rows: revoking a user row while an admin row still implies it is silent;
  a plugin going dormant is a `PLUGIN` revocation (`via: CASCADE`).
- **Retention.** Removing or disabling a plugin keeps its rows so that
  re-enabling or reinstalling the same id deliberately restores still-valid
  access; deleting an account removes that account's plugin rows (with
  notices) like the role cascade does. The yearly review sweep raises
  reviews only for available rows, but a review already open on a row that
  went dormant still lapses, and approving a review of a dormant row is
  refused (409).
- **Reads on the authorization path** are strongly consistent (catalog,
  accounts, access), with unprocessed batch keys retried a bounded number of
  times and never read as "no grant".

**Two discovery views, on purpose.** `GET /api/plugins` answers the signed-in
caller: only plugins where they hold an available capability, only the UI
entries whose own permission is available somewhere, and account names from the
Accounts catalog, so someone holding nothing but a plugin grant still sees the
account. It is per-caller and never cached. `GET /api/admin/plugins` answers the
grant editor: every definition, including disabled, unavailable and tombstoned
ones, independent of the admin's own plugin grants, so a binding nobody holds
yet is still assignable. Neither returns handler internals, and an empty list
always means empty — a storage failure is an error, never a fabricated empty
catalog.

**Assignment and review operations.** Admins assign and revoke on
`/api/admin/plugins/{pluginId}/accounts/{accountNumber}/grants`: `PUT` with a
principal (`{kind:"user",userId}` or `{kind:"group",groupId}`), a permission and
an optional `durationHours` for users; `DELETE` with the principal and
permission. Both are idempotent. Assignment refuses an unavailable binding (409),
an unknown plugin or unbound account (404), and an undeclared permission or a
group expiry (400). Revocation is unconditional on purpose, so a stale row on a
disabled or removed plugin stays removable. A user's plugin access has its own
view, `GET /api/admin/users/{userId}/plugin-grants`, alongside the resource-grants
one; a group carries its plugin references in the groups list. Either way one call
covers every plugin, so no page sweeps per-plugin endpoints, and a plugin problem
never takes a user's role grants down with it. Plugin rows join the
existing yearly review lifecycle: reviews are raised only for available rows,
approving a review of a dormant row is refused (409), and losing a capability
produces the usual revocation notice.

The catalog is deployment-written; how it gets there is [Plugins](#plugins).

## Bring your own web build

`addAccessPortal` accepts `webAssetPath`, a directory with an `index.html`,
to serve a web bundle other than the one baked into the package. The deploy
still generates `config.json` from your config, so the bundle must be a build
of this product's frontend, not an arbitrary site.

## HTTP API

`openapi.yaml` in the package root describes every route of the portal API
(OpenAPI 3.1): the two token kinds (a Cognito ID token for people, a
`client_credentials` access token for service users, who are admins),
request and response shapes, and status codes. The route inventory is
drift-tested against the mounted routes in the package's test suite; the
shapes are maintained by hand alongside the code. Requests go to
`https://<web domain>/api/…`.

## License

Elastic License 2.0. Commercial use is allowed; offering the product to
third parties as a managed or hosted service is not.
