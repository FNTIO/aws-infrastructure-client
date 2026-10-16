`@fntio/infra-client` is a self-hosted AWS access portal delivered as CDK stacks and constructs. Your team signs in to a web app under your own domain, gets short-lived credentials for the AWS accounts and roles you allow, and optionally reaches private resources (databases, internal web servers) over a built-in VPN. Everything runs inside your own AWS accounts. You write one small CDK app, point it at a typed config object, and deploy; nothing is built on your machine, because the Lambda code is prebundled and the web app is already compiled. This page takes an engineer from an empty directory to a working credential vend. Each step links to the authoritative section of the package README.

## What you get

The package `@fntio/infra-client` (on npm; the same version is attached to each GitHub Release as `fntio-infra-client-<version>.tgz`) contains:

- `dist/`, the compiled stacks and constructs with `.d.ts` types. `import { ... } from "@fntio/infra-client"` is the whole import surface.
- `assets/`, every Lambda prebundled as a single `index.js` (the portal API with its `vendor_modules`, the issuer publisher and canary, reapproval sweeps, first-admin creation, the SSO pre-sign-up trigger, the shared plugin authorizer and the plugin catalog writer, and the VPN pieces: control-plane bootstrap, security-group automation, in-VPC DNS, key minting, ACL reconciler, the cross-region relay) plus `assets/web`, the built web app.
- `openapi.yaml`, the portal's HTTP API contract (OpenAPI 3.1).

The `config.json` the web app reads at runtime is generated from your config during the deploy, so the package never contains another deployment's values. TypeScript source is not in the package; the compiled stacks in `dist/` are readable as shipped (browse them at [unpkg.com/browse/@fntio/infra-client/](https://unpkg.com/browse/@fntio/infra-client/)).

Detail: [What is in the tarball](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#what-is-in-the-tarball).

## Requirements

| Need | Notes |
| --- | --- |
| Node.js 20 or newer and the AWS CDK CLI | On the machine you deploy from |
| `aws-cdk-lib` 2.263 or newer and `constructs` 10.x | Peer dependencies; the install step adds them |
| A hub AWS account with administrator credentials | The portal, sign-in, credential issuer and optional VPN control plane deploy here |
| A Route 53 hosted zone in the hub account | For a domain or subdomain you control, for example `access.acme.com`. The app, the sign-in page, the issuer and the VPN all get names under it. If your DNS is managed elsewhere, delegate one subdomain to Route 53 |
| CDK bootstrap in two regions of the hub account | Your deploy region and `us-east-1`; CloudFront only accepts certificates and WAF web ACLs from `us-east-1` |
| One workload account per set of roles | Each with its own credentials for the deploy |

Two AWS-side approvals take up to a day. File them before the first deploy:

- **Lambda concurrency raise** in the hub account. Fresh accounts cap concurrent executions at 10, and the deploy's own custom resources can hit that.

  ```bash
  aws service-quotas request-service-quota-increase \
    --service-code lambda --quota-code L-B99A9384 --desired-value 1000
  ```

- **SES production access** in the hub account, only if you set the `email` block. In the SES sandbox, mail reaches verified addresses only, and the first-admin invite is sent during the deploy.

Detail: [Requirements](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#requirements).

## Decisions you make once

A few values are baked into trust policies, resource names or device hostnames and cannot be changed later without breaking every connected account or enrolled device.

| Value | Where | Why it is permanent |
| --- | --- | --- |
| Issuer hostname | `issuer.domainName` | In every workload account's trust policy |
| Resource prefix | `resourcePrefix` | Names every cross-account resource |
| Role names | `rolesByAccount[*].roleName` | Pinned into each role's trust condition |
| VPN site ids | keys of `network.sites` | The login hostname of every enrolled device and connector |
| Hub account and region | `env` | Everything else derives from it |

Everything else, including the app's own web address, branding, login methods, and the list of sites and VPCs, changes with a redeploy. Every field is described in [[Configuration Reference]].

Detail: [Decisions you make once](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#decisions-you-make-once).

## Steps

### 1. Install the package

The package is public on npm; no token.

```bash
mkdir acme-access && cd acme-access
npm init -y
npm install @fntio/infra-client aws-cdk-lib constructs
npm install -D typescript ts-node @types/node aws-cdk
```

Deployment repositories that vendor dependencies instead download `fntio-infra-client-<version>.tgz` from the GitHub Release for that version, commit it (for example under `vendor/`) and depend on it with a `file:` spec; CI installs it like any other dependency. Moving between the two is swapping the `file:` spec for a semver range; nothing else changes.

Detail: [Install](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#install).

### 2. Lay out the deployment project

The project is `package.json`, `cdk.json`, `tsconfig.json`, `bin/app.ts` (the CDK app) and `config/project.ts` (everything specific to your deployment), plus `vendor/` if you vendor the tarball. `cdk.json` runs `npx ts-node --prefer-ts-exts bin/app.ts`; `tsconfig.json` needs `"module": "commonjs"`, `"target": "ES2022"`, `"strict": true`, `"esModuleInterop": true` and `"types": ["node"]`.

Detail: [Your deployment project](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#your-deployment-project).

### 3. Write the config file

`config/project.ts` is one exported `ProjectConfig` object. Every field is typed and documented in your editor, and values that would fail at deploy time (a trailing dot on a zone name, an account id that is not 12 digits, an overlapping VPC range between two connectors of a site) fail at synth with a plain error. The README carries a complete worked example to copy; [[Configuration Reference]] explains each block.

Detail: [The config file](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#the-config-file).

### 4. Write the app file

`bin/app.ts` turns the config into stacks: `addAccessPortal(app, { project, resourcePrefix, sites })` adds the hub stacks, `AccessPortalHub.fromAttributes(...)` describes the hub as workload accounts see it, and a loop over `rolesByAccount` creates one `TargetAccountStack` per workload account (plus one `ConnectorStack` per connector VPC when the VPN is on). Copy the README's `bin/app.ts` as-is; it is the whole integration. If you prefer to build the IAM roles yourself, `createIssuerProvider` and `webIdentityPrincipal` replace `TargetAccountStack`.

Detail: [The app file](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#the-app-file).

### 5. Bootstrap and deploy the hub

Bootstrap the hub account in your deploy region and in `us-east-1`, then deploy the hub stacks by name (`--all` would also try the workload-account stacks with the wrong credentials). The first run takes 15 to 30 minutes. While it runs, confirm the SNS subscription that lands in `alertEmail`, or alarms go nowhere. Commands and outputs are in [[Deploy and Upgrade]].

Detail: [Deploy](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#deploy).

### 6. Sign in as the first admin

The deploy creates the `firstAdmin` account in the admins group and emails it a set-your-password link. The `CredsStack.FirstAdminInviteSent` output says what happened: `sent` (check the inbox; the link is valid 7 days), `suppressed` (the account exists but the mail could not go out, almost always SES still in its sandbox; get production access or verify the address, then bump `firstAdmin.resend` and redeploy) or `already-active` (nothing to do). Removing the block later never deletes the account. Sign in at `WebStack.WebUrl`. On the first visit a **Customize theme** wizard offers to restyle the portal; anything set there overrides the deploy-time `branding` without a redeploy, and it stays available in the sidebar menu.

Detail: [Deploy the hub](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#2-deploy-the-hub) (the `FirstAdminInviteSent` outcomes).

### 7. Connect a workload account

Repeat this for each account your team needs. Bootstrap the account once and deploy its `AccessTarget-<account>` stack with that account's credentials. This creates an identity provider pointing at your issuer and the listed IAM roles trusting it, nothing else; nobody can use the roles until an admin grants them. Then, in the portal as an admin: **Accounts → Add account** with the account number and a friendly name, and add the roles you just deployed. Role names must match `rolesByAccount` exactly; the portal cannot verify them across accounts. Grant yourself one role, click **Get credentials** on its card, and run `aws sts get-caller-identity`. It should report the workload account.

Detail: [Connect a workload account](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#3-connect-a-workload-account).

### 8. Optional: turn on the VPN

Add a `network` block naming one site (one routing domain; most deployments need exactly one) and the VPCs it should reach, redeploy the hub, then deploy a `Connector-<account>` stack into each listed VPC with that account's credentials. Without the block nothing VPN-related deploys and the portal shows no Network pages; you can add it later. Back in the app, register private resources (host and port) on the **Network** page and grant them like roles. End users click **Connect**; a guided setup installs the standard Tailscale client on first use. See [[Private Network]].

Detail: [Join a VPC to the VPN](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#4-join-a-vpc-to-the-vpn-optional).

### 9. Optional: email from your own domain

With the `email` block set and SES production access approved, all portal mail (sign-in codes, password resets, invites) is sent from your `fromAddress`, and the DKIM, SPF and DMARC records are created in your hosted zone automatically; the block's presence is the whole feature. Omit it and the portal uses Cognito's built-in sender (about 50 mails a day).

Detail: the `email` block in [The config file](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#the-config-file). A fresh AWS account's SES is in its sandbox and only delivers to verified addresses; request production access before inviting real users.

### 10. Roll out to your team

Invite users from the **Users** page, individually or in bulk; invites are set-your-password links that expire after 7 days. Grant access per user or through groups (bundles of roles and resources); time-boxed and approval-based access are built in. A bulk import that seeds groups, resources, grants and invites for a whole existing organisation from one file is planned to ship with the package. The desktop app gives users the same portal under your branding plus credentials kept fresh in `~/.aws/credentials`, tray notifications before expiry, and one-click VPN.


Next: [[Deploy and Upgrade]]
