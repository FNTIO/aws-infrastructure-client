Symptom-first answers for the failures seen so far: issues reported from consumer deployments (anonymized, with the package version that fixed each), the web app, the desktop app, and the local development environment. Each entry gives the symptom, the cause and the fix, then points at the repo section with the full story. The operational procedures themselves are indexed on [[Runbooks]]; upgrade steps are on [[Deploy and Upgrade]].

## Consumer deployments

### Vends fail with "Failed to create console sign-in URL" (HTTP 502)

- Symptom: "Get credentials" and console links for one role return a 502; other roles in the same account keep working.
- Cause: the role's session length in the portal catalog (for example 12 h) exceeds the IAM role's `MaxSessionDuration`. Packages before 0.1.2 created target roles with a 1 h cap, so STS refused with "The requested DurationSeconds exceeds the MaxSessionDuration set for this role" and the API mapped that to a generic 502.
- Fix: fixed in 0.1.2, which creates target roles with a 12 h `MaxSessionDuration`; redeploy the `AccessTarget-*` stacks. Without the upgrade, set the role's session length back to 60 minutes in Admin → Accounts. The role form's Test button runs exactly this STS check before saving. See [Cross-account: trust a second account](Access-Model#cross-account-trust-a-second-account).

### CredsStack update fails with "CloudWatch Logs role ARN must be set in account settings to enable logging"

- Symptom: `cdk deploy CredsStack` fails on the API stage while upgrading to 0.1.2; empty log groups are left behind by the rollback, and admin pages error until the API is on the same version as the web app.
- Cause: 0.1.2 enabled access logging on the vending API. A consumer `cdk.json` with `@aws-cdk/aws-apigateway:disableCloudWatchRole` set to `true` stops CDK from creating the account-level CloudWatch role the stage needs; the package did not set it explicitly.
- Fix: fixed in 0.1.3, which sets `cloudWatchRole: true` so the role ships with CredsStack regardless of the consumer's flags. Retrying is safe; delete the orphaned empty log groups by hand. Deploy the hub stacks together, as [Upgrade](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#upgrade) says.

### Type check fails on `githubRepo` in `ProjectConfig`

- Symptom: before 0.1.4 every consumer had to invent a `githubRepo` value; from 0.1.4 the deployment fails its type check while the field is still present (an unknown property in the object literal).
- Cause: the field only fed FNTIO's own pipeline stack, which is not part of the package.
- Fix: fixed in 0.1.4, which removes the field. Delete `githubRepo` from your config.

### Security Hub reports APIGateway.4 and CloudFront.6 failed

- Symptom: a Security Hub CSPM run against a stock deployment fails the "associated with a WAF" controls for the API stage and the CloudFront distribution, plus by-design findings for the same resources.
- Cause: no web ACLs shipped before the `waf` block existed.
- Fix: fixed in 0.1.6, which adds `ProjectConfig.waf`, on by default. Bootstrap us-east-1 in the hub account before that deploy, deploy CredsStack and WebStack (WebCertStack rides along), then suppress the by-design findings once per account by workflow status. Steps in [Accepted findings](Security-Posture#accepted-findings-cannot-pass-inside-this-product); background in [[Security Posture]].

## Web app

### Deploy reported success but the old app is still live

- Symptom: a WebStack deploy finishes green and the site still serves the previous Angular bundle.
- Cause: the S3 upload or CloudFront invalidation can silently leave the previous bundle in place; a green deploy is not proof.
- Fix: curl the site and check that the `main-*.js` hash changed, then run `cd frontend && npm run e2e` against the live site. See [Build + deploy](https://github.com/FNTIO/aws-infrastructure-client/blob/main/frontend/README.md#build--deploy).

### Signed out after the laptop slept

- Symptom: the app lands on `/login` after a long sleep.
- Cause: `AuthService` renews the session 60 s before the hourly expiry and re-checks when the tab becomes visible or the network returns, so a short sleep survives. Only Cognito rejecting the refresh token, at its hard 12 h validity, clears vended credentials and sends you to `/login`.
- Fix: sign in again; the 12 h wall is by design. Details in [Auth & session lifecycle](https://github.com/FNTIO/aws-infrastructure-client/blob/main/frontend/README.md#auth--session-lifecycle).

### Stuck on a page showing `Missing bearer token` after the 12 h session

- Symptom: the desktop app was left open past the 12 h session (often overnight, on the Network page) and now shows a red `Missing bearer token` notice instead of the sign-in page. It reads like an account problem; it is not.
- Cause: at the 12 h wall the app asked the desktop shell to drop the VPN in the same instant it was fetching the sign-in page; that fetch failed with the interface change, the page stayed signed out, and its background refresh surfaced the API's own 401 wording. Fixed in 0.1.12: the app moves to the sign-in page before the purge, the sign-in page needs no fetch, a failed hand-off falls back to a full page load, and a 401 that outlives the session reads "Your session has ended".
- Fix: on an older version, quit via the tray icon (**Quit and remove credentials**) and relaunch, then sign in; you return to the page you were on. Details in [Session end](https://github.com/FNTIO/aws-infrastructure-client/blob/main/frontend/README.md#auth--session-lifecycle).

### A 401 that will not go away

- Symptom: a request keeps returning 401 after an auth change.
- Cause: the API is fronted by CloudFront and a cached 401 can linger. A 401 carrying `x-amzn-errortype` and no `x-powered-by: Express` came from API Gateway, not the app.
- Fix: add `?n=123` to the URL to bypass the cache. Request trails (`request` → `requireAuth` → `ALLOWED`/`DENIED` → `SUCCESS`) are in the vending API Lambda's CloudWatch log group; see [Debugging](Runbooks-Operations#debugging).

### A 403 or 429 the app cannot explain

- Symptom: a request is blocked with 403, or answered 429 with `Retry-After`.
- Cause: a WAF rule. A 429 is one of the two rate rules (`RateLimit` per IP, `TokenRateLimit` per bearer token); a 403 is a managed rule.
- Fix: read the `aws-waf-logs-<prefix>-web` log group (us-east-1) first, then `-api`; the log line names the rule. Raise `waf.rateLimit` or `waf.perTokenRateLimit` only for a legitimately large client. See [What deploys (default on)](Security-Posture#what-deploys-default-on).

## Plugins

### A plugin route answers 403 with reason `route-unknown` during a deploy

- Symptom: calls to a route the running deploy adds return 403, and the authorizer's log line says `route-unknown`; routes that existed before keep working.
- Cause: the gateway method goes live before the catalog record that names it; the activation resource is written after the methods.
- Fix: wait for the deploy to finish. Ship the UI that calls a new route in the same deploy as the route, never ahead of it. See [Troubleshooting](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#troubleshooting) under Plugins in the package README.

### Plugin assets answer 403

- Symptom: the plugin page or one of its files answers 403 under `/plugin-assets/…`, and the portal reports the page never connected.
- Cause: the assets path is CloudFront over a private bucket with a GetObject-only policy and no SPA rewrite, so a missing key answers 403, never `index.html`. The object key must equal the URL path; the usual cause is a plugin registered with its frontend not built, or an `entry` naming a file outside the built directory.
- Fix: build the plugin frontend before synth, check `entry`, redeploy. See [Troubleshooting](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#troubleshooting) in the package README.

### "This plugin was built for a different version of the portal"

- Symptom: a plugin page shows this notice instead of loading.
- Cause: the frame and the portal speak different message protocol versions (a page built on the 0.1.x plugin packages against a 0.2.0 or later portal, or the reverse).
- Fix: rebuild the plugin against the plugin packages of the installed package version and redeploy. See [Versioning](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client-plugin-sdk/README.md#versioning) in the SDK README and the 0.2.0 note on [[Deploy and Upgrade]].

### "Its page loaded but never connected to the portal"

- Symptom: the frame stays blank or renders, then the portal reports a handshake timeout.
- Cause: the page never posted `ready`: the `entry` path names the wrong file, or the Content-Security-Policy on plugin assets blocked a script the page needs — that policy allows the portal only, so a bundle loading anything from a third-party host never runs.
- Fix: open the frame URL in a tab and read the console for CSP violations; bundle every dependency; correct the entry. See [Browser SDK](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client-plugin-sdk/README.md#browser-sdk) in the SDK README and [Troubleshooting](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#troubleshooting) in the package README.

### Token refresh fails inside a plugin frame

- Symptom: a plugin request fails with 401 and the plugin shows an error, or the frame gives way to the portal's session-ended page.
- Cause: the host owns the session; the SDK never signs in itself. After an authentication-layer 401 it asks the host to renew and retries exactly once; after that the plugin surfaces the error and the portal's session-end flow applies (the 12 h wall). A plugin Lambda answering 401 for a business failure triggers the same retry.
- Fix: sign in again. Plugin authors answer domain 4xx codes, never 401. See [Browser SDK](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client-plugin-sdk/README.md#browser-sdk) in the SDK README and [Troubleshooting](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#troubleshooting) in the package README.

## Desktop app

### App still shows old web code after a frontend deploy

- Symptom: a plain reload of a tab serves the previous bundle.
- Cause: closing the window or Cmd+Q only hides the app to the tray; the shell caches the web bundle.
- Fix: tray icon → **Quit and remove credentials**, then relaunch; the relaunch fetches fresh code. See [Run it (development)](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#run-it-development).

### "Connected the client, but the network hasn't confirmed yet" (macOS)

- Symptom: Connect appears to succeed, nothing happens, and the network pill sits on "unknown".
- Cause: the Tailscale binary is both GUI and CLI and picks CLI only when `SHLVL` is set. A Dock-launched app has no `SHLVL`, so the CLI tried to start the GUI, printed "The Tailscale GUI failed to start (CLIError 3)" and exited 0.
- Fix: current builds set `SHLVL=1` on every spawn and treat that output as `daemon-not-running`. Launching from a terminal (`open -a "Infra Client"`) inherits the shell's `SHLVL`. See [The CLI needs SHLVL (macOS)](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#the-cli-needs-shlvl-macos).

### Pill says "Set up network"

- Symptom: the pill offers setup instead of Connect.
- Cause: Tailscale is missing or its daemon is not running; the dialog says which.
- Fix: install Tailscale, and on macOS open it once to allow adding a VPN configuration. No Tailscale account is needed. See [Connecting for the first time (end users)](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#connecting-for-the-first-time-end-users).

### Connected, but a resource times out

- Symptom: the pill is green and a host does not answer.
- Cause: rules are still syncing (a change to your access takes up to 5 minutes; a first connection to a site starts a pass at once and takes seconds), you hold no grant, or the resource's security group does not allow the connector.
- Fix: wait out the 5 minutes, then use the resource dialog's "Test connection", which separates vpn-down from no-answer. Same section as above.

### "The network rejected the connection key"

- Symptom: the connect attempt is refused.
- Cause: the single-use device key expired or was already used; the app auto-retried once.
- Fix: if it persists, an admin checks the key minter. Same section as above.

### Worked before, dead after a long absence

- Symptom: a machine that connected fine weeks ago cannot reach anything.
- Cause: devices offline for 7+ days expire server-side.
- Fix: click Connect again. A personal Tailscale on the same machine is a related case: one control server at a time, and Connect points the daemon at the org network; teardown only touches the app's own profiles.

## Developing locally

### A frontend fix does not show up

- Symptom: the change is saved and the browser still runs the old code.
- Cause: a leftover `ng serve` on port 4200 serves stale code and masks changes.
- Fix: kill the stale dev server, then start it again.

### `npm install` inside `infra/` fails with E404

- Symptom: npm tries to fetch `@fntio/infra-client` from the registry and dies.
- Cause: the package is private and unpublished; only a root install links it from `packages/`.
- Fix: run `npm ci` (or `npm install`) at the repo root, never inside a workspace. See [Install, test, deploy](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#deploy).

### Synth throws "Web assets not found"

- Symptom: any `cdk` command, even a bare `cdk bootstrap`, fails at synth.
- Cause: every `cdk` command synthesizes the whole app, and WebStack needs `frontend/dist/frontend/browser/` (or the copy baked into the package by `npm pack`).
- Fix: `npm --prefix frontend run build` before any `cdk` command. See [Build + deploy](https://github.com/FNTIO/aws-infrastructure-client/blob/main/frontend/README.md#build--deploy).

### Desktop app crashes at startup with `Cannot read properties of undefined` on an electron import

- Symptom: `npm start` in `desktop/` dies immediately; it looks like an app bug.
- Cause: `ELECTRON_RUN_AS_NODE=1` in the environment (shells spawned by VS Code's extension host inherit it) makes `require('electron')` return a path string instead of the API.
- Fix: `env -u ELECTRON_RUN_AS_NODE npm start`. Normal terminals are unaffected. See [Dependency pins & overrides](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#dependency-pins--overrides).

### macOS deletes the dev Electron binary ("Electron … contains malware")

- Symptom: Gatekeeper removes the unsigned dev Electron on launch.
- Cause: a false positive on the unsigned binary; no Apple certificate is needed to run locally.
- Fix: reinstall Electron, clear quarantine and ad-hoc sign it, exactly as in [macOS: "Electron … contains malware"](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#macos-electron--contains-malware). If still blocked: System Settings → Privacy & Security → "Open Anyway".
