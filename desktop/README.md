# Infra Client — Desktop App (Electron)

A thin Electron shell that connects to **multiple backend deployments at once**
and writes vended AWS credentials into **`~/.aws/credentials`** — the one thing
a browser can't do. It is a *purpose-built browser*: each backend is a tab
loading that deployment's real web app in its own isolated session.

## How it works

```
┌─────────────────────────────────────────────┐
│  main process (Node — the only fs access)    │
│   • tab bar / backend registry (shell.html)  │
│   • serialized ~/.aws/credentials writer      │
│   • IPC handlers (write / console / logout)  │
└───────────────┬─────────────────────────────┘
                │ IPC (preload.js: window.infraDesktop)
    ┌───────────┴───────────┬───────────────────┐
    │ WebContentsView       │ WebContentsView   │  … one per backend,
    │ infra.projectA.com    │ infra.projectB.com│    isolated session
    └───────────────────────┴───────────────────┘
```

- **Remote-load, not bundled.** Each tab loads the backend's deployed web app —
  no frontend copy ships, so every tab carries its own branding/roles.
- **First run** asks for a deployment URL (bare hostname → `https://`). The
  shell reads `GET /api/.well-known/infra-client` to label the tab and
  persists the backend for next launch. If discovery is missing it still
  connects, but only when the site's `config.json` carries real Cognito ids
  (labeled from its branding name, else the hostname). Entering an
  already-connected URL focuses the existing tab — a duplicate would be a
  second login racing to write the same profiles.
- **Single serialized writer.** Tabs send credentials over IPC; main writes
  them one at a time (atomic INI upsert), so parallel refreshes can't corrupt
  the file. The profile name is written **verbatim** — exactly what the role
  card shows. The API resolves it: user override → admin account-level name
  (only role held there) → admin role default → `<account>-<role>`; admins
  pick names for cdk.json/scripts, so they must match character for
  character. A deployment can't see other deployments' names, so the writer
  refuses a name another *connected backend* already wrote
  ("profile-conflict"; the dialog pre-fills a `<project>-<name>` suggestion,
  saved as that user's per-role override) instead of letting two tabs trade
  the block every renewal. A tab disconnect releases its ledger claim (the
  profiles stay in the file until quit), so reconnecting the same deployment
  is never refused by its own leftovers. **Admins running several
  deployments:** reused names (`prod` in both) collide for every shared
  user — pick deployment-distinct names (`acme-prod` / `globex-prod`) at
  setup and the conflict never exists.
- **Theme follows the app.** The page's light/dark toggle drives
  `nativeTheme.themeSource`, so the tab bar and the macOS title bar follow
  the in-app choice, not the OS appearance.
- **Tray VPN submenu picks the site.** One radio entry per site across every
  connected tab (grouped per backend, headers host-suffixed when two share a
  projectName; the union comes from each backend's discovery `networkSites`),
  plus Disconnect. Picking a site sends `infra:tray-connect` to that
  backend's tab, which runs its own Connect/switch — the page holds the
  session that mints the device key. A device is on one site at a time.
- **Auto-write + keep-fresh.** Written on vend; starred roles re-vend and
  rewrite 5 min before expiry; profiles are removed on logout, tray Quit, or
  when the 12h login session ends. A renewal timer set before the machine
  slept is not trusted: on wake, reconnect and window focus the page re-vends
  whatever is due and re-arms the rest from the wall clock. A failed re-vend
  (offline, 5xx, timeout) is retried on a doubling delay from 30 s to 5 min,
  with one toast after the second failure; a 403 (grant gone) or 401 (session
  gone) ends that role's loop. Unstarred profiles, written from the
  Get credentials dialog, renew only while that dialog is open — the tray's
  "hasn't renewed" alert is the only warning for those.
- **Background session (hide-to-tray).** Closing the window or Cmd+Q *hides*
  to the menu bar: hidden tabs keep renewing (background throttling is
  disabled so timers stay punctual) until Cognito's 12h refresh-token wall,
  when the page purges the profiles. The page moves to the sign-in screen
  *first* and asks for the purge only once that navigation has settled: the
  purge drops the VPN tunnel, and a sign-in screen still loading through that
  interface change used to fail and strand a signed-out page (frontend
  README, "Session end"). **Quit and remove credentials** in the
  tray is the real quit: profiles removed, app-owned VPN dropped.
  "App-owned" is decided by observation, not only memory — any saved
  tailscale profile on one of the app's control-plane hosts is logged out at
  quit, even one a crashed run created; personal tailnets never match those
  hosts. OS shutdown is never blocked. A second copy just focuses the
  running one (single-instance lock).
- **Sessions survive relaunches.** Session partitions are keyed by the
  backend's stable registry id, so quit + relaunch inside the 12h window
  stays signed in; partitions no longer in the registry are swept at
  startup. The shell clears the partition's *HTTP cache* (never storage)
  before loading a tab, so a relaunch always fetches the current bundle.
- **App-only by capability.** Only the Electron preload exposes
  `window.infraDesktop`; in a browser the same web app has no fs access.
- **HTTPS-only.** Backends must be `https://` (`http://localhost` allowed for
  dev); popups are denied — http(s) popups open in the system browser (http
  on purpose: VPN-internal sites and dev shares have no TLS).
- **Pinned navigation.** In-tab navigation (server redirects included) may
  only go to the backend's own origin, its hosted-UI domain, `*.amazoncognito.com`
  and the hosts of its federated sign-in providers (`config.json.federation`;
  the rule lives in the wiki's Configuration Reference under `allowedHosts`).
  Anywhere else opens in the system browser. `openConsole` opens web
  (`http`/`https`) links only, never `file:` or custom schemes.
  IdP pages share the view but never the bridge: every IPC
  handler resolves its backend from the sender FRAME's origin, so only the
  backend's own page can call `infraDesktop`. A plugin page is that page's
  own origin (same-origin iframe), so an installed plugin can reach the
  bridge too — see the plugin trust model in the package README's Plugins
  section.

### Window sizing

Fixed minimum 1160×680 instead of a responsive squeeze — the floor is the web
app's widest docked state (icon rail 68 + content ≥560 + lg panel 480 +
chrome 48), so the layout can never be forced into horizontal scroll.

### Credentials-file details

- Only whole `[profile]` blocks are touched; the user's own profiles pass
  through untouched, and a block the app did not write (no `# expiration`
  line, not in this run's ledger) is never replaced — the write is refused
  with `profile-foreign` and the page suggests another name — nor deleted at
  logout or quit. Writes are temp-file+rename atomic, mode `0600`.
- Renames update in place: the writer remembers the last name written per
  (backend, account, role). Ledgers are keyed by registry id, not
  projectName — two deployments may share a name (staging+prod), and
  name-keyed ledgers would merge, letting one tab's rename or logout delete
  the other's blocks.
- Each block carries a `# expiration` line — ignored by the AWS SDK, purely
  for humans.

## Tray & pre-expiry notifications

`tray.js` shows a key glyph with profile freshness, driven entirely by main —
every vend already flows through `infra:write-credentials` with its
expiration.

- **States.** Fresh / expiring (dot + soonest countdown beside the icon) /
  expired (alert badge). The frontend auto-renews 5 min before expiry, so
  the thresholds sit *after* it — amber at 4 min, notification at 2 — and
  only fire when a renewal is genuinely late (offline, revoked, session
  dead).
- **Notifications.** Native banners at 2 min and at 0; clicking focuses the
  app; skipped when a fresh write lands first. The **unsigned dev build
  shows them attributed to "Electron"** until the app is signed.
- **Sleep.** Alarm timers freeze with the machine and would all fire on
  wake, for credentials that expired hours earlier and that the page is
  about to renew or (past the 12h sign-in limit) purge. An alarm more than
  a minute late therefore re-arms 30 s out instead of speaking; by then the
  page has re-upserted (fresh timers) or logged out (`removeBackend`), and
  only a profile still on file and still expired is reported. The
  pre-expiry alarm never fires for an expiry already behind us.
- **Menu.** Profiles grouped per backend (host-suffixed when names collide);
  clicking a row copies the `--profile` string. "Renew all now" re-vends the
  tray's tracked list — starred roles keep their loop, unstarred profiles
  get a one-shot renewal. A VPN status row appears when Tailscale is
  installed, kept current by the page's own polling.
- **Icon plumbing.** Native menus need real images: `shell.js` rasterizes
  the glyphs to PNG data URLs (main has no DOM), sent once over
  `shell:tray-icons`; menu-bar glyphs are macOS template images.
- **Lifecycle.** Ledger entries survive a tab *disconnect* on purpose — the
  profiles stay in the file, so their expiry warnings stay accurate — but
  the tab's login session is cleared the moment you disconnect. Saved
  deployments that don't answer at startup become inert "unreachable" tabs
  with a remove button. Neither a disconnect nor that remove button forgets
  the deployment's address: `recents.json` (next to `backends.json` in the
  userData folder, 20 rows, newest first, one per origin) keeps every
  deployment connected at least once, and the connect screen lists the ones
  not open as a tab under **Recently connected** — click to reconnect (a
  saved-but-unreachable one keeps its registry id, so its login session
  survives), ✕ → native confirm → the row is gone, and so is its unreachable
  tab if it had one. Only that ✕ removes a row. Logout drops that backend's entries with its
  profiles. With several backends, the menu-bar countdown is prefixed with
  the project whose renewal is soonest-late.
- **Session row.** The page passes when its sign-in ends over
  `infraDesktop.sessionEnds(endsAt)` (a timestamp, nothing else; null on sign-out).
  Each backend's group opens with "Session · ends 6:40 PM" — a backend with
  nothing vended yet still gets its group for it — and with one backend the
  tray's hover tooltip says the same. "Renew sign-in…" right under it brings
  that backend's tab forward and sends `infra:renew-sign-in`; the page opens
  its sign-in-again form while the running session (credentials, VPN) stays
  up until the new sign-in replaces it. The 15-minute warning itself is the
  page's `session` pop-up kind (below), not a tray alarm, so it honours the
  Notifications settings and opens the sign-in page on click. The row goes
  with a logout or a tab disconnect.
- **Page-raised notifications** go through the bridge — see "Notifications"
  below.

## Notifications

Two sources share the one OS surface:

The first launch of each build posts one silent notification on purpose: macOS asks "allow
notifications?" only when an app first posts one, and a prompt that lands while the app is in
the tray is easy to miss for good. If nothing ever pops up, check System Settings →
Notifications → Infra Client.

- **Raised by the shell itself** (no page involved): credentials
  expiring/expired (above, audible on purpose), the first hide-to-tray
  notice, and **VPN disconnected** — the tailnet stepped from connected to
  stopped/needs-login without the shell having run a login, switch or logout
  itself (node expired server-side, daemon logged out). One per 5 minutes,
  named after the site the tunnel was on ("The <site> site dropped"),
  generic when no backend could name it; clicking opens `/resources` in that
  backend's tab. A personal tailnet dropping never toasts.
- **Asked for by the page** over the bridge: `notify(title, body, { route,
  key, silent })`. Main clamps title/body to 80/200 characters (macOS
  truncates around 256 bytes), ignores a `route` that doesn't start with `/`
  or exceeds 200 characters, and treats `key` (≤120 characters) as a
  dedupe handle: a new toast with the same key replaces the live one and
  `notifyClose(key)` dismisses it — keys are scoped per backend, so tabs can't
  close each other's. Clicking focuses the app, switches to the calling
  backend's tab and delivers the route via `onOpenRoute`. `onWake` fires on
  `powerMonitor` resume so the page polls right after sleep instead of at
  its stale timers' next tick.

Platform notes:

- **Windows** shows nothing unless the process's AppUserModelID equals the
  Start Menu shortcut's. Main calls `app.setAppUserModelId(build.appId)`
  (`com.fntio.infra-client`) and the installer's shortcut carries the same
  id. Running from source has no such shortcut: create a Start Menu shortcut
  to `node_modules\electron\dist\electron.exe` with that AppUserModelID,
  or toasts stay invisible.
- **macOS** needs the signed build (dev builds attribute toasts to
  "Electron"); the first toast prompts for notification permission; a Focus
  mode suppresses them silently — the app is never told.

None of this touches the Tailscale CLI's `SHLVL` requirement below.

## Private network access (Epic 4)

`tailnet.js` drives the **locally installed** Tailscale CLI (macOS: inside
`/Applications/Tailscale.app`; else PATH). The user installs Tailscale
themselves; moving to the LocalAPI is the planned v2.

Security split: the page obtains a single-use, short-lived device key from
`POST /network/device-key` and passes **only the key + a site id** over IPC.
The per-site control-plane URLs are pinned by main from backend discovery and
must be `https://` — a spoofed page can never redirect the VPN, and an
unknown site id is refused.

Connect = `tailscale login --login-server <site control> --auth-key <key>`,
then `tailscale set --accept-routes` (accepting advertised routes is what
makes the VPCs reachable; the first login can be slow — daemon start, NAT
probing). Each SITE gets its own saved tailscale profile; a saved profile
tries `tailscale switch` first (fast, no key spent), falling back to a fresh
login. The active site is derived from the profile's tailnet name — primarily
by matching the site's control-plane host (unique per deployment); the
`<site>.tail.internal` MagicDNS fallback is honored only for the backend's
own site ids, so another deployment's tunnel is never claimed. A backend
whose sites don't match the active tailnet shows its pill *off*
(`foreignTailnet`), not "Connected" — the daemon is machine-global but the
connection belongs to one backend.

Teardown is scoped: the in-page Disconnect and a backend's logout log out
only THAT backend's profiles (active and dormant) — and if the active
profile wasn't among them, the daemon is switched back to it, so taking one
backend's dormant profiles down never strands a neighbor's live tunnel. The
tray's Disconnect and Quit are machine-level: every profile pinned this run,
including a disconnected tab's (its tunnel deliberately survives the tab).
When the app owns the tunnel but can't identify its profile (a pre-sites
enrollment presents an unmatchable name), teardown falls back to a bare
logout of the current profile — but never one that maps to a known control
plane outside the requested set. A failed switch/login rolls back to
whichever app profile was current — any backend's, but never a
foreign/personal profile (restoring one would also rewrite its prefs).
`tailscale logout` removes a profile; the node expires server-side.
Residual caveat: two backends sharing a site id are indistinguishable only
on the MagicDNS fallback path (pre-sites enrollments); host matching decides
everywhere else.

`tailnet.js` classifies CLI failures into stable codes (`not-installed`,
`daemon-not-running`, `key-rejected`, `timeout`, `cli-error`) plus a
`daemon-off` status; raw stderr travels in `detail` for the console, never
the UI. The guided setup dialog derives its step from `status()`.
`preload.js` also exposes `platform` and `network.probe(host, port)` — the
resource dialog's "Test connection", deliberately narrow: validated
host/port, one probe at a time, only while the VPN is up.

### Switching sites never enrolls a new device

The page first calls `network.connect('', siteId)` (an empty key). The shell switches to the
saved Tailscale profile for that site when it has one, and otherwise answers
`{ ok: false, code: 'needs-key' }` without touching the tunnel; only then does the page mint a
device key and call `connect(key, siteId)`. So a device-enrollment row on the Activity page means
a real first login to that site, not a switch. Older pages (no `network.lazyKey` on the bridge)
keep minting first; the key expires unused on a switch, as before.

### The CLI needs `SHLVL` (macOS)

`/Applications/Tailscale.app/Contents/MacOS/Tailscale` is the GUI and the CLI
in one binary; it decides which it is by whether `SHLVL` is in its
environment. A Dock-launched Electron app has no `SHLVL`, so the CLI tried to
start the GUI, printed "The Tailscale GUI failed to start (CLIError 3)" and
exited 0 — `login` looked successful while nothing happened, and `status`
came back as non-JSON, so the pill sat on "unknown" (found 2026-09-08 after
a day of "Connected the client, but the network hasn't confirmed yet").
`tailnet.js` now sets `SHLVL=1` on every spawn and treats that stdout as
`daemon-not-running`. Launching the app from a terminal (`open -a "Infra
Client"`) inherits the shell's `SHLVL`, which is why manual test launches
never showed it.

### Sharing a local port (dev shares)

**Using it.** Connect the network (the pill at the bottom of the sidebar),
open **Network → Share a local port**, enter the port your dev server listens
on, pick teammates or groups, choose how long, **Start sharing**. If you have
another device enrolled on the site (a remote dev box joined with an access
token, say), **Serve from** lets you pick it instead of this laptop; such a
share is always open to your own devices, so teammates are optional. Teammates see it
under **Network → Dev shares → Shared with me** with a ready-made
`http://<your-laptop>.<site>.tail.internal:<port>` link. Their app must be
connected to the same site: that network's group on the Network page (on a
single-site deployment, the **Shared with me** box's bar) offers **Connect**
(or **Switch & connect**) until it is — the same control a VPC bar has — and
the Connect pill's chooser lists every site; nobody needs a VPC on the site
to join it, the share is the grant. A first-time joiner waits for the next reconciler pass (≤5 min) unless
someone triggers one (stop and re-create the share, or admin **Sync now**).
Stop it from the card, from the tray (**Shares** → **Stop sharing**), or let
it expire. Plain `http`: the VPN encrypts it end to
end, but the browser will say "Not secure" — see why below.

**How it works.** The page creates the share through the API (a grant like
any resource grant), then hands main `{ shareId, port }` over IPC and main
runs `tailscale serve --bg --http=<port> <port>`: Tailscale listens on the
laptop's tailnet address and forwards to `127.0.0.1:<port>`, so a dev server
bound to localhost is reachable by whoever the ACL admits. Main owns the list
of running serves (`activeShares`); `disconnectHosts` — the one place tunnels
end (in-page Disconnect, tray Disconnect, logout, Quit) — stops the affected
backends' serves first, a site switch or fresh login stops every backend's
(the daemon moves for all of them), and closing a tab stops that tab's. So a
serve can never outlive the tunnel that authorised it. After a crash the
profile still holds the old `--bg` config, so the first successful connect of
a run resets the profile's serves before anything of ours starts. The page
re-syncs on load and every minute while visible (`shares.list` vs the API's
list), which also restarts serves after a relaunch. Only the ACL grants
access: `serve` exposes the port to the tailnet, and the reconciler's
per-grantee rule is what lets a specific teammate through.

**"404 page not found" when opening the link** (plain text, not your dev
server's page): the link uses the tailnet IP and the relay only answers to
the node's MagicDNS name — `tailscale serve` matches on the Host header. A
share created on a desktop build that couldn't report the hostname (before
run 9, 2026-09-14) keeps that IP link for its lifetime: stop it and share
the port again on the current build, and the link becomes
`http://<laptop>.<site>.tail.internal:<port>`. The IP form only works with
the bind-to-0.0.0.0 fallback.

**HTTP, not HTTPS.** `tailscale serve --https` needs a certificate that
Tailscale's control plane issues for `*.ts.net`; Headscale has no equivalent,
so HTTPS mode refuses to start. Revisit if Headscale gains cert issuance.

**If the card says "Not serving"**: the relay isn't running on this device —
the reason sits under the message (older Tailscale, `serve` refused, a
desktop build that predates shares). **"Paused"** just means your VPN is off
or on a different site; the network's bar offers **Connect** / **Switch &
connect** and the relay resumes when you're back on that site. The share is still
granted — start the dev server on all interfaces (`ng serve --host 0.0.0.0`,
`--host 0.0.0.0` for most servers) and the ACL rule alone makes it reachable,
whatever the cause. Needs Tailscale 1.52 or newer for the `serve --http`
syntax.

## Connecting for the first time (end users)

The pill's setup dialog walks users through this; the manual version:

1. **Install Tailscale** from tailscale.com/download (macOS: App Store or
   direct — both put the CLI in `/Applications/Tailscale.app`; Windows: the
   installer starts the service).
2. **macOS only: open Tailscale once** and Allow adding a VPN configuration.
   No Tailscale account is needed — identity comes from the app login.
3. **Click "Connect network"** (pill at the bottom of the sidebar). The app
   mints a single-use device key (30-min TTL, bound to your login) and runs
   the CLI for you.
4. **First connection only: wait up to 5 minutes.** The ACL reconciler only
   writes rules for users Headscale has seen, so access rules render on the
   first 5-minute pass *after* enrollment. Later connects skip this; grant
   changes always follow the same ≤5-min cadence.

Troubleshooting:

| Symptom | Cause / fix |
|---|---|
| Pill says "Set up network" | Tailscale missing or daemon not running — the dialog says which. |
| "The network rejected the connection key…" | Key expired/used; the app auto-retried already. Persistent → admin checks the key minter. |
| Connected but a resource times out | Rules still syncing (≤5 min), no grant, or the resource's SG doesn't allow the connector. "Test connection" separates vpn-down from no-answer. |
| Worked before, dead after a long absence | Devices offline 7+ days expire server-side — click Connect again. |
| Personal Tailscale on the same machine | One control server at a time: Connect points the daemon at the org network. Teardown only touches the app's own profiles (see "Teardown is scoped" above). |

## Several backends at once (end users)

- **Logins, notifications, stars, theme** — independent per tab (separate
  session partitions).
- **VPN** — the machine has ONE tunnel; each tab's pill reflects *its own*
  network, and connecting switches the whole machine. A tab's
  disconnect/logout drops only its profiles; the tray's Disconnect and Quit
  drop all.
- **`~/.aws/credentials`** — one file; a name collision between backends is
  refused with a rename hint, never silently overwritten.
- **Offline at launch** — a saved deployment nobody could reach (no DNS, no
  route, a timeout; typically the app reopening after a reboot before Wi-Fi
  is back) shows as **· waiting for network** and is re-probed on its own:
  every 10 s while the machine is offline, then with backoff for about ten
  minutes once it is online, after which the tab reads **· unreachable**. A
  host that answers but is not an Infra deployment is unreachable at once.
  Clicking a waiting or unreachable tab retries it now; its ✕ removes it.
- **Closing a tab doesn't lose the address** — the ＋ button's connect screen
  lists every deployment you connected to before under **Recently
  connected**; click one to reconnect, or its ✕ (and confirm) to forget it
  for good.
- **AWS console** — opens in the system browser, which by default keeps ONE
  console session. One-time fix: AWS console account menu → **Turn on
  multi-session** (up to 5 concurrent; see frontend/README.md "Opening the
  AWS console").

## Deep links (`infraclient://`)

An `infraclient://` link is the deployment's https URL with the scheme
swapped: `infraclient://portal.example.com/admin/requests`. Opening one
brings the app forward and loads that path in the matching tab.

- **Connected deployment** → that tab switches and loads the path (a tab
  reload, like a browser refresh — unless it is already on that exact page).
  Signed out? The web app's login bounce brings the path back after sign-in.
- **Unknown deployment** → the connect prompt opens prefilled with the
  address and the user clicks Connect; the path loads once connected. A link
  never attaches a backend on its own — a connected tab gets the credentials
  bridge, so that stays a human decision.
- **Saved but unreachable at startup** → the prompt opens prefilled with
  "Reconnecting…" while it is retried once; still down → the prompt stays
  for a manual retry.

Where links come from: the web login page shows **Open in the desktop
app** for the page it is on, invitation included — an invite email's
"Set your password" link lands there, and one click continues in the app
on the set-password screen. Emails carry only https links on purpose: many
mail clients refuse to render custom-scheme links (Gmail web, for one), and
Cognito's invite template is only documented to substitute `{####}` once.
Any web URL can be turned into a link the same way.

**Packaged builds only on macOS**: the handler is the `CFBundleURLTypes`
entry electron-builder writes from `build.protocols` in package.json;
`npm start` never registers it. Windows dev registers the running Electron
+ `main.js` at startup (Electron's dev-registration path is Windows-only);
Linux needs a packaged build for the `.desktop` handler. A link into a
running app arrives as macOS `open-url` or, on Windows/Linux, as an
argument of the second instance the single-instance lock hands over; a
link received during startup is queued until the saved backends are
restored. CI builds macOS (signed, `desktop-build.yml`) and Windows
(unsigned, the `windows` job of `release.yml`); link handling is verified
on macOS only. Test a build from a terminal:

```bash
open "infraclient://<host>/accounts"
```

Parsing is `deeplink.js` (host allow-pattern, no credentials, no `//`
paths); navigation is same-origin only. `SHLVL` still applies — a link
launches the app from the OS, so the Tailscale CLI caveat above is
unchanged.

## Files

| File | Role |
|------|------|
| `main.js` | Main process: window, tabs, IPC, boot, URL-scheme enforcement, `infraclient://` links |
| `deeplink.js` | Parses `infraclient://` links (the web URL with the scheme swapped) |
| `credentials-writer.js` | Serialized `~/.aws/credentials` writer + rename/cleanup |
| `registry.js` | Persist connected backends across launches |
| `recents.js` | Remember every deployment connected at least once (the connect screen's "Recently connected" list) |
| `preload.js` | The safe `window.infraDesktop` bridge |
| `shell.html` / `shell.js` | Outer chrome: tab bar + first-run connect; rasterizes tray artwork |
| `tray.js` | Menu-bar freshness indicator + pre-expiry notifications |
| `tailnet.js` | Drives the locally installed Tailscale CLI (Epic 4) |
| `scripts/dist.js` | Packages the ONE public product binary (constants; no deployment config) |

## Run it (development)

```bash
cd desktop
npm install
npm start
```

Point the first tab at a deployed site, or at `http://localhost:4200` with
`ng serve` running in `../frontend` (localhost is the one http exception).

### macOS: "Electron … contains malware"

Gatekeeper deletes the **unsigned** dev Electron binary on launch (a false
positive). To run locally, no Apple cert needed:

```bash
rm -rf node_modules/electron && npm install electron@^41 --no-save
xattr -cr node_modules/electron/dist/Electron.app          # clear quarantine
codesign --force --deep --sign - node_modules/electron/dist/Electron.app  # ad-hoc self-sign
npm start
```

If still blocked: **System Settings → Privacy & Security → "Open Anyway"**.

> After deploying a frontend change, **tray icon → Quit and remove
> credentials**, then relaunch — Cmd+Q only hides to the tray, and a plain
> reload can serve the old bundle. The relaunch fetches fresh code.

## Branding (runtime strings)

Window title, tray tooltip/menu, and the hide-to-tray notification use the
top-level `productName` in the *packed* package.json (injected by
`scripts/dist.js`), falling back to `build.productName` in dev. In-app
branding always comes from whichever backend a tab shows.

Deployment URLs are **deliberately not baked into the install** — one public
binary serves every deployment; each user enters their project's URL on
first run.

## Package (distribution)

```bash
npm run dist            # the public product binary in desktop/dist/
npm run dist -- --win   # extra args pass through to electron-builder
```

ONE public binary for all deployments (wiki: Releasing): `scripts/dist.js` carries the product constants and reads no
deployment config.

| Installer value | Comes from |
|---|---|
| App / installer name | `PRODUCT_NAME` in `scripts/dist.js` |
| Bundle id (`appId`) | `APP_ID` in `scripts/dist.js` — `com.fntio.infra-client`, **immutable once anyone installs** (anchors auto-update, keychain, data folder) |
| Runtime strings + data dir | top-level `productName` injected into the packed package.json (`extraMetadata`) |

The checked-in package.json deliberately has **no top-level `productName`** —
`app.getName()` would pick it up in dev and move the userData folder,
orphaning existing sessions. The packaged app gets it injected at build
time, giving each client's install its own data folder.

**Unsigned macOS builds** (no Apple cert in the keychain) work — signing is
skipped. Fine on the build machine; on *other* Macs the app is blocked until
"Open Anyway" (internal testing only), and mac passkeys and macOS
self-update need a signed build. Windows builds are unsigned by design for
now; see "Windows installer" below.

## Windows installer

The `windows` job of `release.yml` builds `infra-client-<version>-x64.exe`
(NSIS, `npm run dist -- --win` on a Windows runner) and attaches it to the
Release next to the macOS files. It is **unsigned for now**: a Windows
code-signing certificate has to live in a cloud signing service (Azure
Trusted Signing is the practical one: an Azure account, a one-time
organisation validation, then a few workflow lines), and whether to pay for
that is still an open decision.

**First launch of an unsigned build.** Running the downloaded installer
opens SmartScreen's blue "Windows protected your PC" screen with no obvious
way forward. Click **More info**, then **Run anyway**. That happens once per
downloaded file; the installed app starts normally afterwards. Machines
whose policy hides the Run anyway button need a signed installer.

Windows Hello passkeys work in this build; see "Passkeys (per platform)".

## Code signing & notarization (macOS)

**Nothing per client.** FNTIO's one Developer ID cert signs every installer;
clients never enroll with Apple or hold a cert — their users just download
and open.

`build.mac` sets `hardenedRuntime` + `notarize` with entitlements in
`build/entitlements.mac.plist` (the V8-JIT pair plus the Touch ID passkey
keychain group and app/team identifiers — restricted entitlements authorized
by the embedded `build/Infra_Client_Developer_ID.provisionprofile`), and
`.github/workflows/desktop-build.yml` builds the installer — a test build on
manual trigger, a release build when `release.yml` calls it on a version tag
(wiki: Releasing). Unsigned while the signing secrets are absent, signed +
notarized + Gatekeeper-verified when they exist; a release build without
them fails outright. Secrets are per repository, so every repository that
cuts installers needs all five (see below); a clone without them yields an
undistributable `-UNSIGNED` test artifact.

The workflow runs on `macos-15`, not `macos-latest`: on 2026-09-08 the
`macos-26` image's OS update (25.5 → 25.6) made electron-builder's temporary
signing keychain fail with "SecKeychainUnlock: The user name or passphrase you
entered is not correct" before any signing happened. Re-test `macos-latest`
only with a newer electron-builder (26.16+ on the v26 tag) and a spare run.

One-time FNTIO setup (**done 2026-09-01** — team `68BFH4A9T6`, cert
"Developer ID Application: FNTIO GmbH"): Apple **Organization** enrollment
($99/yr) → a **Developer ID Application** cert (Account Holder creates or
approves; CSR from the build machine's Keychain, export as `.p12`) → an App
Store Connect **API key** (`.p8`, downloadable once) for notarization. Both
secrets live in the password manager, then as the five Actions **repository
secrets** (Secrets tab, not Variables) named in the workflow header.
Verified 2026-09-01: Gatekeeper-verify green; installed via browser
download → `spctl` "accepted, Notarized Developer ID", staple valid. A new
team's first-ever notarization can sit in Apple's queue ~an hour; later
runs take minutes.

**Adding the secrets to another repository** (the release repo, a fork that
cuts installers): Settings → Secrets and variables → Actions → New
repository secret, five times, the names from the workflow header, values
from the password manager. To regenerate `CSC_LINK`: Keychain Access → My
Certificates → "Developer ID Application: FNTIO GmbH" → right-click →
Export as `.p12` with a password (that password is `CSC_KEY_PASSWORD`), then
`base64 -i cert.p12 | pbcopy`. The `.p8` cannot be downloaded a second time:
if it is gone, App Store Connect → Users and Access → Integrations → App
Store Connect API → generate a new key (Developer role), download it once,
and update `APPLE_API_KEY_ID` alongside `APPLE_API_P8`.

## Publishing

Installers ship on the GitHub Releases of the public repo,
FNTIO/aws-infrastructure-client (wiki: Releasing): `release.yml` in the
private source repo runs on a `v<version>` tag there, calls
`desktop-build.yml` with `release: true` (signing mandatory, installer named
`infra-client-<version>-<arch>.dmg`) and attaches the dmg + zip to the
Release next to the package tarballs and the unsigned Windows `.exe` from
its own `windows` job (see "Windows installer"). The
desktop version in package.json equals the package version from 0.1.14 on;
the workflow refuses a release where the two differ.
The macOS build is Apple-silicon only (`-arm64.dmg`); an Intel Mac needs a
universal build (`npm run dist -- --mac --universal`, roughly twice the size),
which no release has shipped so far.

**Self-update (`updater.js`).** A packaged app polls the Release feed one
minute after launch and every six hours: electron-updater reads
`app-update.yml` in the bundle, which electron-builder writes from
`build.publish` in package.json (`FNTIO/aws-infrastructure-client`), and compares
`latest-mac.yml` / `latest.yml` on the latest Release with its own version.
Those feed files, and the `.blockmap` files that let a later update download
only the changed blocks, are attached to every Release by `release.yml`;
every `npm run dist` in CI passes `--publish never` so electron-builder never
tries to create the Release itself. The feed repository is as permanent as
the `appId`: a rename silently ends updates for every installed app, since
failed checks are retried quietly and never shown.

- **macOS:** the update downloads in the background. When it is ready the tray
  gets an "Update <version> · Restart to install" row and a toast; the row runs
  the same teardown as Quit (credentials removed, tunnel dropped) and the
  installer relaunches the new version. A plain tray Quit installs it too, so
  the next launch is already current. Needs a signed build; an unsigned local
  build only logs an error.
- **Windows:** the installer is unsigned (see "Windows installer"), so the app
  cannot verify a download's publisher and never fetches or runs one on its
  own. It only announces: "Update <version> available · Open download page" in
  the tray and a toast; the row opens the Release page. Switch
  `updater.js` to the macOS behaviour once the `.exe` is signed.
- **Check for Updates…** sits below **About Infra Client** in the macOS app
  menu, in the **Help** menu on Windows and Linux, and in the tray while no
  update row is shown. It checks the feed at once and always answers in a
  dialog: the latest version, an update (a restart on macOS once downloaded,
  the Release page on Windows) or the error. A check already running is
  shared, not sent twice, and the toast for that update is left out.
- **Dev runs** (`npm start`) never touch the updater; Check for Updates… says
  so.

A rehearsal (manual `desktop-build` run) also uploads `latest-mac.yml`; it
is harmless there, since only Release assets are ever polled.

## Passkeys (per platform)

The frontend gates passkey sign-in/management on
`DesktopBridgeService.passkeyCapable` (browser: always; desktop: by
`process.platform` from preload.js).

- **Windows — enabled, zero shell work.** Chromium delegates WebAuthn to the
  OS (webauthn.dll → native Windows Hello: face/fingerprint/PIN, security
  key, or phone via QR). App and browser passkeys on the same machine are
  the same Hello credentials.
- **macOS — enabled in signed packaged builds (2026-09-02).** Touch ID via
  `app.configureWebAuthn` with keychain group
  `68BFH4A9T6.com.fntio.infra-client.webauthn` (must match
  build/entitlements.mac.plist). Ad-hoc/dev builds hang with no dialog, so
  main gates on `app.isPackaged` and the preload advertises `passkeyCapable`
  over the bridge — the web app trusts that flag, older shells fall back to
  the win32 rule. Several matching passkeys → native chooser (unhandled
  would NotAllowedError). Credentials are Secure-Enclave device-bound, not
  iCloud passkeys — a user enrolls one per Mac, and browsers on that Mac
  can't see it (nor the app theirs); the login page tells that apart from a
  cancel via a device-local record (frontend/README.md "Passkeys are per
  browser/app"). Verify on a signed install:
  Passkeys → "Add passkey" opens the Touch ID sheet; sign out → passkey
  sign-in lands in the app. Verified working 2026-09-03 on a signed local
  0.1.0 build.
- **Linux — gated off** (unvalidated).

**Windows verification checklist** (needs a real Windows 10/11 machine):
install + sign in → Passkeys → "Add passkey" opens the native Hello sheet;
the passkey appears in the list (and in Cognito). Sign out → the chooser
offers "Passkey"; using it opens Hello and lands in the app. Confirm a
browser on the same machine sees the same passkey, and deleting it removes
it from the sign-in options.

## Dependency pins & overrides

The `override` in package.json is load-bearing; don't remove it just because
installs succeed:

- **`brace-expansion` ^5.0.12** — electron-builder still pins vulnerable
  transitive ranges; safe to drop only when `npm audit` is clean without it.

If the app crashes at startup with `Cannot read properties of undefined` on
an electron import, check for `ELECTRON_RUN_AS_NODE=1` in the environment —
shells spawned by VS Code's extension host (e.g. Claude Code sessions)
inherit it, and it makes `require('electron')` return a path string instead
of the API. Launch with `env -u ELECTRON_RUN_AS_NODE npm start`. Normal
terminals are unaffected.
