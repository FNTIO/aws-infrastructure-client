How to set up a machine to work on this repo: the tools you need, how the workspaces fit together, the build order that every `cdk` command depends on, how to run each part (package tests, deploy app, web frontend, Storybook, end-to-end tests, desktop app), and the checks to run before a commit. For what the repo ships and how it is released see [[Releasing]]; for the system itself see [[Architecture]].

## Prerequisites

- Node.js 20 or newer (`engines` in the package). CI and the reference machine run Node 22 LTS.
- The AWS CLI and the AWS CDK CLI, for anything that deploys. `aws-cdk-lib` 2.263 or newer and `constructs` 10.x are peer dependencies of the package; see [Requirements](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#requirements).
- AWS profiles: one profile per account. Deploys export `AWS_PROFILE` for the hub account before running `cdk` there, and switch to a workload account's profile for that account's target and connector stacks.
- The frontend is Angular 20; Storybook and Playwright come with its `npm install`. Playwright also needs `npx playwright install chromium` once per machine.

## Repo layout and workspaces

| Path | What it is |
| --- | --- |
| `packages/infra-client/` | The product: stacks, constructs, Lambda code, Jest suites, pack scripts. Compiled to `dist/`, Lambdas prebundled into `assets/` |
| `frontend/` | The Angular web app; its build output is copied into the package's `assets/web` at pack time |
| `desktop/` | The Electron client; not in the npm package |
| `infra/` | FNTIO's own deployment: `config/project.ts`, `bin/app.ts`, PipelineStack, TestbedStack, the import CLI, the ops runbooks |
| `samples/` | Consumer-voice CDK apps importing the package |

The repo root is an npm workspace over `packages/*` and `infra`. **Install at the root only.** `npm install` inside `infra/` tries to fetch the private, unpublished `@fntio/infra-client` from the registry and fails with E404; the root install links it from `packages/`. `frontend/` and `desktop/` are separate installs (`npm ci` / `npm install` in their own directory).

## Build order

```bash
npm ci                                # repo root: packages/* and infra
npm test                              # package (stacks + lambdas) and deploy app
npm --prefix frontend run build       # BEFORE any cdk command
npm run build                         # package dist/, if infra/ or samples/ complain about missing types
```

- Every `cdk` command synthesizes the whole app, and synth throws "Web assets not found" without `frontend/dist`. Build the frontend first, always.
- `infra/` and `samples/` resolve the package's types from its compiled `dist/`; `npm run build` at the root rebuilds it (cdk synth does so automatically).
- Lambda bundles are prebuilt into `packages/infra-client/assets/` by `scripts/bundle-lambdas.mjs`; `cdk.json` runs it before every synth and `npm test` runs it via `pretest`. Nothing to do by hand.
- The first deploy needs `cdk bootstrap` in the hub region and in us-east-1 (WebCertStack always deploys there). Commands in [Install, test, deploy](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#deploy).

## Running each part

### Package tests

```bash
cd packages/infra-client && npx tsc --noEmit && npm test
```

Jest is transpile-only (`tsconfig.jest.json`) and bounded to half the cores and 2 GB per worker, so `tsc --noEmit` is the type check. The suite includes `lib/__tests__/cdk-nag.test.ts`, which synthesizes every hub stack plus a target-account stack and fails on any unsuppressed AwsSolutions finding; it skips itself when the frontend build or Lambda bundles are missing. Deliberate trade-offs are suppressed in that test with a reason.

### Deploy app tests

```bash
cd infra && npx tsc --noEmit && npm test
```

Covers the deploy wiring and the import CLI. Run it whenever `infra/` changed.

### Frontend dev server

```bash
cd frontend
npm install
npm start            # ng serve → http://localhost:4200, hot reload
```

Sign-in is the app's own `/login` page against the real Cognito pool; there is deliberately no local auth bypass. `public/config.json` is dev-only (WebStack generates its own) and holds the pool and client ids plus the feature flags (`passkey`, `mfa`, `network`, `devShares`, `federation`, `plugins`); keep it matching the deployment you develop against. API calls go to `/api/*` through `proxy.conf.mjs`; `DEV_API_URL` overrides the target, and `DEV_API_URL=http://localhost:3000` points at a local `npm run dev` Express instance. Unit tests: `npm test` (Karma/Jasmine). Details: [Develop](https://github.com/FNTIO/aws-infrastructure-client/blob/main/frontend/README.md#develop).

### Storybook

```bash
cd frontend
npm run storybook -- --no-open   # always port 6008 (angular.json's storybook target)
```

Every story renders the real component class, never a hand-copied template. Page stories render the shipped page component with faked services. A long-running Storybook dev server must be restarted to pick up global CSS or `angular.json` changes. Sidebar structure and the tokens legend rules: [Storybook](https://github.com/FNTIO/aws-infrastructure-client/blob/main/frontend/README.md#storybook).

### End-to-end tests (Playwright)

`frontend/e2e/` drives the deployment `E2E_BASE_URL` points at in a real browser: sign-in, every route, key flows, deep links and screenshot baselines. `E2E_BASE_URL` is required because the suite signs in and mutates real data. Setup once per machine: invite a dedicated e2e admin (and optionally a non-admin) through the app, `cp .env.e2e.example .env.e2e` and fill it in (untracked, never commit it), `npx playwright install chromium`.

```bash
npm run e2e            # full suite (headless)
npm run e2e:ui         # Playwright UI mode — watch/debug tests
npm run e2e:update     # re-approve screenshot baselines after an intended redesign
npm run e2e:report     # open the last HTML report
```

Baselines are platform-specific (rendered on macOS). Re-approve them deliberately, never blind. Full notes: [E2E (Playwright)](https://github.com/FNTIO/aws-infrastructure-client/blob/main/frontend/README.md#e2e-playwright).

### Desktop app

```bash
cd desktop
npm install
npm start
```

Point the first tab at a deployed site, or at `http://localhost:4200` with `ng serve` running (localhost is the one `http` exception). Two gotchas: macOS Gatekeeper deletes the unsigned dev Electron binary (reinstall, clear quarantine, ad-hoc sign; steps in [macOS: "Electron … contains malware"](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#macos-electron--contains-malware)), and a shell with `ELECTRON_RUN_AS_NODE=1` (VS Code's extension host) must launch with `env -u ELECTRON_RUN_AS_NODE npm start`. After a frontend deploy, quit via tray → **Quit and remove credentials** and relaunch; a plain reload can serve the old bundle. The main-process files (`main.js`, `credentials-writer.js`, `tailnet.js`, `tray.js`, `preload.js`, ...) are listed under [Files](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#files).

## Before committing

```bash
cd packages/infra-client && npx tsc --noEmit && npm test     # always
cd infra && npx tsc --noEmit && npm test                      # if infra/ changed
cd frontend && npx tsc --noEmit && npm run build              # if frontend changed (build when templates/styles changed)
node --check desktop/*.js                                     # if desktop changed
```

- Commits go straight to `main`, and pushing `main` deploys FNTIO's hub stacks (see [[Releasing]]).
- Large or risky changes (a new service, auth or grants logic, anything touching vending or cross-account trust) get a code review before they are committed.
- New API services get a Jest suite mirroring the existing pattern (`__tests__/<name>Service.test.ts` with mocked AWS clients, plus route coverage in `app.test.ts` via supertest). New routes or key user flows get an e2e spec in `frontend/e2e/`; shared frontend `util/` code gets a spec.
- A PR that touches frontend UI passes the Storybook sync check first: every routed page has a `Pages/` story rendering the real component, story args match real call sites, and no page markup is hand-copied.


## The OpenAPI drift rule

`packages/infra-client/openapi.yaml` is the portal's HTTP API contract and ships in the tarball. The route inventory is drift-tested against the mounted routes (`openapi.test.ts`), so **any API route change must update `openapi.yaml`** or the test fails.

The same test pins the spec's `info.version` to `package.json`, so a version bump must bump both. Response shapes are maintained by hand alongside the code; see [HTTP API](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#http-api).
