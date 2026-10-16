# @fntio/infra-client-plugin-cdk

Registers customer plugins from an existing CDK application. This package holds
`definePlugin`, the synth-time validation of a definition; the constructs that create the
gateway methods, upload the assets and write the catalog record (`resolvePlugins`,
`PluginApi`, `PluginCatalogActivation`) live in `@fntio/infra-client` and run when the
definition is passed to `addAccessPortal` — see the core README's
[Plugins](../infra-client/README.md#plugins) section. Private until publishing is enabled.

## `definePlugin`

Turns a customer's definition into a validated `PluginDefinition`: the serializable
manifest (what the catalog stores and the portal discovers) separated from the
deployment inputs (the asset directory and the Lambda handlers).

```ts
import { definePlugin } from "@fntio/infra-client-plugin-cdk";

export const parameters = definePlugin({
  schemaVersion: 1,
  id: "parameters",
  displayName: "Application parameters",
  version: "1.0.0",
  hostApiVersion: 1,
  enabled: true,
  accounts: [{ accountNumber: "123456789012", regions: ["eu-central-1"] }],
  permissions: [
    { id: "user", label: "View application parameters" },
    { id: "admin", label: "Edit application parameters" },
  ],
  ui: {
    assets: "./plugins/parameters/dist",
    user: { label: "Parameters", entry: "index.html#/user" },
    admin: { label: "Parameters", entry: "index.html#/admin" },
  },
  backend: {
    handlers: { api: (scope) => new lambda.Function(scope, "ParametersApi", { /* ... */ }) },
    routes: [
      { id: "list", method: "GET", path: "/parameters", permission: "user", handlerKey: "api" },
      { id: "update", method: "PUT", path: "/parameters/{name}", permission: "admin", handlerKey: "api" },
    ],
  },
});
```

A handler is either an existing `IFunction` or a factory that the registration
construct calls once inside its own scope. `ui.assets` resolves like a CDK asset
path, from the process working directory.

`definePlugin` throws one `PluginValidationError` listing every problem: the SDK's
manifest rules (see the SDK README), plus routes naming a handler key that has no
handler, a missing asset directory, and an entry file that is not in it. It runs at
synth time, so a bad definition fails `cdk synth`, never a deploy.

## Develop

```
cd packages/infra-client-plugin-cdk
npx tsc --noEmit && npm test
```

Type checks and tests resolve `@fntio/infra-client-plugin-sdk` to its `src/`
(tsconfig `paths` + Jest `moduleNameMapper`); `npm run build` uses the SDK's built
`dist/`, so run `npm run build:plugins` at the repository root to build all three.

## Agent skill

`skills/integrate-infra-client-plugin/` ships with this package: it inspects an existing CDK
application's own conventions — where the portal is composed, how Lambdas are built, how it deploys —
and makes the smallest correct change, then diffs it. Make it available the way your agent setup
already does; there is no installer and no generated project.

## The lifecycle in one place

| Step | What to change | What happens |
| --- | --- | --- |
| Install | add the definition to `plugins` | assets upload, routes mount, a catalog record is written |
| Update | change the definition | a new revision; a running frame prompts to reload |
| Rollback | redeploy the previous definition | the record returns through the same provider |
| Disable | `enabled: false` | hidden and refused; grants stay, dormant and revocable |
| Remove | delete the registration | record tombstoned before the routes go; grants deliberately kept |
| Reinstall | add the same id back | still-valid grants come back with it |

Removing the registrations and turning the whole feature off are two separate deploys, in that order.

A worked example of everything above is [`@fntio/infra-client-plugin-example`](../infra-client-plugin-example/README.md).
