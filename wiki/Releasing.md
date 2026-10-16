How a release of `@fntio/infra-client` is cut and where it lands. There are three kinds of release artifact: the `@fntio/infra-client` npm package (stacks, prebundled Lambdas and the built web app in one tarball), the four plugin packages a plugin author installs beside it, and the desktop binary (one public, signed build for every deployment). The packages are published to npm; every artifact is also attached to a GitHub Release on this repository, one Release per version tag. This repository holds no source code: the product is built and tested from FNTIO's private source repository, whose `release` workflow publishes here. What shipped in each version is on [[Release Notes]].

## The artifacts

| Artifact | What it is | How it reaches people |
| --- | --- | --- |
| `@fntio/infra-client` | CDK stacks and constructs (compiled `dist/`), one prebundled folder per Lambda under `assets/`, the API's runtime dependencies as `assets/api/vendor_modules`, the built web app in `assets/web`, `openapi.yaml`, the consumer README | `npm install @fntio/infra-client` ([npm](https://www.npmjs.com/package/@fntio/infra-client)). The same version is attached to the GitHub Release as `fntio-infra-client-<version>.tgz` for deployments that vendor the package with a `file:` spec |
| `@fntio/infra-client-plugin-sdk`, `-plugin-cdk`, `-plugin-ui`, `-plugin-example` | The plugin SDK, `definePlugin`, the UI helpers and the reference plugin, each on its own version number | npm, and the `.tgz` files on the same Release |
| `infra-client-<version>-<arch>.dmg` (and `.zip`), `infra-client-<version>-<arch>.exe` | One macOS installer, signed and notarized, and one Windows installer, unsigned for now; both built from constants with no deployment config baked in | Attached to the Release, with the `latest-mac.yml` / `latest.yml` feeds and `.blockmap` files that installed apps poll to update themselves |

The package and the desktop app share one version number (from 0.1.14 on), and consumers never build anything: the frontend, API and stacks are always one version. The Release notes are the version's entry in [CHANGELOG.md](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/CHANGELOG.md), which also ships inside the package.

## Version numbers

Which number moves (`major.minor.patch`): a release with only bug fixes raises the right-hand number (0.2.0 → 0.2.1); a release that adds a feature raises the middle one and resets the right (0.2.1 → 0.3.0); a release that breaks something a deployment or plugin relies on (a removed or renamed config field, API route, export or plugin contract, or an upgrade that needs manual steps to avoid an outage) raises the left one and resets the others (0.3.0 → 1.0.0). The largest change in the release decides. The four plugin packages follow the same rule, each on its own number; a plugin package whose version did not move is not republished.

The bite risk is hub versus target-account skew. The issuer host is baked into every target's trust policy and targets deploy on other people's schedules, so the target-account surface is treated as near append-only: hub vN must work against target v1.

## How a release is cut

A release is a version tag in the private source repository. Its `release` workflow runs five jobs:

- `check`: the tag equals `v<package version>`, the desktop version matches, the changelog entry exists.
- `pack`: every workspace's test suite (including the cdk-nag gate, which synthesizes every hub stack and a target-account stack and fails on any unsuppressed finding), the typecheck sweep, the frontend's tests and build, then `npm pack` for the core and the plugin packages. Every tarball is then scanned: nothing deployment-specific (account ids, hostnames, addresses, customer names) and no link into a private path may ship.
- `mac`: the signed and notarized macOS installer, named `infra-client-<version>-<arch>.dmg`.
- `windows`: the Windows installer, unsigned for now, so the first launch goes through SmartScreen; see [Windows installer](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#windows-installer).
- `npm`: every tarball whose version is not on the registry yet is *staged* to npm through trusted publishing (no long-lived token exists). A staged version is not installable until a maintainer approves it with two-factor authentication, so nothing reaches the registry from automation alone.
- `release`: creates the GitHub Release for the tag on this repository, with the changelog entry as its notes, and attaches the core tarball, the four plugin tarballs, the dmg, the zip, the exe, and the update feeds. It refuses to run until this repository already carries the version's documentation (the CHANGELOG entry), which is pushed before the tag.

A failed release is not fixed by moving the tag; the fix ships as the next patch version. A version that reached npm is never replaced.

## Vendoring the tarball

Deployments that do not install from the registry commit the `.tgz` (for example under `vendor/`) and depend on `"@fntio/infra-client": "file:vendor/fntio-infra-client-<version>.tgz"`. Their upgrade is replacing the file and the version in that line, then `npm install`, `npx cdk diff DataStack CredsStack WebStack`, and deploying the three hub stacks together. Steps: [Install](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#install) and [Upgrade](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#upgrade). Moving from a vendored tarball to the registry is swapping the `file:` spec for a semver range.

## Desktop release

The desktop binary is built from constants (`PRODUCT_NAME`, `APP_ID` = `com.fntio.infra-client`) and reads no deployment config; branding comes from the connected backend at runtime. The `appId` and the update-feed repository are immutable once anyone installs: they anchor auto-update, the keychain and the data folder. Details: [Package (distribution)](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#package-distribution).

- **macOS:** signed with one Developer ID certificate and notarized; the first launch needs no "Open Anyway". The app polls this repository's Releases and installs updates by itself. The build is Apple-silicon only (`-arm64.dmg`).
- **Windows:** unsigned until a signing service is set up, so the app only announces a new version and opens the download page; see [Windows installer](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#windows-installer).

How an installed app updates itself, and why Windows only announces an update until its installer is signed, is in [Publishing](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#publishing). Passkeys and macOS auto-update only work in signed packaged builds; see [Passkeys (per platform)](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#passkeys-per-platform).

## Still open

1. A freshness guard in the package's `prepack`: it checks that a frontend build exists, not that it is current. The release workflow sidesteps this by building the frontend in the same job.
2. Snapshot tests per stack across representative configs.
3. The onboarding import CLI is not available to a package consumer.
4. A synthesized CloudFormation template of `TargetAccountStack` per release for StackSet delivery.
5. Windows code signing, and with it self-installing updates on Windows.
6. A compatibility test for the `/.well-known/infra-client` contract between an updated desktop app and older deployments.

See also [[Roadmap]].
