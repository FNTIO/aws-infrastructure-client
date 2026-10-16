# Web frontend (Epic 2)

The browser UI for the credential-vending API: Angular 20 + Tailwind CSS v4,
built to a static bundle and served from S3 + CloudFront by the `WebStack`
CDK stack ([../packages/infra-client/lib/web-stack.ts](../packages/infra-client/lib/web-stack.ts)).

Decisions and rationale are kept in the product owner's epic logs, outside
this repo.

## Develop

```bash
npm install
npm start            # ng serve → http://localhost:4200, hot reload
```

Local dev signs in on the app's own `/login` page against the real Cognito
pool (password and email code work from localhost; passkeys are pinned to the
deployed domain — see "Auth & session lifecycle"). `public/config.json` holds
the current deployment's pool/client ids — it is dev-only (`WebStack`
excludes it from the upload and generates its own), so a clone edits it to
its pool ids; refresh it from the `WebStack` stack outputs (`SpaClientId`,
`CredsStack.UserPoolId`) if the backend is redeployed elsewhere. The deploy
also writes feature flags into it — `passkey`, `mfa`, `network` (VPN
sites exist; `false` hides the Network pages and `networkGuard` redirects
their routes), `devShares`, `federation` and `plugins` (each present only
when the deployment enables it; the list is the `appConfig` object in
`web-stack.ts`) — so keep the dev copy's flags matching the deployment you
develop against. API calls
go to `/api/*` and are proxied by `proxy.conf.mjs`: the target defaults to
this deployment's API Gateway and `DEV_API_URL` overrides it — the dev
server prints the chosen target at start, so a clone either sets the env var
or edits the fallback. To run against a local `npm run dev` Express instead,
set `DEV_API_URL=http://localhost:3000` (it needs the API's env vars; the
quickest source is the deployed function's own configuration:
`aws lambda get-function-configuration --function-name <CredsStack-VendingApiHandler…> --query Environment.Variables`,
exported alongside `AWS_PROFILE`). Both paths still sign in through the real
Cognito pool — there is deliberately no local auth bypass.

## Test

```bash
npm test             # unit tests (Karma/Jasmine)
npm run e2e          # Playwright against the live site (see below)
```

### E2E (Playwright)

`e2e/` drives the deployment `E2E_BASE_URL` points at in a real browser:
sign-in, every route (signed in and out, admin and non-admin), key flows
(vend credentials, panels, filters), deep links and redirects, session
end at the 12 h wall, plus screenshot baselines. `E2E_BASE_URL` is **required** — there is no default,
because the suite signs in and mutates real data on whatever it targets.
Any uncaught exception or `console.error` fails the test (`e2e/fixtures.ts`
holds the short allowlist of known-benign noise). Tests pin the
`/branding.json` overlay to the defaults, so an admin-saved org theme never
shifts the baselines — but the deploy config's own branding still shows:
the checked-in baselines were rendered with THIS deployment's `config.json`
branding, so a differently-branded deployment reviews the first diff and
re-approves with a deliberate `npm run e2e:update`.

Setup (once per machine / per clone):

1. Create a dedicated e2e admin user via the app's own invite flow
   (Users → Invite, admin on). Plus-addressing (`you+e2e@yourdomain`)
   lands the invite in your own inbox. Complete the set-password link,
   then assign the user at least one role so the credential flows have
   something to vend. Optionally invite a second NON-admin user
   (`you+e2e-basic@…`, admin off, no roles) — the admin-gating spec uses
   it to prove non-admins see no admin nav and bounce off /admin routes
   (skipped when `E2E_BASIC_*` is unset).
2. `cp .env.e2e.example .env.e2e`, set `E2E_BASE_URL` to your deployment and
   fill in the logins. `.env.e2e` is untracked — never commit it.
3. `npx playwright install chromium` (browser binary, per machine).

On a deployment where no admin has saved or skipped a theme yet, the
first-admin theme wizard auto-opens; the login setup step clicks
"Skip for now" once — a REAL `PUT /admin/branding` write on the target
(auth.setup runs outside the fixtures' branding stub), recorded
server-side same as a human skipping. Save a real theme first if you
don't want the default look.

The plugin spec (`e2e/plugins.spec.ts`) assumes the deployment registers the
reference plugin and the e2e admin holds `admin` on it DIRECTLY (not through a
group): its access-loss test revokes that grant over the API, expects the open
admin page to end, and regrants it in a `finally` — so for a few seconds the
Parameters entry is gone from that user's sidebar, and the file runs its tests in
order on one worker. Signing out revokes the refresh token server-side, so the
sign-out test signs in on its own context instead of ending the shared session.

Commands:

```bash
npm run e2e            # full suite (headless)
npm run e2e:ui         # Playwright UI mode — watch/debug tests
npm run e2e:update     # re-approve screenshot baselines after an intended redesign
npm run e2e:report     # open the last HTML report
```

Screenshot baselines live in `e2e/__screenshots__/` and are
platform-specific (rendered on macOS). A visual diff failing after an
intentional UI change is the expected workflow: review the diff in the
report, then `npm run e2e:update`.

The fixtures hide scrollbars in the test browser (`scrollbarsOff` in
`e2e/fixtures.ts`). Without that, the baselines depended on whether a mouse
was attached: macOS switches Chromium from overlay to legacy scrollbars when
one is, and the page layout's `scrollbar-gutter: stable both-edges` then
reserves 11px on each side, so every page's content shifted and five
baselines were re-approved twice on 2026-09-09 for a non-change. The rows on
Users, Accounts and Groups are NOT masked, so real data changes on the target
(new groups, friendly account names, an accepted invite) still show up as
visual diffs; review and re-approve those deliberately.

## Build + deploy

The CDK stack deploys whatever is in `dist/frontend/browser/` — build first:

```bash
npm run build                      # → dist/frontend/browser/
cd ../infra && npx cdk deploy WebStack   # prints WebUrl
```

Synth needs a web bundle: `WebStack` serves `dist/frontend/browser/` when it
exists, otherwise the copy baked into the package at
`packages/infra-client/assets/web` (present only after an `npm pack`), and
fails with "Web assets not found" when neither exists.

## Storybook

```bash
npm run storybook -- --port 6008 --no-open   # angular.json's storybook target pins 6008 too
```

Every story renders the REAL component class (see `.storybook/preview.ts`),
never a hand-copied template — that's how drift between Storybook and the
app gets caught (the design-sync rules in the PR template checklist).

**Sidebar structure** — three root sections, in this order (enforced by
`storySort` in `preview.ts`):

- `Foundations/…` — design tokens (Color System, Icon, the token overview
  page). No component behavior, just the raw palette/type/radius/elevation
  scale.
- `Components/<Category>/<Name>` — one shared/reusable piece
  (`Actions`, `App Layout`, `Cards`, `Data Display`, `Feedback`, `Forms`,
  `Navigation`, `Overlays`, …). If it's rendered by more than one page, or
  lives in `shared/ui/`, it belongs here — even if the component's own file
  sits under a `features/` folder (e.g. `VpcGroup`, `GrantDialog`).
- `Pages/<Name>` — a full screen assembled from components via a `*.fixture.ts`
  + injected-service fakes (see any `features/*/*-page.stories.ts`). This is
  where you check "does the finished screen actually look right," not
  individual parts.

New component category → pick an existing one from the list above; don't
invent a new top-level bucket for one component (see the
"New-component Storybook checklist" convention: also give it a tokens legend
if it renders colors/borders/shadows, per below).

**Tokens legend** (the swatch-and-tag strip under a component's canvas) —
set via `parameters: { tokens: [...] }` on the story's `meta`. Format:

```ts
tokens: [
  { label: 'Fill (primary)', value: 'bg-brand', swatch: 'background: var(--brand);' },
  { label: 'Border', value: 'border-border', swatch: 'background: transparent; border: 2px solid var(--border);' },
],
```

Rules:

- **One row per token.** Never join two concerns into one row with " · "
  (e.g. `'bg-success-muted · text-success'`) — split into a `Fill` row and a
  `Text` row. A row with an unavoidable space in its own value (e.g.
  `'h-7 w-7'`, or a multi-utility `ring-1 ring-inset ring-brand/25`) is fine
  and *should* render with the red "hardcoded" flag — that flag means "not a
  single semantic token," which is accurate for those.
- `swatch` is real CSS applied to a small preview square — not just a named
  token, an actually-rendered one. Use `var(--the-token)` so it moves with
  theme/branding.
- `value` is the Tailwind utility class (or CSS custom-property name for
  components styled with hand-written CSS instead of Tailwind, e.g.
  `VpcGroup`) — a single unbroken word reads as a real token and stays
  unflagged; anything with a space renders with a red ⚠ background as a
  "double check this" signal (`preview.ts`'s `isHardcoded` check).
- A single-value row with a parenthetical note (`'text-base (fixed, not
  .ui-card-title)'`, `'surface-foreground (13px/600)'`) is the right way to
  attach a clarifying detail — don't cram the detail into `value` with a
  separator instead.

## Styling / branding

Global styles are in [src/styles.css](src/styles.css). Brand colors are CSS
custom properties (`--brand-primary`, …) mapped to Tailwind utilities
(`bg-brand`, `text-brand`, …) via `@theme inline`. At boot, `applyBranding`
([src/app/core/config/branding.ts](src/app/core/config/branding.ts)) overrides
the variables — plus the project name, tab title, and logo — from the
`branding` block of the deployment's `config.json`, which `WebStack` generates
from the `branding` block of the deployment's project config (`ProjectConfig.branding`). So
one build re-brands per project — don't hardcode brand colors or the product
name in components.

The package ships no branding: a deployment without a `branding` block runs on
the stylesheet's own tokens, and the dev `public/config.json` carries only a
`projectName`. The placeholder logo and the teal `#0F766E` / orange `#EA580C`
this deployment shows come from the `branding` block of the deployment's own
project config — swap it for the client's real assets per deployment.

On top of that sits the **admin theme overlay**: `/branding.json` (written by
the theme wizard via `PUT /admin/branding`) is fetched at boot alongside
`config.json` and its `branding` merged over the deploy's, field by field
(`ConfigService`). The wizard itself (`core/config/theme-wizard.component.ts`,
admin-only: first login with no overlay, or the user menu's "Customize
theme") ports the design prototype's sidebar — name, logo, the whole accent
swatch board incl. the mode-aware `mono` + hex + her Strength slider
(`deepen()` — same-hue darkening), Border Strength (no gray-tone picker —
decided 2026-09-09; a saved `grayTone` passes through a re-save
untouched),
Gradient Strength (mechanics below; restored 2026-08-19 after being cut from
the first wizard build), Panel Strength
(`--glass-panel-bg` alpha), the Icon Style seg (three bundled sets —
mechanics below), and radius. Cut, 2026-09: "Set up with AI"
— and previews the sign-in page and the accounts mock
(`app-accounts-shell`) by painting the real `:root` tokens live, reverting
on Cancel/Skip. The wizard chrome is deliberately OPAQUE, not glass: the
app must not bleed through a window used for judging colors. Saving also clears the admin's personal accent
pick (`AccentService.clear`) so the org theme isn't masked locally. The
wizard is behind `@defer` — it must never grow the initial bundle.

**Preview pages** (issue #27, 2026-09-21): besides the sign-in miniature and
the Accounts mock, the picker offers the REAL Network, Users and Groups
pages. `shared/preview/preview-pages.ts` lists them; each has a loader
module under `shared/preview/pages/` that pairs the page component with the
same fakes its `Pages/…` story uses. The provider list itself lives once,
in a `<page>.preview-providers.ts` next to the component, and BOTH the
story and the loader import it — the two copies had already drifted once
(the wizard's Users preview lacked the `AuditApiService` the page injects
and threw at runtime), so a loader may only append loader-only extras
(`fakeRouter()`) to that shared list, never restate it. The fake factories
live in `shared/preview/fake-providers.ts`; `shared/storybook/story-fakes.ts`
re-exports them for the stories. A loader is a dynamic `import()`, so a page
is fetched only when its screen is first shown and never rides in the
wizard's deferred chunk. `PreviewShellComponent` supplies the plate, glass
sidebar and content panel (its nav is built from the sidebar's
`USER_NAV_KEYS` / `ADMIN_NAV_KEYS`, the same lists the live shell uses); the
page renders live through `NgComponentOutlet` with an injector whose fakes
outrank the app's services (plus a swallowed `Router`, so a preview can never
move the app), clipped and `pointer-events: none` — only a page's first tab
is ever seen. The "Preview as" toggle switches the page list: a member gets
the self-service Network page, an admin the admin one plus Users and Groups.
Adding a page is one `*.preview-providers.ts` (shared with its story), one
loader module and one registry entry. Both frame components have stories
under `Components/App Layout/` (Preview Shell, Preview Page — the latter
renders the real pages plus the loading and failed states).

**Gradient Strength mechanics** (`branding.gradientStrength`, default 0 =
off): the accent-tinted ambient glow between the glass plate and the frosted
panels is the app shell's `.shell::after`, mirrored by the login page's
`.loginwrap::before` (in the mockup the Glass stageframe's glow spans the
sign-in screen too — the always-on `--glow-a/b` hero glow is Depth-only and
deliberately not ported) and by `accounts-shell`'s `.plate::after` and the
wizard's `.login-preview::before`, so both wizard previews show the knob
live. Runtime JS sets only a
unitless multiplier (`applyGradientStrength`, slider value ÷ 50); the glow
colors (`--glass-panel-glow-*`) derive from `--accent-9` in styles.css, so
accent picks and theme flips recolor the glow with no JS repaint — which is
why the dark-theme block deliberately does not redefine the glow tokens, and
why `AccentService.reapplyForTheme` re-asserts the multiplier only as the
restore-from-config path behind the wizard's Cancel/Skip. In the shell the
layer must stay `position: fixed` (its −18% bleed would otherwise add scroll
extent to `.shell`'s overflow-x), and `.shell`'s `isolation: isolate` is what
keeps the `z-index: -1` layer above the plate background instead of vanishing
behind it.

**Icon sets** (`branding.iconSet`, default `outline`): every `<app-icon>`
draws from one of three bundled styles — `outline` (Heroicons outline,
1.5px), `bold` (Lucide, 2px round caps), `solid` (Heroicons solid, filled).
All three ship **statically in the bundle** — the original design loaded
them from a CDN at runtime, rejected on purpose: this app vends credentials,
so client deployments must not fetch executable-adjacent content from
third-party servers (availability + supply chain), and the desktop app runs
offline. Only the ~43 registry icons are bundled per set (a few KB each), not
the full libraries. Mechanics: `shared/ui/icon.component.ts` holds the
hand-curated outline registry (the source of truth for names);
`icon-sets.generated.ts` holds the bold/solid variants, generated by
`npm run icons:generate` (`scripts/generate-icon-sets.mjs`) from the
`heroicons` (MIT) + `lucide-static` (ISC) dev-deps — **after adding an icon
to `ICON_PATHS`, map it in the script and rerun the generator**; unmapped
names (the custom `env-*` identity glyphs, by design) fall back to their
outline shape in every set. The active set is a module-level signal
(`shared/ui/icon-set.ts`) set by `applyIconSet` at boot and live by the
wizard; the overlay API validates the value server-side
(`brandingService.ts`).

## Auth & session lifecycle

Sign-in is the **in-app `/login` page** (`core/auth/login-page.component.ts`),
not Cognito's hosted Managed Login — reversed 2026-08-11 so users pick their method *before* anything
is sent. Cognito remains the authenticator: the page drives the choice-based
`USER_AUTH` flow (`cognito-api.ts`, plain fetch — no AWS SDK dependency) and
Cognito does all password/passkey/code verification, throttling, and token
minting; SES still sends the code emails.

- **Federated sign-in (SSO)** (`federation.ts`; `/auth/callback` is the login page's `sso` screen): with
  `config.json.federation` set, the email screen leads with one "Sign in with …" button per
  provider and folds the local form behind "Sign in another way" (it opens by itself for an
  email that last signed in locally). A button sends the browser to Cognito's authorize
  endpoint on the auth domain (`identity_provider=<name>`, the federation app client from
  `config.json.federation.clientId`, PKCE S256, state in sessionStorage); Cognito returns to
  `/auth/callback?code=…`, which trades the code at `/oauth2/token` and hands the same
  `AuthTokens` shape to `completeSignIn` — renewal and revoke then run against that client
  (`auth.clientId` in localStorage marks the session as federated; the shell hides passkey and
  authenticator management for it, since those tokens carry no self-service scope). Cognito relays the pre-sign-up trigger's markers in
  `error_description`: `FEDERATION_LINKED_RETRY` (identity just linked to the invited user)
  re-runs the authorize redirect once, `FEDERATION_NOT_INVITED` is worded for the person.
  Mapped claims show under the email on Users, on the user detail and next to the caller on
  Activity, labelled from `config.json.federation.claims`.
- **The flow** (live-verified against the dev pool — see the protocol notes
  in `cognito-api.ts`): email → `InitiateAuth(USER_AUTH)` returns
  `AvailableChallenges` and sends *nothing* → chooser (or the remembered
  method's fast path). Each pick is a fresh `InitiateAuth` with
  `PREFERRED_CHALLENGE`: password is completed **inline in that one call**
  (Cognito refuses a password "selection" without the password), the email
  OTP is only sent by asking for `EMAIL_OTP`, and a passkey pick returns the
  ceremony options — or falls back to the chooser when the user has none.
  Passkeys run the WebAuthn ceremony in `webauthn.ts`; the RP id is the apex
  domain (creds-stack.ts), so passkeys registered on the old hosted page keep
  working. `NEW_PASSWORD_REQUIRED` (invited users with a temporary password)
  gets its own screen.
- **Invite links**: invite emails deep-link `/login#inv=<pool
  username>:<temp password>` (template in creds-stack.ts). The page consumes
  the fragment on load — silent password sign-in, straight to the
  set-password screen — and scrubs it from the URL first. The pool username
  is the internal UUID, not the email (Cognito accepts it for sign-in);
  challenge responses must reuse it, hence `inviteUsername`. The password
  part is used raw — never percent-decode it. An invalid/expired link falls
  back to normal login with a "resend" hint. Clones without a custom web
  domain send a plain temp-password email instead (see the wiki's
  Runbooks, "Invite emails"). **Open in the desktop app** under the card (browser
  only) hands the very page over on `infraclient://<host>…`; while an
  invitation is being set up the link carries its `#inv=` fragment
  (`inviteHash`, captured in `consumeInviteLink` and dropped if the link
  proves dead), so the invitee can finish in the app (desktop/README.md
  "Deep links"). The visual baseline `login.png` changes with it —
  re-baseline deliberately. The admin side: Create user opens the new
  user's panel straight away (`UsersStore.upsert` lists them before the
  reload; a `JustCreated` note says whether an email went out). Only with
  "Send invitation email" off does the API return `signupLink` — the panel
  then shows it with copy buttons via
  `features/users/signup-link-box.component.ts`, alongside the app's
  origin (a path-only link from a deploy without a web domain is prefixed
  with `location.origin`). The panel's **Copy sign-up link** mints a fresh
  one (which retires the emailed password, so the panel says so).
- **Forgot password**: "Forgot password?" on the password screen →
  `ForgotPassword` emails a reset code (SES) → code + new password on the
  reset screen → `ConfirmForgotPassword`, then signs straight in with the new
  password.
- **Passkey management**: user menu → Passkeys (`passkeys-dialog.component.ts`)
  lists/adds/removes the signed-in user's passkeys via Cognito's
  `*WebAuthnCredentials`/`*WebAuthnRegistration` APIs (access-token
  authorized). Adding only works on the deployed site — the RP id is the apex
  domain, so any other origin (localhost dev) gets a browser SecurityError,
  which the dialog explains. Desktop support is per platform (Windows and
  signed macOS builds; see desktop/README.md "Passkeys (per platform)") — the
  login chooser and the dialog both gate on
  `DesktopBridgeService.passkeyCapable`, and the ceremonies carry a 70s
  ceiling timeout as a backstop for a shell with no prompt UI.
- **Passkeys are per browser/app**: a passkey added in the macOS desktop app
  lives in the app's keychain group and is invisible to browsers on the same
  Mac (and vice versa; Windows Hello is the exception — one credential store
  for all). Cognito still offers "Passkey" to every client, and WebAuthn
  reports "no listed passkey on this device" as the same `NotAllowedError`
  as a cancel — by spec, so sites can't probe. `sign-in-memory.ts` therefore
  keeps a device-local list of credential ids created or successfully used
  from this browser/app profile; when the ceremony fails and none of the
  challenge's `allowCredentials` is on that list, the login page shows the
  "no passkey in this browser/app yet — add one under Passkeys" message
  instead of "prompt was closed". Registered-before-this-shipped passkeys
  join the list on their first successful use, and removing one in the
  dialog drops it.
- **Remembered choice** (`sign-in-memory.ts`): device-local by design — it must
  be readable pre-auth, so the server-preference pattern can't apply. Keyed per
  email; "Choose a different way to sign in" is always offered and re-picking
  updates the memory.
- API calls carry the Cognito **ID token** (not the access token): the Express API
  verifies `tokenUse: "id"` and reads the `cognito:groups` claim from it. `isAdmin`
  in the frontend only controls what the UI shows — every `/api/admin/*` route
  re-checks the group server-side, and route guards are UI convenience only.
- Tokens live in **localStorage** (`auth.*` keys — same store and posture as the
  old OIDC library) so new tabs, reopened browsers, and desktop-app relaunches
  stay signed in. `AuthService` renews with the refresh token 60s before the
  hourly expiry, re-checks on tab-visible/online (laptop sleep), and retries on
  network errors; only Cognito's own rejection — the refresh token's hard 12h
  validity (`web-stack.ts`) — clears vended credentials and lands on `/login`.
  A 401 from the API triggers one refresh + request retry in the interceptor.
- **Session end** (the 12h wall, a logout in another tab, a call that finds no
  token): `sessionGone` clears tokens and navigates to `/login` *before* asking
  the desktop shell to purge credentials. The shell drops the VPN tunnel on that
  purge, and a `/login` navigation still loading through the interface change
  used to fail and strand a signed-out page whose pollers then showed the API's
  raw `Missing bearer token` on screen (2026-09-15). Three guards keep that from
  recurring: the login route is eager (no chunk fetch at the worst moment), a
  `/login` navigation that *rejects* falls back to a full page load (which
  lands on `/login` via the guard) — one that is merely superseded by a second
  session-end signal or a sign-in landing resolves false and lands on its own —
  and the interceptor rewrites a 401 that survives the refresh into "Your
  session has ended" / "Couldn't renew". The bell poller stops with the shell
  so `/login` never keeps calling the API.
- **Session end is visible and warned (issue #29).** `completeSignIn` records
  `auth.sessionStartedAt` (never a refresh — `storeTokens` runs on every renew);
  `AuthService.sessionEndsAt` = that + `config.json.sessionHours` (WebStack's
  `SESSION_HOURS`, the refresh-token validity; a session from before the key
  existed falls back to the ID token's `auth_time`, which Cognito keeps across
  refreshes). One value, four readers: the user menu's "Renew sign-in" row
  (time left on its right, end time as its tooltip),
  the `app-session-banner` band above the page (inside the last 15 minutes,
  `SESSION_WARNING_MS`; dismissable once per session), the bell's `session`
  notification kind (same window, keyed by the end time so it fires once; its
  pop-up opens `/login?reauth=1`), and the desktop tray via `bridge.sessionEnds`.
  Every "until" readout ticks off the one `WallClock` signal (30 s + tab-visible).
  **Renew sign-in** is reachable at any time, not just near the end: the user
  menu's "Renew sign-in" row, the banner's
  "Sign in again", and the desktop tray's "Renew sign-in…" item (main sends
  `infra:renew-sign-in` to that backend's tab; `bridge.onRenewSignIn` →
  `reauthenticate`). All of them call `AuthService.reauthenticate`, which is a
  handover, not a logout:
  it stores the return target and the `auth.reauth` flag and opens `/login`,
  where the old session keeps running — tokens renew, keep-fresh writes,
  desktop credentials and the VPN stay — until `completeSignIn` replaces it
  (then the old refresh token is revoked). While the flag is set, the login
  page shows its "Sign in again" mode with a "Not now" link, skips its
  signed-in redirect, and `storeTokens` does not navigate off `/login` on a
  background renew. An abandoned re-sign-in just hits the wall as before.
  `sessionGone` records WHY in `auth.sessionEnded` (`expired` only when the
  clock agrees, within 5 minutes of the end; `invalid` for a token rejected
  early — revoked or disabled; `elsewhere` for the other-tab teardown) and the
  login page says so once. Pop-up kinds the server did not list (an older API)
  count as on — only an explicit `false` silences.
- **Logout**: stop keep-fresh, purge desktop-written credentials, `RevokeToken`
  the refresh token server-side (a copied localStorage must not outlive
  sign-out), then — only if a console was opened from this app
  (`AWS_CONSOLE_OPENED_KEY` in localStorage: the console session lives in the
  system browser and outlives tab and app relaunches, so the flag must too;
  a popup-blocked logout keeps it so the next sign-out retries) — open the
  AWS Console logout in a short-lived popup (signin.aws.amazon.com blocks
  iframes, so it must be a top-level navigation), and land on `/login`. The
  console logout is browser-global (one console cookie jar), so firing it
  blindly would also kill console sessions opened from other backends — see
  "Opening the AWS console" below. No Cognito `/logout` redirect anymore —
  the new flow never creates a hosted-UI cookie.
- `/config.json` is fetched with `window.fetch`, not HttpClient: auth depends on the
  config, so loading it through the interceptor chain would be a DI cycle.
  `hostedUiDomain` stays in config.json: federated sign-in builds its
  `/oauth2/authorize` and `/oauth2/token` calls from it
  (`core/auth/federation.ts`), the service-user secret panel's token `curl`
  uses it, and the desktop shell's nav allowlist reads it.
- **MFA and passkey UI are config-gated**: config.json's `mfa` and `passkey`
  fields (WebStack bakes in `loginMethods.mfa` / `.passkey`) drive whether
  the sidebar's "Authenticator (MFA)" and "Passkeys" items and the admin
  user panel's "Reset MFA" button render at all. A clone that leaves those
  knobs unset never shows the UI — the pool would reject the enrollment
  anyway. (The login page needs no such gate: it reads the available
  first-factor methods from Cognito's challenge list at runtime.)
- **Anti-enumeration**: the SpaClient sets `preventUserExistenceErrors`
  (web-stack.ts) — unknown emails get a simulated challenge menu instead of
  `UserNotFoundException`, and the UI shows the same copy either way, so the
  sign-in page can't be used to probe which emails exist.

## Credential caching & auto-renew

Vended credentials live only in an in-memory map keyed `account#role` (nothing in
storage; closing the tab clears it). The dialog reuses still-valid cached creds so
reopening doesn't reset the countdown; `get()` refuses anything within 30s of expiry,
while `peekExpiration()` is unfiltered so role-card countdowns run to zero. While the
dialog is open it silently re-vends 5 minutes before expiry — a fresh STS session is
NEW keys, not an extension, hence the "re-copy" hint. A 403 on vend means the grant
was revoked: the dialog shows a notice and the dashboard reloads.

Per-role **profile names** have two tiers: localStorage renders instantly and covers
offline/failed writes; DynamoDB (per user+role, via /api/preferences) is the source of
truth and survives devices. A pre-server localStorage-only name is migrated up once.
An emptied field never persists (an empty `[]` header is invalid) — it reverts to the
default `role-account` on blur without saving the default as an override.

## Opening the AWS console (multi-session)

"Console" on a role card asks the API for a federation sign-in URL
(`POST /accounts/:acct/roles/:role/console`) and opens it in a NEW browser
context: `window.open(_blank)` in a browser, the system default browser from
the desktop shell (`shell.openExternal` — deliberately outside the per-backend
Electron partitions). All console opens therefore share that browser's one
console cookie jar, and by default AWS keeps a single console session per
browser — opening a second account's console (from this app or another
backend's) replaces the first.

The fix is AWS **multi-session** (Jan 2025): up to 5 concurrent console
sessions per browser, each on its own subdomain
(`<account>-<alias>.<region>.console.aws.amazon.com`). It is a per-browser
opt-in the app cannot trigger: in the AWS console, account menu (top right) →
**Turn on multi-session** — a one-time step per machine/browser, worth doing
for anyone who works in more than one account or deployment. The API's
console-destination guard accepts the multi-label session subdomains.

On sign-out the app fires the global console logout
(`signin.aws.amazon.com/oauth?Action=logout`) only when a console was opened
from this app — the URL can't target one session, so a blind fire would end
console sessions belonging to other backends or opened by hand. With
multi-session ON, that logout ends only the CURRENT session (live-verified
2026-08-21): the per-subdomain cookie isolation that makes multi-session work
also means no URL can end them all, and the app never learns the session
subdomains (they're minted in the browser during the federation redirect).
Surviving sessions expire with their role session (≤1h — `SessionDuration`
is deliberately omitted); for immediate teardown, sign out per console tab.

## Auto-login star (desktop)

Starring a role card pre-vends its credentials silently on app load so "Get
credentials" opens warm. The starred set is stored server-side on the user's grant
rows (`autoVend` preference — durable, cross-device); localStorage is only an instant
cache reconciled by `hydrate()` (server wins; offline keeps the local snapshot).

The star is desktop-only in effect: in the Electron shell each starred role is also
written to `~/.aws/credentials` on sign-in and re-vended/rewritten 5 minutes before
each expiry (matching the dialog's lead), so the profile never goes stale while the
app is open. A vend failure (e.g. revoked → 403) stops that role's refresh loop; a
write failure warns once per role (with a specific message when another connected
backend already owns the profile name) and the dialog's manual button remains the
fallback. In a browser none of this runs — the star is hidden and there is no file
access.

## Access lists & the grant modal (shared)

Everywhere access is shown or handed out uses two shared pieces, so it reads
the same on the role, resource and user panels:

- `shared/ui/access-list.component.ts` — one row = title (+ muted subtitle,
  optionally as a chip) · why-badges (`via <group>`, `direct · long-term`,
  `direct · expires …`) · the one row action (Revoke/Remove/Delete). Rows
  wrap: the title keeps a `min-w-[10rem]` floor, so in a narrow panel the
  badge/action cluster drops to a second line instead of overflowing or
  crushing the name.
- `shared/ui/grant-dialog.component.ts` — the one grant modal: searchable
  multi-select over caller-supplied options (users, groups, roles, resources;
  optional group headers), optional duration select, `Grant N`. The caller
  does the API calls. Used by role-access, resource-users, user-detail (add
  to groups / grant roles / grant resources) and the Users bulk "Add to
  group".

Docked panel width: `app-panel` opens at 40 % of the content area (34 % for
`md`), clamped 400/480–1100 px, and a dragged width is remembered in
localStorage (`ui.panelWidth`). Stores keep their current data during a
reload (`load()` no longer nulls the signal), so a save refreshes rows in
place instead of flashing skeletons.

## Docked side panel (sidebars over popups)

Detail views and create/edit forms open in a **docked right panel** — a third
frosted glass column beside the content panel, never over it (the page
narrows; no scrim). The plumbing: pages declare their panel as an
`<ng-template #panelTpl>` wrapping `app-panel`, and `bindPanel()` (in
`shared/ui/panel.service.ts`) syncs it with the page's open-state signal; the
shell stamps the active template into its flex row after `.main`. One panel at
a time app-wide (last open wins), Esc/✕ close — with an Esc guard so a modal
dialog stacked above the panel (delete confirms) owns the keypress.

Conventions decided with the 2026-08-10 redesign (and its live-review pass),
refined 2026-08-12:

- **Admin Accounts / Network**: no radio column or selection bar — clicking a
  row is the way in. Everything runs as panel *states* swapped via each
  page's `panelKind` signal: detail, edit, the roles list.
- **Users keeps** its checkbox multi-select + bulk bar (multi-user actions);
  the row click opens the detail panel, with Send invite email beside the
  invited chip. The bar today: **Send invite emails** docks as a panel state, **Add to
  group** opens the shared grant modal (the grant rule below wins over
  docking), **Delete** is a modal per the delete rule. With nothing ticked
  the bar's buttons are disabled (no "pick who" fallback dialogs).
- **Groups**: the per-card icon shortcuts are gone — the card click opens the
  panel; members/roles/resources are access lists in the panel, each with an
  "Add …" that opens the shared grant modal.
- **Grant-type actions always use the one shared grant modal**
  (`app-grant-dialog`: filter, grouped multi-select, duration) no matter
  where they start — user/group/role/resource panels, service users, the
  bulk bar. When "it's a grant" and "bulk actions dock" collide, the grant
  modal wins: granting must feel identical everywhere.
- **Panel nesting caps at two levels** (e.g. detail → the roles list) via
  `showBack`: the one nested screen gets a ← in the header that steps back to
  the top level; ✕/Escape always close the whole panel regardless of depth —
  the two exits never share a button. Any *bounded* action reachable from
  that second level (add/edit a role, grant/revoke access, a confirm) is a
  **modal `app-dialog`** opened directly from wherever it starts, not a third
  panel level — past two, there's no breadcrumb and users lose track of where
  ← lands. Admin Accounts is the reference: account detail → the role panel
  (level 2, `showBack`); role create/edit are panel states (`role-create`,
  edit-in-place fields), and granting access from the role panel opens the
  shared grant modal. No dialog-from-dialog chaining anywhere.
- **Delete confirmations are the one thing that stays a centered dialog** —
  destructive actions keep a focused interruption; a docked panel is too easy
  to click past.
- **Request a role / request a resource** are form components
  (`request-role-form`, `request-resource-form`) docked from the accounts
  page, the empty state, and the bell's extend/renew links — both bell rows
  use the same container (the old `request-resource-dialog` is gone,
  2026-08-19).
- **Network page's requestable catalog** is a docked panel too
  (`app-request-access-panel`, header "Request access · N available" button)
  — multi-select across accounts, one duration + reason, one request per
  ticked resource. The old below-the-fold "Available to request" section is
  gone.

## List rendering: server pages for catalog-sized lists, client windows for the rest

Two kinds of list (since the scale epic, 2026-10-13):

- **Catalog-sized** (grows with accounts × roles): the dashboard's search and its table of other accounts,
  the admin Accounts page, every account picker, a group's roles. These use `paged()`
  (`shared/util/paged.ts`) over the API's list contract
  (`?q=&filter[key]=a,b&sort=&limit=&cursor=` → `{ items, nextCursor, total, facets }`):
  the first page loads on creation, a query or filter change restarts (typing debounced),
  `loadMore()` appends the next page by cursor, and the filter popup's sections come from the
  server's `facets`. Nothing catalog-sized is downloaded whole any more; account labels come
  from `GET /api/accounts/names` (`AccountNamesService`), never the catalog.
- **Bounded** (users, groups, requests, resources, notifications): the page loads the list
  and filters client-side (instant search). `windowed()` bounds how many rows are in the DOM,
  growing by a batch when the `appInfiniteScroll` sentinel nears the bottom; any change
  to the source signal (new filter, tab switch, reload) rewinds to the first batch. Per-row
  sub-lists are capped on the server (50 roles per user in the directory, 50 roles per group
  in the list) with a true count; the panels fetch the full record and fold it (the shared
  access list shows 30 rows and "Show more").
Pages scroll inside `app-page`'s inner region (the shell locks the viewport), so the
directive roots its IntersectionObserver on the nearest scrollable ancestor and fires
a screenful (400px) early. Sticky table headers need an *opaque* background
(translucent `bg-brand/10` lets rows show through), hence the local `color-mix`.

**The one exception is Activity** (`features/activity/`, decided 2026-09-21): a log is
unbounded, so `GET /api/admin/audit` takes a time window (`from`/`to`, the 7/30/90-day
presets are computed ranges, "Custom range…" adds two `datetime-local` inputs) and
narrows server-side on every facet the popup offers (category, outcome, account, actor,
person, group, exact targets) — a filtered view is never "the newest 1000, then filtered". A full page answers with `nextBefore`; the footer's **Load older** re-asks
with `before=` and appends (deduped by `eventId`). Search alone stays client-side.
A VPN session row is done BY the person who connected — the reconciler only observed it — so
`?actor=<sub>` finds it and `system:reconciler` never lists it (the row's byActor key, set once
where the row is written in `auditService`; the Done by facet mirrors it).
`activity-describe.ts` is the single place that turns an `ActivityEventView` into the
"What" sentence (verb map + target chip), the muted second line, the outcome badge and the
facet values; the page builds one row view-model per event per load and the popup, search,
CSV and template all read that. Facet pills are labels, but the applied state is *ids*
(`?user=<sub>`, `?target=role#…`, `?group=`, `?type=`, `?actor=`, `?from=`/`?to=`), which is
what the "History →" links on the user, role, resource and group panels deep-link with; the
URL mirrors the applied filters (`replaceUrl`) so a filtered view is shareable. A group,
bulk or cascade change writes one primary row plus one per-user row per person × thing
(`access.gain`/`access.lose`, `derived: true`, linked by `details.batchId`). Every request
asks for them (`derived=true`), but they are never listed on their own while their primary
row is loaded: `nestEffects` folds them under it, the primary row's second line summarises
them ("3 people gained access" / "1 person gained, 2 lost" — distinct people, from the
loaded rows, else from `details.affected`) and expands on click to one indented sub-row
per effect; expansion is remembered per batch, and ticking a person under **Done to**
expands the rows that touched them. A per-user row whose primary row is not loaded (a
person's own trail, or a batch cut by the window) stands alone with its "by …" clause,
since it is then the only account of what happened. Facet options and counts come from
the listed rows only; search and the CSV cover the nested ones too (the CSV adds one
`↳ access.gain` / `↳ access.lose` line under each parent). The Users page's **Access report** button
downloads `GET /api/admin/access-report` (current state, one row per person × thing).

## Notes

- **Role card icons (2026-08-24):** the card's top-left icon shows what the
  role lets you do — admin-picked on the Add-role form's "Card icon" field
  from a curated 8-token set (`shared/util/role-icons.ts`, stored on the
  Roles catalog `icon` field; the role panel exposes no picker), falling back
  to a role-name heuristic (`read`→eye, `admin`→shield,
  …) and finally the generic key. Card structure is untouched — only the
  existing `icon` input is now fed for roles; resource cards keep their type
  icons. Icons stay neutral gray: status lives in the countdown chip only.
- **Toasts (2026-08-24):** errors stay until dismissed and may carry one
  action link to the fix (`ToastService.error(msg, {label, path})`); the
  accounts page consumes `?vend=<acct>:<role>` (opens Get credentials) and
  `?request=1` (opens the request panel) as the link targets, scrubbing the
  params after. Successes auto-fade with a length-scaled duration and pause
  while hovered — they stay ephemeral on purpose: each echoes an on-screen
  state change, and decisions have their durable record in the Requests
  page's Decided tab (routing them into the bell would bury real notices).
- Angular 20 (upgraded 2026-08 alongside machine Node 22 LTS at
  `~/.local/node`; the previous 20.18 install is parked next to it as a
  rollback until the upgrade has soaked).
- Tailwind v4 is wired through PostCSS ([.postcssrc.json](.postcssrc.json)).
- Admin request decisions are deliberately non-optimistic: approval is what writes
  the grant, so the UI waits for the server; a 409 from a concurrent admin just
  reloads the queue.
- The bell badge counts only unseen decisions/expiry/revocation notices + the
  admin queue, never the user's own pending asks. The expiry section's
  "request more time" is the only path to extend a still-held grant — the
  request catalog excludes roles the user already holds.
- For admins the bell popup splits into "For you" | "Admin" tabs (same
  underline tabs as the Users page; non-admins see no tab row). The Admin tab
  holds the pending queue plus four service-user hygiene nags computed
  client-side from `GET /api/admin/service-users`: rotation unfinished >24 h
  (replaced secret still active), never used >7 days after creation, idle
  >90 days after last use, and secret older than a year (rotation due).
  Hygiene nags light the Admin tab's dot but deliberately never inflate the
  bell badge — they're chronic reminders, not events.
- The admin Requests queue also carries the yearly reviews the sweeper
  raises (group reapprovals with a `group` badge, admin re-attestations,
  service-user "still needed?" reviews) and a usage chip on pending
  reapprovals ("used N× this year" / "never used this year"); the decision
  dialog spells out each kind's consequence (notably: denying a service-user
  review DELETES it).
- Access changes notify: the bell's "Access changes" section reads
  `GET /api/notifications/revocations` (written server-side by every revoke
  AND unasked-for grant path — see the Access Model wiki page); each row
  carries `change: GRANTED | REVOKED` (rows older than the field are
  revocations — `NotificationsApiService` fills it in), granted rows get a
  green dot/badge and no "Request again".
- **Pop-ups** (`core/layout/notifications.store.ts` is the ONE place they are
  decided; `notification-mapping.ts` is the pure copy/route/key mapping with
  its spec): after every poll, each unseen item not yet raised — access
  granted/revoked, a decision on one's own request, role/resource expiry
  (expiring vs expired), and for admins pending requests and yearly reviews —
  becomes one toast; more than three of a kind in one poll collapse into a
  summary. Delivery is the desktop shell's OS notification (`bridge.notify`
  with a `route` the shell hands back through `onOpenRoute`; `notifyClose`
  withdraws a toast once its item is seen or an expiry phase moves on) or, in
  a browser, a Web Notification while a tab is open — only if the person
  already granted permission (never prompted on load; the settings panel's
  "Allow in this browser" is the one prompt). Raised keys persist in
  localStorage per user (`notifications:notified:<sub>`, newest 500, plus a
  `notifications:notifiedThrough:<sub>` watermark that the oldest NOTICE keys
  fold into — `NotifiedLedger`) so a relaunch never re-notifies and a backlog
  larger than the cap can't resurface as a fresh summary every poll (it did,
  2026-10-14, after a 7,000-role group membership). The user menu's **Notifications** panel
  (`notification-settings.component.ts`) holds the master switch and one
  checkbox per kind — server prefs at `/api/preferences/notifications`,
  cross-device. A switched-off kind is still recorded, so switching it on
  later fires only for what arrives next, never the backlog. Expiry toasts
  route to `?bell=1`, which opens the bell popup and scrubs the param.
- The desktop shell must open console URLs via the bridge (`openConsole`) because
  a WebContentsView swallows `window.open`.

## Network resources & admin catalog pages (Epic 4)

Nav is two sections: **Your access** (Accounts, Resources — the user's own)
and, for admins, **Administration**, whose links group into pairs separated by
hairline dividers: catalog (Accounts, Resources), people (Users, Groups),
oversight (Requests, Activity).

User-facing:

- **Accounts** (`/accounts`, `features/accounts/`) — since 2026-08-17 one
  flowing row of per-account boxes (plain, non-collapsible; title = account
  name · N roles) whose role cards are titled by ROLE (the card's own Role
  row is hidden via `showRoleRow`). A box's flex-basis is N card widths, so
  a one-role account is card-sized and boxes pack several per row; when the
  row is narrower the box shrinks and its cards wrap inside.
- **Resources** (`/resources`, `features/resources/`) — nested
  account → VPC → resource-card layout: collapsible account groups
  (`app-project-group`) each holding one
  collapsible VPC bar (`vpc-group.component.ts`) over the card grid. Card
  face shows account name + ID and the description; connection details live
  behind **Copy vars**, a Get-credentials-style dialog listing Account ID /
  Host / Port(s) plus one type-specific value: `psql` command (DATABASE),
  full URL (WEB), `ssh` command (HOST, only when port 22 is open). WEB cards
  also get "Open in browser". Below the granted groups, **Available to
  request** is one collapsible section (open/closed persisted in
  localStorage) with the whole catalog nested the same way; it feeds the
  same request/approval flow as roles. Reachability changes take ≤5 min
  (the ACL reconciler's cadence) — the UI says so rather than pretending
  it's instant.
- **Dev shares** (desktop only, `config.devShares.enabled`) — a "Teammates’
  laptops · <site>" group above the account groups (the subtitle gains "and
  teammates’ laptops": the page lists what the VPN connection can reach, and
  a shared laptop is one more such thing) with two boxes (`share-box`): **My
  shares** (share cards with Stop sharing / Open in browser — the same link
  grantees get; the URL row has the copy icon — and a relay chip:
  Serving, Starting… on the first attempt, Not serving, or Paused while the
  VPN is off or on another site) and **Shared with me** (owner, URL, Test
  connection via the shell's probe, Open in browser).
  A share can be a grantee's only reason to be on a site, so a share is
  never made to depend on holding a VPC there: on the single-site layout
  the boxes carry the VPC bar's VPN control (`vpn-control`: **Connect** /
  **Switch & connect** until the VPN is on that site, then the pill —
  Connected, or the relay summary for My shares); on multi-site the boxes
  sit inside their network's group (below) and carry no control. Cards
  never carry a connect control; the owner card only says it's served
  once connected there. "Not serving" covers every reason the relay
  isn't running on this device — the shell refused it, the shell predates
  shares, anything broken — with the reason under it and the
  bind-to-0.0.0.0 fallback, which works regardless of the cause (the ACL
  rule is the real access). The header's **Share a local port**
  (secondary button, also the tray's opener) docks `share-port-panel`: port +
  label, the grantee picker over `GET /network/shares/directory` (users and,
  when allowed, groups), a duration capped by config, and the URL preview.
  `shares.store.ts` owns the lists (60 s polling while the page is open) and
  the relay reconciliation: every live share of mine on the ACTIVE site is
  served, anything else the shell runs is stopped; a shell without share
  IPC marks every wanted share failed with that reason instead of leaving
  the card at Starting… forever. Same-site only — the share panel names
  the site a new share is created on. A browser never shows
  any of it (no relay, no VPN). Rationale + config: the wiki's Private
  Network page, "Dev shares"; end-user steps: desktop/README.md "Sharing a
  local port".
- **Multi-site deployments group the Network page by NETWORK** (desktop
  only — the browser never loads the site list, so its layout and the e2e
  baselines stay the single-site one). One `project-group` per site with
  the one VPN control (`vpn-control`, in the header's `groupActions` slot)
  and a `summary` ("2 VPCs · 1 laptop"); beneath it the VPC bars (account
  in the `detail` slot, `control` off — verdict pill only) and the **My
  shares** / **Teammates’ laptops** boxes; a site with nothing says so
  and still has Connect. Single-site keeps account → VPC groups plus the
  Teammates’ laptops section, where every bar carries the control (any of
  them connects the one network). `vpn-control` is the ONE Connect /
  Switch & connect / in-flight pill for every bar; hosts render their own
  connected pill. VPCs whose account no site claims fall back to the
  single-site account group.
- **The Connect pill's chooser is ONE list, network → VPCs** (multi-site
  deployments only — with one site, a pill click connects and the flat
  granted-VPC list stays). A network (site) row carries the only control
  (Connect / Switch / Connected); the granted VPCs on it sit indented
  beneath with their probe verdict while connected. Two lists with a
  button each read as two different things — they were the same action.
  Every configured site is listed, VPCs or not: joining a site needs no
  grant there (the API mints a device key for any configured site; the ACL
  decides what you reach), and a dev share may be the only thing a user
  holds on one. The tray's VPN submenu already worked this way. VPCs whose
  account no site claims fall into an "Other VPCs" list with nothing to
  connect to.
- **The VPC tier is derived; "Connect" targets the VPC's SITE** — the backend
  has no VPC entity on a resource, so the tier is grouped by `accountNumber`
  (an account's several connector VPCs share one group) and labeled with the resources'
  common private-DNS zone (`shared/util/network-groups.ts`; falls back to
  "Private network", and the request catalog — which hides connection
  details pre-grant — borrows the label from the same account's granted
  resources). With Epic 4 SITES built (2026-08-12), `/api/network` returns
  the site list (`id`, `controlUrl`, `accounts`); `NetworkStore` maps
  account → site and tracks `activeSiteId` (the shell derives it from the
  tailscale profile's `<site>.tail.internal` base domain). One site is
  connected at a time: bars and pill rows on the active site show live
  status (`core/network/vpc-status.service.ts` TCP-probes one granted
  resource per account, 30s throttle, active-site only — Connected vs "No
  answer"); the NETWORK row/group of another site shows "Switch & connect",
  which mints a key for that site and swaps the whole connection over
  (since 2026-09-14 the control sits on the network, not on each VPC — see
  the two bullets below). The PILL's click only connects while exactly one
  site exists; with several, clicking it opens the chooser instead —
  connecting is always an explicit per-network click. Single-site
  deployments never see switch affordances — everything behaves like one
  shared VPN, as before. One rule decides "is the VPN on site X" for every
  bar, card and pill row: `core/network/vpn-status.ts` (`vpnStatusOn`; an
  unknown active site — older shell — counts as this one, and another
  site's in-flight connect renders nothing rather than a dead Connect).
  Auto-reconnect and the last-connected site are SERVER prefs (one
  `pref#network` row via GET/PUT `/api/preferences/network`); localStorage
  (`network:autoReconnect` / `network:lastSite`) is only the instant cache,
  reconciled server-wins on init. Rationale: they're user intent, and a
  removed-and-re-added desktop tab starts with empty storage — before this,
  auto-reconnect silently switched off and "last site" fell back to the
  first in the list. Boot auto-reconnect rejoins the last-connected site
  (best guess; a wrong one costs one "Switch & connect" click) and stands
  down when the tunnel is already up on a foreign tailnet. With it OFF, a
  tunnel found up at launch that this shell run never started (the shell
  reports `ownedThisRun`; tailscaled outlives a crash, a reboot or a quit
  whose logout timed out) is dropped instead of adopted as Connected.
- **Network setup & failures** (`core/network/`) — the sidebar pill is the
  VPN control (desktop only). "Set up network" opens a guided dialog
  (`network-setup-dialog.component.ts`) whose step (install → open Tailscale
  → connect → done) is *derived* from live `tailscale status` (re-polled
  every 3s), so finishing a step outside the app advances it by itself.
  `network.store.ts` maps shell failure codes to friendly copy and silently
  re-mints + retries once on a rejected (stale) device key; a failed
  user-initiated connect with a setup-type cause auto-opens the dialog. The
  guide is always reachable: "Setup guide" in the connected popover and in
  the Network page's subtitle (any pill state). In a
  plain browser the Resources page shows an info banner (the desktop app is
  required to connect). The vars dialog adds a desktop-only "Test connection"
  TCP probe separating vpn-down / no-answer / refused. End-user runbook:
  desktop/README.md "Connecting for the first time".

Admin (all follow one convention — **squares = pick many, circles = pick
one**; single-pick pages disable their bar buttons until a row is picked):

- **Accounts** (`/admin/accounts`, `features/admin-accounts/`) — two tabs
  (reworked 2026-08-17). **Accounts**: one row per account, roles as chips
  (`role · N users`, count from `listAllAccounts`' grantee join). The
  toolbar's **Arrange order** button (54ace3e) swaps the table for a draft of
  the whole list: accounts, and the role chips inside each, move by CDK drag
  or by the up/down arrow buttons on every row; the search is cleared and
  hidden while arranging (a narrowed list would hide neighbours) and
  switching to the Roles tab drops the draft. **Done** saves it as one
  `PUT /admin/accounts/order` with body `accounts: [{ accountNumber,
  roles? }]` — a `roles` list only for the accounts whose role order changed —
  and **Cancel** discards it. The result is `sortOrder` on the Accounts row
  and on each role; `listAllAccounts` and `listAccess` both sort with
  `services/accountOrder.ts`, so Your access and the admin tabs agree, and
  entries without a position list after the ordered ones, by name. Clicking a
  row opens the account panel — the name is click-to-edit in place
  (`shared/ui/inline-edit.component.ts`: pencil → input with ✓/✕, Enter/Esc,
  blur commits), the roles are always listed with per-row open/delete and an
  Add role button, and **Deregister account** sits in the footer. **Roles**:
  every role as its own row grouped by account (chip · IAM name/ARN · users
  · description). Both land on the same role panel
  (`role-detail.component.ts`): display name / ARN / chip color /
  description edited in place (each edit PATCHes the full `RoleFields`),
  "Who can assume it" = `role-access.component.ts` (grant with duration,
  revoke) directly underneath, Delete role in the footer. From an account's
  role row the panel shows ← back to the account. Adding a role is still a
  form (`role-form.component.ts`, IAM name is fixed once created), opened
  from the header (account picker) or an account (pre-bound). The old edit /
  Manage-roles sub-pages and the role-form / role-access dialogs are gone.
  Role *granting* lives here and in the user panel's Grant role modal. Registering accounts/roles here replaces the old
  curl-only flow (admin-only — still no self-service).
- **Resources** (`/admin/resources`, `features/admin-resources/`) — catalog
  table (register/edit/delete; account is immutable after creation).
  Single-pick radio + bar: **Manage users** (grantees with revoke +
  grant-more with duration, group-granted rows not revocable), Edit, Delete.
  Since 2026-08-17 the table is grouped by **site** with a *Site · Connector*
  column (live dot from the reconciler topology), status chips (All /
  Blocked / No one granted — the sync banner's "N blocked" jumps there), a
  **Sync now** button (`POST /admin/network/sync`, status re-read ~45 s
  later), and split status labels ("No connector" vs "Connector offline",
  "Account in no site"). The **register form** groups accounts by site with
  each connector's state in the option label (accounts in no site are
  disabled), and checks the address against the connector's approved routes
  and the DNS name against the site's split-DNS zones as you type
  (`network-index.ts` — the same `GET /admin/network` data the map uses,
  held in `AdminResourcesStore.network`).
  The table is `shared/ui/sticky-grouped-table.component.ts`: a static
  column-header row above its own scroll region, each site's group "lid"
  sticky inside it. The lid and its sticky wrapper (`.group-lid` /
  `.group-lid-wrap` in styles.css) are painted OPAQUE by re-compositing the
  frosted panel from its own tokens (`--glass-panel-bg` over `--glass-plate`)
  plus the `--card-bg` tint every group header uses — not `--surface`
  (translucent in dark) and not a fixed hex (drifts off the panel when the
  wizard's Panel Strength moves). That is what keeps rows from showing
  through the lid on hover or through the corner notches outside its top
  radius; the earlier blur-only backdrop just smeared them.
  A second **Map** tab (`network-map.component.ts`) draws the same catalog as
  a canvas trace graph — sites → connectors → routes → resources → groups →
  users, every edge a real backend relationship. Click a node to trace its
  cone (a resource lights up its site/connector/route to the left and its
  groups/users to the right, never sideways into other resources); the side
  panel writes the trace out and offers Manage users / Edit. Per-column
  filter boxes, a 9-node cap with "+N more" buckets (trace members surface
  first), a Focus toggle, and users hidden unless they hold a grant, a device
  or a resource-bearing group keep it readable at 50+ users. All graph logic
  is DOM-free in `network-graph.ts` (spec'd; the fixture in
  `network-map.fixture.ts` doubles as the Storybook story's data). Data:
  `GET /admin/network` (sites + reconciler topology) joined with the
  catalog, users and groups — fetched on the first switch to the tab.
- **Users** (`/users`, `features/users/`) — table with a Resources column
  (chips `name · accountNumber` with direct/team tags like roles). Simplified
  2026-08-17: the bulk bar is just **Send invite emails** (armed only when ticked
  users are still invited), **Add to group** (modal → `addMembers`) and
  **Delete**; bulk Manage-access is gone. The docked panel
  (`user-detail.component.ts`) is email click-to-edit over two tabs
  (54ace3e). **Access**: Make/Remove admin, and for invited users
  **Copy sign-up link** + **Send invite email** (d955309 wording; each
  replaces the other's link), then **Groups**, **Roles**, plugin access
  (when plugins are on) and **Network resources** listed with why they hold
  each (`direct · long-term` / `direct · expires …` from
  `GET /admin/users/:id/grants` + `/resource-grants`, or `via <group>` from
  the directory row) and Revoke on direct ones, plus **Add to group** /
  **Grant role** / **Grant resource** modals (account → role / resource +
  duration). **History** (`user-history.component.ts`) is the person's own
  Activity rows in place — last 90 days, **Load older**, and an **Open in
  Activity** link for the full filters — because the desktop app has no back
  button to return from the Activity page. The old Edit-user form and
  manage-access screens were removed. Revoke everything and Delete user stay
  in the footer.
- **Groups** (`/admin/groups`, `features/groups/`) — bundles hold roles AND
  resources (mixed allowed, ≥1 of either). Since 2026-08-17 the docked panel
  is one screen like the user panel (`group-detail.component.ts`): name and
  description click-to-edit, then **Members**, **Roles** and **Network
  resources** as the shared access list with Remove per row and an "Add …"
  each that opens the shared grant modal (users / catalog roles grouped by
  account / resources). Every change is one `PATCH` or add/removeMembers
  call. Creating a group is still the form (`group-form.component.ts`); the
  old Edit sub-page and Manage-members dialog are gone.

Requests carry a `kind` (`ROLE` default / `RESOURCE`); the admin requests
page, decision dialog, and notification bell all branch on it. The user-side
`GET /api/requests` joins `resourceName` server-side so the bell can label
resource rows.

## Design notes moved out of code comments

- **Content width.** `ContentWidthService` is the one floor for `.main`: the routed page reports the
  width it needs and both the shell's sidebar-collapse math and `.main`'s `min-width` read that signal.
  They used to hardcode 560px each; Network's grouped table needs 860px, so opening a docked panel
  narrowed `.main` without the sidebar collapsing and two nested horizontal scrollbars appeared at once
  (2026-09-09). A second floor anywhere brings that back.
- **Tooltips and dialogs.** `.main` and `.band` carry a `backdrop-filter`, which per spec makes them the
  containing block for any `position: fixed` descendant. A tooltip bubble or dialog left inside them is
  positioned against `.main`'s box, not the viewport, and an `absolute` one is clipped by the nearest
  `overflow` ancestor (the theme wizard's scrollable panel, for example). `TooltipComponent` and
  `DialogComponent` therefore reparent their bubble/panel to `<body>` and position from the trigger's
  bounding rect; the trigger element itself stays in place so hover and focus targeting are unaffected.
- **Page header subtitle.** One short sentence, no second clause after ", " / " — " / ". ": it wraps
  (never truncates) and a second line drags the actions row down. Longer help goes in `subtitleInfo`,
  the ⓘ tooltip (Storybook: PageHeader/WithInfoTooltip; the design spec (Design.md) §14).
