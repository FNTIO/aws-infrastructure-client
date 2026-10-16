# @fntio/infra-client-plugin-sdk

The contract every part of a customer plugin agrees on: the manifest a deployment
registers, the catalog record it becomes, the discovery responses the portal reads,
the messages a plugin iframe exchanges with the portal shell, and the context the
shared authorizer hands a plugin Lambda. Types plus runtime validators, no runtime
dependencies.

Published to npm as `@fntio/infra-client-plugin-sdk`, beside `-cdk`, `-ui` and `-example`: the
four plugin packages share one version, release together, and every GitHub Release carries their
tarballs.

## Entry points

| Import | For | Contains |
| --- | --- | --- |
| `@fntio/infra-client-plugin-sdk` | anyone | the contracts every entry shares: types, validators, path and key helpers (no runtime code) |
| `@fntio/infra-client-plugin-sdk/browser` | plugin frontends | `connectToInfraClient`, the `PluginContext` it resolves, `context.api`, theme application, message protocol, theme tokens, discovery types |
| `@fntio/infra-client-plugin-sdk/host` | the portal shell, the dev host | `createPluginHost`: the host side of the protocol |
| `@fntio/infra-client-plugin-sdk/backend` | plugin Lambdas, the core API | manifest + validator, catalog record, access target keys, authorizer context, path helpers, `pluginAuthorizerContextOf`, `pluginRoutePath`, `rebasePluginEvent`, `createPluginLogger` |
| `@fntio/infra-client-plugin-sdk/fixtures` | tests in any package, local plugin development | valid manifests in every shape, one invalid manifest per rule, sample payloads, `createFakeWindowPair`, `createDevHost` |

The browser, host and backend entries import nothing external; a test fails if that changes.

## Contracts

- **Manifest** (`PluginManifestV1`, `validatePluginManifest`, `assertPluginManifest`).
  `schemaVersion: 1`, `hostApiVersion: 1`, id, display name, version, enabled flag,
  account bindings, `user` and/or `admin` permissions, zero to two UI entries, routes.
  The validator reports every problem at once with a stable `code`; the codes are the
  `PluginValidationCode` union. `admin` implies `user` only when both are declared
  (`pluginPermissionsImpliedBy`).
- **Paths.** Routes mount at `/api/plugins/<id>/accounts/{accountNumber}<path>`
  (`pluginRouteResourcePath`); assets at `/plugin-assets/<id>/<version>-<hash>/`
  (`pluginAssetPrefix`). `{accountNumber}` is reserved for the platform.
- **Access target** (`pluginTargetKey`): `plugin#<id>#<account>#<user|admin>`, the
  Access-table target string for plugin grants.
- **Catalog record** (`PluginCatalogRecordV1`, `pluginCatalogStatus`): what the
  PluginCatalog table stores per plugin. Holds no user grants. Status is `active`,
  `disabled`, `removed` (tombstone) or `unsupported`.
- **Discovery** (`PluginDiscoveryResponseV1` for `GET /api/plugins`,
  `PluginAdminCatalogResponseV1` for `GET /api/admin/plugins`).
- **Messages** (`createPluginMessage`, `parsePluginMessage`): the `postMessage`
  envelope `{ protocol: "infra-client-plugin", version: 2, type, instanceId, requestId?, payload }`.
  Host → plugin: `init`, `sessionChanged`, `sessionEnded`, `accessChanged`,
  `themeChanged`. Plugin → host: `ready`, `requestSessionRefresh`,
  `requestAccessRefresh`. `parsePluginMessage` returns `null` for
  anything malformed; callers still check `event.source` and `event.origin`.
- **Theme** (`PLUGIN_THEME_TOKENS`, `PluginTheme`): the documented subset of the
  portal's CSS custom properties, plus appearance and branding.
- **Authorizer context** (`PluginAuthorizerContextV1`, `parsePluginAuthorizerContext`):
  the string fields the shared authorizer attaches to an allowed request. Parsing fails
  closed.

## Browser SDK

A plugin frontend runs in an iframe on the portal's origin and never signs in itself. The
host owns sign-in and the refresh token; the SDK receives the current bearer token over
`postMessage`, keeps it in memory, and hands it to requests the iframe makes itself.

```ts
import { connectToInfraClient } from "@fntio/infra-client-plugin-sdk/browser";

const context = await connectToInfraClient();          // posts `ready`, resolves on `init`
const [account] = context.accounts();                  // every account the caller may use; choosing one is yours
const items = await context.api.get(`accounts/${account.accountNumber}/parameters`);
context.on("accessChanged", () => render());
context.on("themeChanged", () => {});                  // the SDK already re-applied the tokens
context.on("sessionEnded", () => showSignedOut());
```

`connectToInfraClient` rejects with `not_framed` when the page is a top-level document (a user
opened the plugin URL directly), `invalid_options` when something it needs is missing or the
host window refuses the message (outside a browser pass `hostWindow`, `hostOrigin`, `listenOn`
and `fetch`), `incompatible_host` when the host speaks another protocol version, and
`handshake_timeout` (10 s, re-announcing every second; 0 disables) when no `init` arrives;
call it again to retry. Every error is a `PluginSdkError` with a `code`.

**Session.** `context.session.current()` is the token and expiry. `token()` returns the current
token at once while it is valid; inside the last 30 s (`refreshLeadMs`) it also asks the host to
renew in the background, and only once the token has expired does it wait for the host. Any
`sessionChanged` the host sends satisfies a pending refresh, whether it answers the request or
was pushed by the host's own timer. `refresh(reason)` asks outright; concurrent callers share
one round trip. A refresh nobody answers within 15 s (`refreshTimeoutMs`, 0 disables) rejects
with `refresh_timeout`. After the session ends every call rejects with `session_ended`.

**Requests.** `context.api` (`get`/`post`/`put`/`patch`/`delete` for JSON, `request` for a raw
`Response`, `url` for other clients) resolves paths under `plugin.apiBaseUrl`, refuses absolute
URLs and `..` segments so the token is not sent outside the plugin's own API root by mistake (a
guardrail, not a boundary — see the trust model below), and sends `Authorization: Bearer`. After an
authentication-layer 401 it asks the host to renew and retries exactly once: the authorizer
rejects before plugin code runs, so the retry cannot repeat a completed write. The retry is
skipped, and the 401 surfaces, when the body is a stream, when the account in the request path
(`accounts/<accountNumber>/…`, read by `pluginRequestAccount`) is not in `accounts()` at the 401 or
no longer there once the renewal returns, or when the host hands back the very token that was
rejected (`canRetryAfterUnauthorized` is that rule, shared with the Angular interceptor). A
request whose path names no account is not held to the list. Timeouts
(`timeoutMs`, which also covers reading the body), 5xx and 403 are never retried. A 403 also
sends `requestAccessRefresh` (`forbidden`) so the host reloads discovery; pass
`accessRefreshOnForbidden: false` to keep that manual. Plugin business handlers should answer
with domain 4xx codes, never 401.

**Context.** `accounts()`, `permissionsFor(accountNumber)`,
`hasPermission(permission, accountNumber)`, `entryAvailable()` and `theme()` follow
`accessChanged` and `themeChanged`. `accounts()` is every account the caller may use on this
entry, each with its permissions; an account outside the list has none. The portal tracks no
selected account: which one the plugin works in, if it has the notion at all, is the plugin's
own state, as is any picker it draws. Re-check that state on `accessChanged`, since the account
may have left the list.

**Theme.** On `init` and every `themeChanged` the SDK writes the documented tokens into one
`<style>` element (`applyPluginTheme`) and sets `data-theme="light|dark"` on `<html>`. An
iframe inherits none of the parent's custom properties, so this is the only way in. Pass
`applyTheme: false` to theme the document yourself, or your own function to receive each
theme.

**End of session.** `sessionEnded` marks the context ended, fails pending refreshes with
`session_ended`, drops listeners and stops listening: a late message from the old frame
cannot restore a session. `dispose()` is the plugin's own cleanup and does the same locally.

**What the shipped portal sends.** The contract allows more than the portal uses today
(`frontend/src/app/features/plugins/plugin-page.component.ts`), so handle every value but
expect these: `sessionEnded` arrives with reason `expired` (a renewal failed: the 12 h wall)
or `unloaded` (the user left the page, reloaded the frame, or the entry vanished from
discovery), never `signedOut` — signing out navigates away, which is `unloaded`.
`accessChanged` always carries `entryAvailable: true`: when the entry itself is revoked or
disabled the portal tears the frame down and shows its own "access ended" page instead.
`init.user` has `subject`, `principalType: "user"` and `email` when known; `displayName` is
never set. `createDevHost` (under Local development) is broader than the portal on all three
points.

## Host adapter

`createPluginHost` (entry `/host`) is the portal side. It validates `event.source` against
the iframe's window and `event.origin` against the expected origin, answers `ready` with
`init` built from `initialState()` (read each time, so a reloaded frame starts current; `init` and
every `sessionChanged` carry exactly the documented fields — `pluginSessionOf` — so a state object
that also holds a refresh token never crosses into the frame), forwards
`sendSession`/`sendAccess`/`sendTheme`, coalesces
`requestSessionRefresh` into one `refreshSession()` call and replies to each request id, and
drops messages from a replaced instance. A `null`, rejecting or throwing renewal sends
`sessionEnded(expired)` and ends the host. `onIncompatible` reports a frame on another protocol
version (the portal shows its "built for a different version" page); `onHandshakeTimeout` fires when no `ready` arrives (0 disables) — it counts from when the
host is created, which is before the frame's assets have loaded, so allow for that or pass 0 and
time out yourself. `end(reason)` is terminal; `dispose()` sends `unloaded` from the host's own
teardown. `onEnded` fires for every `end`/`dispose`, connected or not, so discriminate on `reason`.
Message classification (`inspectPluginMessage`) lives in the contracts, shared with the plugin side.

A renewal answers once, and only the frame that asked for it: a frame that reloads mid-renewal is
not given the answer, and its failure does not end the session of the frame that replaced it.

Both ends require an exact origin match. Plugins are same-origin by design, so do not render the
frame with a `sandbox` attribute that omits `allow-same-origin` — the document's origin becomes
`null`, every message is dropped, and the only symptom is a handshake timeout.

**Trust model.** Because the plugin page is served from the portal's own origin, it runs with the
signed-in user's full authority: it could read the portal's tokens from `localStorage`, call any
core API as that user and script the parent document. The message protocol and `context.api`'s
path pinning protect a well-behaved plugin from mistakes; they are not a sandbox. Installing a
plugin means trusting its author and its dependencies as you trust the portal bundle. The portal
enforces a Content-Security-Policy on `/plugin-assets/*` that lets a plugin page load from and talk
to the portal only — no third-party scripts, no sending data to other hosts.

## Local development

`createDevHost` (entry `/fixtures`) drives a plugin through the real protocol with a fake
identity and fixture tokens (`fixture-token-N`, accepted by no backend). Create it before
setting the iframe's `src`:

```ts
import { createDevHost } from "@fntio/infra-client-plugin-sdk/fixtures";

const frame = document.querySelector("iframe")!;
const host = createDevHost({ frame, listenOn: window, origin: location.origin, entry: "admin", onEvent: console.log });
frame.src = "/plugin/index.html#/admin";
// scenarios: host.renewSession(), host.expireSession(), host.failNextRefresh(),
// host.revoke(n), host.grant(a), host.setEntryAvailable(false),
// host.setAppearance("dark"), host.signOut(), host.failLoad()
```

`failLoad()` is the page that never loads — a wrong `entry`, an asset missing from the build, a
frame sandboxed without `allow-same-origin` — reported as `handshakeTimeout` at once rather than
after `handshakeTimeoutMs`, so a harness can exercise its own "this page did not load" state (the
portal's `timeout` state) without waiting; a version mismatch is the separate `incompatible` event.

Its defaults differ from the shipped portal on purpose, so a plugin can be exercised against
states the portal does not produce today: the user is `dev-user` with an `email` and a
`displayName` (the portal sends no `displayName`), the accounts are the sample set, tokens
live five minutes (`tokenLifetimeMs`), `setEntryAvailable(false)` sends an `accessChanged`
the portal never sends, and `signOut()` ends with reason `signedOut`, which the portal never
uses (see "What the shipped portal sends" under Browser SDK).

The usual arrangement is one dev server for the plugin's own assets, with the portal's API
proxied so `/api/plugins/<id>/...` reaches a real deployment:

```js
// vite.config.js, webpack devServer, or whatever this project already uses
proxy: { "/api": { target: "https://portal.example.com", changeOrigin: true } }
```

Point `plugin.apiBaseUrl` at whatever your dev server proxies to a real deployment or a
local backend. The fixture never bypasses production authentication: it exercises the
protocol, the theme and the error paths offline, and anything touching a real API needs a
real sign-in through the portal. For unit tests, `createFakeWindowPair` gives two windows
wired like a page and its frame (browser semantics: `postMessage` on a window delivers to
that window) and `createFakeThemeDocument` the slice of `document` the SDK themes.

## Backend handlers

A plugin route's Lambda receives the ordinary REST proxy event. The shared authorizer has
already answered who and whether: it verified the token with the core's rules (ID token for
humans, scoped access token plus a live registry row for service users), resolved the route
from the catalog by method and resource template, took the account from the path, and asked
the core's access resolver over strongly consistent reads. What it attached is scalar context,
never a token.

```ts
import { createPluginLogger, pluginAuthorizerContextOf, pluginRoutePath } from "@fntio/infra-client-plugin-sdk/backend";

export async function handler(event: APIGatewayProxyEvent) {
  const ctx = pluginAuthorizerContextOf(event);        // throws if absent or malformed: never run without it
  const log = createPluginLogger(ctx);                 // JSON lines carrying plugin, account, route, subject, correlation
  const route = pluginRoutePath(event.path, ctx);      // "/parameters/db-url" for the registered path
  log.info("listing", { route });
  ...
}
```

`ctx.accountNumber` is the account the platform authorized; a handler works in that account
and no other. `ctx.requiredPermission` is the permission the route was registered with, not
an assertion about anything else the caller holds. `rebasePluginEvent(event, ctx)` returns a
copy whose `path` is account-relative, for an Express app mounted at `/` behind a proxy
adapter. Business handlers answer domain 4xx codes, never 401: the browser SDK retries once
after a 401 on the assumption that the authorizer, not the handler, produced it.

Revocation limits: a check that begins after a revoke completed sees it (no cached decisions),
a request already authorized finishes, and a job the plugin accepted runs until the plugin's
own cancellation rules stop it.

## Agent skills

`skills/build-infra-client-plugin/` ships with this package. Point an agent at it and it will build a
plugin in the conventions of the repository it is running in, reading this README for the API rather
than carrying its own copy of it. The integration half — adding a finished plugin to a CDK application
that already exists — is `skills/integrate-infra-client-plugin/` in
`@fntio/infra-client-plugin-cdk`.

Each `SKILL.md` carries a `version` equal to the package version, so a copied skill can be checked
against the installed package.

### Making the skill available to your agent

There is no installer. For Claude Code, link (or copy) the folder into the project's `.claude/skills/`
and it appears as `/build-infra-client-plugin`:

```bash
mkdir -p .claude/skills
ln -s ../../node_modules/@fntio/infra-client-plugin-sdk/skills/build-infra-client-plugin .claude/skills/build-infra-client-plugin
# or, for a copy that survives `npm ci` and an agent that does not follow symlinks:
cp -R node_modules/@fntio/infra-client-plugin-sdk/skills/build-infra-client-plugin .claude/skills/
```

For other agents, copy the same folder into wherever that agent reads skills or instructions from,
or point it at the file directly. A copy goes stale when the package is upgraded; the `version`
line in the frontmatter says which package it came from.

## Versioning

Three numbers move independently and are checked at runtime:

| Number | Where | Bumps when |
| --- | --- | --- |
| `schemaVersion` | manifest, catalog record | the manifest shape changes incompatibly |
| `hostApiVersion` | manifest | the host stops loading plugins built for an older contract |
| `version` (protocol) | messages | the iframe message envelope or payloads change incompatibly |

The protocol is at version 2 (`PLUGIN_PROTOCOL_VERSION`, SDK 0.2.0). Version 1 (SDK 0.1.x) had
the portal track a selected account: `selectedAccount` in `init`/`contextChanged`/`accessChanged`
and a `selectAccount` request. Version 2 removes all of it, so the two do not interoperate in
either direction: a page built with SDK 0.1.x shows the portal's "built for a different version"
state until it is rebuilt against 0.2.x, and a 0.2.x page in an older portal rejects with
`incompatible_host`. `schemaVersion` and `hostApiVersion` are still 1.

A frame also reports the SDK package version it was built with (`sdkVersion` in `ready`,
surfaced by the host adapter's `onReady`). That number is informational; `protocolVersion`
is the compatibility gate.

The npm package follows semver. While it is `0.x`, an incompatible change bumps the
minor version and one of the numbers above; a compatible addition bumps the patch
version. The four plugin packages (`-sdk`, `-cdk`, `-ui`, `-example`) release together at the
same version.

## Develop

```
cd packages/infra-client-plugin-sdk
npx tsc --noEmit && npm test
```

Workspace installs run at the repository root (`npm install`), never here.
`npm run build:plugins` at the root compiles `dist/` for all four plugin packages
in dependency order; the CDK and UI packages type-check and test against this
package's `src/` directly, so no build is needed for day-to-day checks.
