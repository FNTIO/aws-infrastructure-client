# aws-infrastructure-client

`@fntio/infra-client` is a self-hosted AWS access portal: one npm package of
CDK stacks, prebundled Lambdas and a built web app that a team deploys into
its own AWS account to vend short-lived credentials and console sessions
across accounts, manage who may assume what, and optionally reach private
VPC resources over a built-in VPN. A signed desktop client writes vended
credentials to the machine and connects to the VPN.

This repository is the product's public home: the [Releases](https://github.com/FNTIO/aws-infrastructure-client/releases),
the [wiki](https://github.com/FNTIO/aws-infrastructure-client/wiki), the
issue tracker and the consumer documentation. The TypeScript source is
maintained in a private repository; everything that ships is readable as
published (see "What is public" below).

## Install the package

```bash
npm install @fntio/infra-client aws-cdk-lib constructs
```

Start with [Getting Started](https://github.com/FNTIO/aws-infrastructure-client/wiki/Getting-Started),
then the [package README](packages/infra-client/README.md) for the config
file, the CDK app and the deploy steps. Plugin authors install
`@fntio/infra-client-plugin-sdk`, `-plugin-cdk` and `-plugin-ui` beside it;
the reference plugin is `@fntio/infra-client-plugin-example`
([guide](packages/infra-client-plugin-example/README.md)).

Every version is also attached to its GitHub Release as a `.tgz`, for
deployments that vendor the package instead of installing from the registry.

## Install the desktop client

Download the installer for your platform from the latest
[Release](https://github.com/FNTIO/aws-infrastructure-client/releases/latest):
`infra-client-<version>-arm64.dmg` for macOS (signed and notarized; the app
updates itself from this repository's Releases) or
`infra-client-<version>-x64.exe` for Windows (unsigned for now, so the first
launch is a SmartScreen click-through; the app announces new versions and
opens the download page). One binary serves every deployment: on first
launch you enter your portal's URL.

## What is public

| Path | What it holds |
| --- | --- |
| [wiki/](wiki/) | Source of the wiki: getting started, configuration reference, deploy and upgrade, architecture, access model, runbooks, troubleshooting. Mirrored to the wiki on every push; edit here, not on the wiki site |
| [packages/infra-client/README.md](packages/infra-client/README.md), [CHANGELOG.md](packages/infra-client/CHANGELOG.md), [openapi.yaml](packages/infra-client/openapi.yaml) | The consumer reference that ships inside the package, what each release changed, and the portal's HTTP API contract |
| [packages/infra-client-plugin-example/README.md](packages/infra-client-plugin-example/README.md) and the other `packages/*/README.md` | The plugin author's guide and the READMEs of the plugin packages |
| [samples/](samples/) | Five consumer-voice CDK apps importing the package |
| [desktop/README.md](desktop/README.md), [frontend/README.md](frontend/README.md) | How the desktop client and the web app behave, are signed, update themselves, handle passkeys |
| [.github/](.github/) | Issue forms, the label taxonomy, the wiki sync |

The compiled stacks and constructs are in the package's `dist/` folder,
browsable at [unpkg.com/browse/@fntio/infra-client/](https://unpkg.com/browse/@fntio/infra-client/).
The target-account stack a security team usually wants to read is
`dist/lib/target-account-stack.js` with `dist/lib/constructs/target-account-trust.js`.

## Releases

One GitHub Release per version, `v<version>`, carries the package tarball,
the four plugin tarballs, the macOS installer (`.dmg` and `.zip`), the
Windows installer (`.exe`) and the desktop update feed (`latest-mac.yml`,
`latest.yml`, `.blockmap`), with that version's changelog entry as notes.
The same versions are published to npm under the `@fntio` scope. How a
release is cut is on the wiki's [Releasing](https://github.com/FNTIO/aws-infrastructure-client/wiki/Releasing) page.

## Issues, questions, contributions

Open an [issue](https://github.com/FNTIO/aws-infrastructure-client/issues/new/choose)
using the matching form, or a [discussion](https://github.com/FNTIO/aws-infrastructure-client/discussions)
for questions. Documentation fixes are pull requests against `wiki/`,
`samples/` or the READMEs here; [CONTRIBUTING.md](CONTRIBUTING.md) has the
rules and the label taxonomy. Vulnerabilities go through
[SECURITY.md](SECURITY.md), never an issue.

## License

Elastic License 2.0 — see [LICENSE](LICENSE). Commercial use is allowed;
offering the product as a managed or hosted service is not.
