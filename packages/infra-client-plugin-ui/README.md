# @fntio/infra-client-plugin-ui

Theme helpers, the portal's component styles, and an HTTP interceptor for Angular plugins.
Private until publishing is enabled.

## Theme

```ts
import { applyPluginTheme, pluginThemeCss } from "@fntio/infra-client-plugin-ui";
```

Re-exports of the SDK's browser entry for plugins that only want the tokens; the rules are
documented there (SDK README, "Browser SDK", Theme). `connectToInfraClient` already applies
the theme on `init` and `themeChanged`.

## Components

Tokens alone leave every plugin author re-inventing buttons, tables and headers, and landing somewhere
close but visibly foreign. These classes reproduce the portal's shipped control scale, type roles and
surface treatments, so a plugin page reads as part of the app without copying anything from it.

```ts
import { applyPluginUi } from "@fntio/infra-client-plugin-ui";

applyPluginUi(document);   // once, alongside connectToInfraClient()
```

`applyPluginUi` also sets the page itself up: a see-through background (the portal's own surface shows
behind the frame, in light and dark), no body margin, and the portal's text colour and typeface. Leave
`html` and `body` without a background of your own; painting `var(--background)` there gives a flat
slab that does not match the rest of the portal. Your own rules still win over these defaults.

```html
<div class="ic-card">
  <div class="ic-card-head">
    <h2 class="ic-card-title">3 parameters</h2>
    <span class="ic-caption">/myapp/prod</span>
  </div>
  <div class="ic-table-wrap">
    <table class="ic-table">…</table>
  </div>
</div>
```

| Class | For |
| --- | --- |
| `ic-page`, `ic-header`, `ic-actions` | page scaffolding |
| `ic-title`, `ic-subtitle`, `ic-card-title`, `ic-caption`, `ic-muted`, `ic-mono` | the portal's type roles |
| `ic-card`, `ic-card-head` | a panel |
| `ic-table`, `ic-table-wrap` | a table, scrolling in its own box so the frame never scrolls the portal sideways |
| `ic-btn` + `ic-btn-primary\|secondary\|outline\|ghost\|danger`, `ic-btn-sm\|lg` | buttons, on the 24/32/36px control scale inputs share |
| `ic-field`, `ic-label`, `ic-input`, `ic-select` | forms |
| `ic-badge` + `ic-badge-brand\|green\|amber\|red` | status pills; keep plain `ic-badge` for a type or a label, and colour for a state |
| `ic-empty`, `ic-error`, `ic-skeleton` | the three states every page needs |

Every value resolves from a theme token, so a customer's branding and the viewer's light or dark choice
carry through, and a test fails if a colour literal creeps in. `pluginUiCss()` returns the stylesheet for
a plugin that manages its own document.

## Angular

```ts
import { bootstrapApplication } from "@angular/platform-browser";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { InjectionToken } from "@angular/core";
import { connectToInfraClient, PluginContext } from "@fntio/infra-client-plugin-sdk/browser";
import { createPluginInterceptor } from "@fntio/infra-client-plugin-ui/angular";

export const PLUGIN = new InjectionToken<PluginContext>("infra-client plugin");

const context = await connectToInfraClient();
await bootstrapApplication(AppComponent, {
  providers: [
    { provide: PLUGIN, useValue: context },
    provideHttpClient(withInterceptors([createPluginInterceptor(context)])),
  ],
});
```

`createPluginInterceptor(context)` attaches the current bearer token to requests whose URL
starts with `context.plugin.apiBaseUrl` (build them with `context.api.url(path)`), leaves
other URLs untouched, and after an authentication-layer 401 renews through the host and
retries once under the SDK's shared rule (`canRetryAfterUnauthorized`): never after 403, 5xx
or a timeout, never with a streamed body, never for an account in the request path that is no longer in
`context.accounts()`, never with the same token again. Like `context.api`, a 403 asks the host to refresh discovery unless
`accessRefreshOnForbidden: false`. The match is a plain prefix test, so absolute URLs are not
tokenised: place this interceptor after any base-URL-rewriting one. It needs only
`plugin`, `accounts`, `session` and `requestAccessRefresh` from the context
(`PluginInterceptorContext`).

The function is typed structurally against `HttpInterceptorFn`, so this entry depends on
`rxjs` only and no Angular version is pinned by the package;
`src/__tests__/angular-typecheck.ts` holds the shape to the real Angular type at
`tsc --noEmit` time.

## Develop

```
cd packages/infra-client-plugin-ui
npx tsc --noEmit && npm test
```

Same arrangement as the CDK package: checks resolve the SDK from `src/`, the build from
`dist/` (`npm run build:plugins` at the repository root). The Angular packages are dev
dependencies for the type check only.
