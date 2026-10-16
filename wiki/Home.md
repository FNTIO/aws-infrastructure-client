`@fntio/infra-client` is a self-hosted AWS access portal: one npm package of CDK stacks, prebundled Lambdas, and a built web app that a team deploys into its own AWS account to vend short-lived credentials and console sessions across accounts, manage who may assume what, and optionally reach private VPC resources over a built-in VPN. A signed desktop client writes vended credentials to the machine and connects to the VPN. This wiki is the orientation layer: each page gets you to the point where the repo's READMEs make sense, then links to the authoritative section.

## Start here

| If you are | Read |
| --- | --- |
| Standing up your own deployment | [[Getting Started]], then [[Configuration Reference]] and [[Deploy and Upgrade]] |
| Upgrading a deployment | [[Deploy and Upgrade]] (version-specific notes) and [[Release Notes]] |
| Reviewing how it works or whether it is safe | [[Architecture]], [[Access Model]], [[Security Posture]] |
| Running a deployment day to day | [[Runbooks]] and [[Troubleshooting]] |
| Adding a VPC or a site to the VPN | [[Private Network]] |
| Changing the code | [[Development Setup]], [[Releasing]], [[Roadmap]], and [CONTRIBUTING.md](https://github.com/FNTIO/aws-infrastructure-client/blob/main/CONTRIBUTING.md) |

## What ships

| Deliverable | Where | Audience |
| --- | --- | --- |
| The npm package `@fntio/infra-client`: stacks, constructs, Lambda bundles, the web app | [npm](https://www.npmjs.com/package/@fntio/infra-client), and the `.tgz` on each [Release](https://github.com/FNTIO/aws-infrastructure-client/releases); reference: the [package README](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md) | Every deployment depends on it |
| The desktop client, one public signed binary | The `.dmg` and `.exe` on each [Release](https://github.com/FNTIO/aws-infrastructure-client/releases); reference: [desktop/README.md](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md) | End users of any deployment |

## Where the documentation lives

| Place | What it holds |
| --- | --- |
| This wiki | Orientation pages, kept short, linking to the sources below |
| [Package README](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md) | The consumer reference: tarball contents, config file, app file, deploy and upgrade steps. Ships inside the package |
| [[User Guide]], [[Admin Guide]], [[API Integration]] | Using the portal as a developer, as an admin, and from another system |
| [[Runbooks]] | Every operational runbook: users, service users, issuer, network, day-two operations |
| [frontend/README.md](https://github.com/FNTIO/aws-infrastructure-client/blob/main/frontend/README.md), [desktop/README.md](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md) | Engineering docs for the web app and the desktop client |

## How this wiki is maintained

The pages are files in the repo's [wiki/](https://github.com/FNTIO/aws-infrastructure-client/tree/main/wiki) folder. A workflow mirrors that folder into the GitHub wiki on every push to `main`, after checking that every link and heading anchor resolves. Edit the files in the repo (a commit or a PR); anything typed into the wiki web UI is overwritten by the next sync. Pages carry no deployment-specific values (account ids, customer names, internal hostnames) because the wiki becomes public with the repo.
