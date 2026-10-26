Where the product is going: the vision, the four epics and where each stands, and what comes next on the packaging side. This page is the public summary of the product roadmap the product owner maintains; when the two disagree, that source wins. Release mechanics are on [[Releasing]]; what has shipped per version is on [[Release Notes]].

## Vision

Infra Client is a platform for handing out short-lived AWS credentials and connecting developers to private cloud resources. The foundation is the credential-vending API (Cognito → KMS-signed OIDC web identity → STS); everything else builds on it. FNTIO develops it for enterprise customers, and one deployment ("project") serves one customer project. A customer's platform team writes a small CDK app against the package to deploy the hub into their hub AWS account and the auditable trust and connector stacks into their workload accounts. The repo is headed for public, source-available release, with FNTIO's own deployment config moving to a private repo; end-user docs are to be baked into the web UI and developer docs published on a docs site.

The distribution model settled with it:

| Piece | How it ships |
| --- | --- |
| Stacks, constructs, API and issuer Lambdas, web frontend | One npm package, `@fntio/infra-client`, all in one version; Lambdas prebundled, frontend built in |
| Web frontend styling | Per deployment, through configuration and the in-app theme wizard; never a fork, and no customer runs an Angular build |
| Electron client | Built, signed and notarized once by FNTIO and publicly downloadable; adopts the connected deployment's styling at runtime (a per-client-installer detour was reversed) |
| This repo | Public and source-available under the Elastic License v2: commercial use allowed, no resale |

## The four epics

| # | Epic | Status |
| --- | --- | --- |
| 1 | Credential Vending / User Management API | Shipped, largely done; hardening ideas remain |
| 2 | Web Application for User Management / Credential Vending | Shipped and in progress: live on S3 + CloudFront, feature work continues |
| 3 | Desktop App (Electron, multi-backend) | Shipped: v0.1 (2026-07-22); a signed macOS installer ships on every Release since 0.1.14 and updates itself from the Release feed since 0.4.0 (feed on the public repository since 0.5.0); Windows self-install waits on a signed installer, and the discovery-URL registry remains to harden |
| 4 | Private VPC Access (Tailscale-like) | Shipped: slices 1 to 5 verified (2026-07-27); per-site control planes deployed and verified (2026-08-13) |

Each epic keeps a scope statement, an implementation log, a decision log and an ideas list with the product owner.

### 1. Credential Vending / User Management API

A Cognito-authenticated TypeScript Express REST API in Lambda behind API Gateway that vends short-lived credentials for roles the caller may assume, same-account or cross-account, via a KMS-signed web-identity JWT and `sts:AssumeRoleWithWebIdentity`. Delivered: the data model in a separate `DataStack`; user endpoints (allowed accounts and roles, vend, console sign-in URL); self-service access requests with an admin approve/deny queue; full admin CRUD for accounts, roles and grants; groups and bulk operations; temporary grants with an expiry-notice feed and yearly reapproval; an append-only vend audit log; cross-account trust via the target-account stack; a Jest suite. The latest logged work stabilized the issuer domain so cross-account trust can no longer drift. How access is decided today is on [[Access Model]].

### 2. Web application

The browser frontend so admins and users no longer need `curl`. Users sign in through a branded multi-method chooser (password, passkey, passwordless email code, or the customer's own OIDC identity provider via `loginMethods.federation`; social sign-in is not provisioned), see the accounts and roles they may assume, vend credentials, open the console, and request roles. Admins manage the catalog, roles, grants, users and groups, and review the request queue. The latest logged change moved sign-in in-app and retired Cognito's hosted Managed Login.

### 3. Desktop app

An Electron shell that connects to several backends at once, performs the Cognito login per backend, and writes vended credentials into `~/.aws/credentials` as named profiles, refreshing them before expiry. v0.1 is a thin remote-load shell: each backend is a tab loading that deployment's live web app in an isolated session, with a single serialized writer owning the credentials file. Latest logged work: shell hardening (https-only backends, popups denied). See [[Architecture]] for how the shell and the web app fit together.

### 4. Private VPC access

A Tailscale-like way for developers to reach private VPC resources (databases, internal services) from their machines, governed by the same identity and grant model as vending. A self-hosted Headscale control plane and per-VPC Fargate connectors are live; reachability is driven by grants through an ACL reconciler. The latest logged work implemented per-site control planes (sites), deployed and verified with two sites. Operating it: [[Private Network]].

## What is next

### Epic order

The sequencing in the source: finish hardening Epic 1 (the contract every client depends on), then the web app (the fastest path to making the platform usable by admins), then the desktop app (the day-to-day developer workflow), then VPC access (the largest scope, which benefits from the auth and session machinery of epics 2 and 3). Epics 2 and 3 can proceed in parallel once the API surface is considered stable.

### Packaging and distribution

With all four epics shipped in some form, the nearest work is packaging, nearest first:

1. Publish the package: the tarball is pack-ready; the remaining items (prepack freshness guard, snapshot suite, the import CLI, a StackSet template) are listed on [[Releasing]].
2. Desktop release pipeline: done since 0.5.0 (signed, notarized and published once per release; GitHub Releases plus electron-updater). Left: a compat test for the `/.well-known/infra-client` contract.
3. Going public: move `infra/` to a private repo, seed a fresh public repo from a cleaned snapshot, split `docs/` by audience.
4. Documentation: a developer docs site seeded from the getting-started narrative and the package's TSDoc, and end-user docs inside the web UI.

The packaging plan's own sequencing has the first three steps done (the portal seam, prebundled Lambdas with the baked frontend, the workspace split with samples). Open, in order:

- Snapshot suite and npm publish pipeline (org, provenance, dist build).
- Desktop sign/notarize/release pipeline, the `appId` decision (settled) and the compat test.
- Public-repo preparation (private infra repo, cleaned snapshot, docs split) and the developer docs site.
- Catalog seeding and StackSet delivery.
- End-user docs in the UI.

The first three of those can run in parallel; public-repo preparation gates any public announcement.

Two design questions stay open: `rolesByAccount` needs manual sync with the roles catalog, and adding a connector account needs a hub redeploy.

## About this page

The roadmap and the packaging plan, with their dated decision logs, are maintained by the product owner; this page is the public summary. Epic status lines come from each epic's scope statement and implementation log.
