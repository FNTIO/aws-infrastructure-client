# @fntio/infra-client-plugin-example

The reference plugin, a scoped **AWS Systems Manager Parameter Store** viewer and editor, and the
step-by-step guide to getting a plugin of your own running. The example is deliberately small enough
to read in one sitting; the guide below is the order of operations, with the code each step needs.

A plugin is a small app of your own inside your infra-client portal. The portal does sign-in,
accounts, permissions and theme. You write three things: a CDK registration, a Lambda, and a web
page. Then you deploy your CDK app as usual. Needs `@fntio/infra-client` 0.2.0 or later: the plugin
packages at 0.2.x and the portal must be on the same message protocol (see the SDK README,
"Versioning"), and a page built with the 0.1.x packages has to be rebuilt.

## How it fits together

| Who | What |
| --- | --- |
| Portal | Shows your page in an iframe on its own origin, filling the whole page beside the sidebar, and hands it a token, the AWS accounts the caller may use (each with its permissions) and the theme. The portal draws no header above it and tracks no selected account: your page draws its own title, and keeps its own choice of account, with a picker if it needs one, from `context.accounts()`. Your page runs as the signed-in user (see "Things that bite"). |
| **Your page** | Calls your own API at `/api/plugins/<id>/accounts/<account>/…` with that token. |
| Portal | Checks the token and the grant before your Lambda runs. No grant means your code is never called. |
| **Your Lambda** | Gets who is calling and for which account, does the work, answers JSON. |
| Admins | Grant `user` or `admin` on your plugin per account, on the same Users and Groups screens as roles. |

## The steps

In this order. Each one is checked on its own before the next.

### 1. Turn the feature on, with no plugin yet

In your deployment's config, then deploy the hub stacks as you normally do.

```ts
// config/project.ts
plugins: { enabled: true },
```

**Check:** the portal still works, and a signed-in call to `GET /api/plugins` returns
`{"schemaVersion":1,"refreshAfterSeconds":60,"plugins":[]}`.

### 2. Get the plugin packages

They are not on npm yet. Every [GitHub Release](https://github.com/FNTIO/aws-infrastructure-client/releases)
from v0.1.18 on carries them beside the core tarball: download the four plugin `.tgz` files from the
Release your portal runs and install them next to your `@fntio/infra-client` one. The four plugin
packages share one version (0.2.0 today) and release together.

```bash
cd <your cdk project> && mkdir -p vendor
gh release download v<version your portal runs> --repo FNTIO/aws-infrastructure-client \
  --pattern 'fntio-infra-client-plugin-*.tgz' --dir vendor
```

Older Release, or no download access? Build the same files from the source at that tag:
`git clone https://github.com/FNTIO/aws-infrastructure-client && git checkout v<version> && npm ci && npm run pack:plugins`
writes them into `packs/`.

```jsonc
// package.json of your CDK project
"dependencies": {
  "@fntio/infra-client":            "file:vendor/fntio-infra-client-<version>.tgz",
  "@fntio/infra-client-plugin-sdk": "file:vendor/fntio-infra-client-plugin-sdk-0.2.0.tgz",
  "@fntio/infra-client-plugin-cdk": "file:vendor/fntio-infra-client-plugin-cdk-0.2.0.tgz",
  "@fntio/infra-client-plugin-ui":  "file:vendor/fntio-infra-client-plugin-ui-0.2.0.tgz"
}
```

**Optional, recommended:** also install `fntio-infra-client-plugin-example-0.2.0.tgz` and register
this example first. It is a finished, working plugin, so it proves your deploy, the grants and the
iframe before you write a line. Its tarball carries the built frontend and a prebundled Lambda, so
your synth runs no bundler and needs no Docker.

```ts
import { addAccessPortal } from "@fntio/infra-client";
import { parametersPlugin } from "@fntio/infra-client-plugin-example";

addAccessPortal(app, {
  project: PROJECT,
  resourcePrefix: RESOURCE_PREFIX,
  plugins: [
    parametersPlugin({
      accountNumber: "111111111111",
      region: "eu-central-1",
      prefixes: ["/myapp/prod"],
    }),
  ],
});
```

### 3. Write the registration

One file in your CDK project. It declares what the plugin is: its id, the accounts it serves, the
two permission levels, the sidebar entries, and the routes with the Lambda that answers them. Copy
this package's `src/index.ts` and change the manifest; the pieces you will replace are the routes,
the handler and the frontend, and the shape around them is the same for every plugin.

```ts
// lib/my-plugin.ts
import * as path from "node:path";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { definePlugin } from "@fntio/infra-client-plugin-cdk";

export const myPlugin = definePlugin({
  schemaVersion: 1,
  hostApiVersion: 1,
  id: "parameters",                  // lowercase, digits, hyphens. Used in every URL and grant.
  displayName: "Application parameters",
  version: "1.0.0",
  enabled: true,
  accounts: [{ accountNumber: "111111111111" }],
  permissions: [
    { id: "user",  label: "View parameters" },
    { id: "admin", label: "Edit parameters" },   // admin includes user when both are declared
  ],
  ui: {
    assets: path.join(__dirname, "../web-dist"),          // your built web page; must exist at synth
    user:  { label: "Parameters", entry: "index.html#/user" },
    admin: { label: "Parameters", entry: "index.html#/admin" },
  },
  backend: {
    handlers: {
      api: (scope) => new lambda.Function(scope, "MyPluginApi", {
        code: lambda.Code.fromAsset(path.join(__dirname, "../lambda-dist")),
        handler: "index.handler",
        runtime: lambda.Runtime.NODEJS_22_X,
      }),
    },
    routes: [                          // paths are relative to the account; {name} is a single segment
      { id: "list",   method: "GET", path: "/parameters",        permission: "user",  handlerKey: "api" },
      { id: "update", method: "PUT", path: "/parameters/{name}", permission: "admin", handlerKey: "api" },
    ],
  },
});
```

Give that Lambda an IAM policy for exactly what it may touch. The portal decides who may call a
route; your policy decides what the code may do.

### 4. Write the Lambda

By the time it runs, the portal has already checked the caller. Read who and which account from
the context the portal attached, never from the request itself.

```ts
// src/handler.ts, bundled to lambda-dist/index.js
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createPluginLogger, pluginAuthorizerContextOf, pluginRoutePath }
  from "@fntio/infra-client-plugin-sdk/backend";

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ctx = pluginAuthorizerContextOf(event);    // who, which account, which route. Throws if missing.
  const log = createPluginLogger(ctx);
  const route = pluginRoutePath(event.path, ctx);  // "/parameters" or "/parameters/db-url"

  if (event.httpMethod === "GET" && route === "/parameters") {
    const items = await listParameters(ctx.accountNumber);   // your code
    log.info("listed", { count: items.length });
    return json(200, { items });
  }
  if (event.httpMethod === "PUT" && event.pathParameters?.name) {
    // ... validate, write, return 200. Business failures are 400/404/409, never 401.
  }
  return json(404, { message: "Unknown route" });
}

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
```

Bundle it the way your project already bundles Lambdas (esbuild, `NodejsFunction`, whatever you
use). The Lambda runs in the hub account under the role you give it.

### 5. Write the web page

A normal web bundle, any framework or none. It never logs in and never stores a token. It asks the
portal to connect, then calls your API through the SDK.

```ts
// web/app.ts, bundled to web-dist/ next to index.html
import { connectToInfraClient } from "@fntio/infra-client-plugin-sdk/browser";
import { applyPluginUi } from "@fntio/infra-client-plugin-ui";

applyPluginUi(document);                             // the portal's look: ic-btn, ic-table, ic-card classes
const portal = await connectToInfraClient();         // waits for the portal; also applies its theme

let chosen: string | undefined;                      // which account the page works in is its own state

async function render() {
  const accounts = portal.accounts();                // every account the caller may use here
  const account = accounts.find((a) => a.accountNumber === chosen) ?? accounts[0];
  if (!account) return;
  const { items } = await portal.api.get<{ items: unknown[] }>(`accounts/${account.accountNumber}/parameters`);
  document.getElementById("app")!.textContent = `${items.length} parameters`;
}
portal.on("accessChanged", render);                  // their grant changed; the chosen account may be gone
portal.on("sessionEnded", () => { document.getElementById("app")!.textContent = "Signed out."; });
await render();
```

`portal.api.get/post/put/delete` adds the token for you, only for paths under your plugin's API
root. If your page is Angular, `createPluginInterceptor(portal)` from
`@fntio/infra-client-plugin-ui/angular` does the same for `HttpClient`.

### 6. Build, register, look at the diff

Build the web page and the Lambda first; the registration checks that `web-dist/index.html` exists
and fails synth if it does not. Then add the plugin where your portal is already composed.

```ts
// bin/app.ts
import { myPlugin } from "../lib/my-plugin";

addAccessPortal(app, { project: PROJECT, resourcePrefix: RESOURCE_PREFIX, plugins: [myPlugin] });
```

```bash
npm run build:web && npm run build:lambda      # your own scripts
npx cdk diff
```

**Expect in the diff:** your Lambda, its gateway methods, an authorizer (only for the first plugin),
one asset upload and one catalog record. Nothing else should change. Then `npx cdk deploy` the hub
stacks.

### 7. Grant yourself access and try it

Nobody has plugin access by default, not even admins. In the portal: **Users → your user → Plugins →
Grant plugin access**, pick the account and `admin`.

**Check three things:** the entry appears in the sidebar (within a minute, or reload) and the page
loads with your data. Calling a route with no token gives 401. A user without a grant gets 403 and
never reaches your Lambda. Every decision is a line in the authorizer's log group, and refused calls
show on the Activity page.

## Working on it locally

You do not need to deploy for every change to the page. The SDK ships a fake portal that speaks the
real protocol: serve your `web-dist` from any dev server, proxy `/api` to your deployed portal, and
drive the frame from a small harness page.

```ts
import { createDevHost } from "@fntio/infra-client-plugin-sdk/fixtures";

const frame = document.querySelector("iframe")!;
const host = createDevHost({ frame, listenOn: window, origin: location.origin, entry: "admin" });
frame.src = "/plugin/index.html#/admin";   // create the host before setting src
// then: host.revoke(n), host.grant(a), host.expireSession(), host.setAppearance("dark"), host.signOut()
```

Its tokens are fakes no backend accepts, so calls that reach a real API still need a real sign-in
through the portal. Lambda changes need a deploy.

## Changing it later

- **Update:** change the code or the registration and redeploy. Open pages get a "new version,
  reload" prompt.
- **Disable:** `enabled: false`. Hidden and refused, grants kept.
- **Remove:** delete it from `plugins: [...]` and redeploy. Grants are kept on purpose, so adding the
  same id back restores them.
- **Turn the whole feature off:** remove every plugin in one deploy, then set `enabled: false` in a
  second one.

## Things that bite

- **Your page runs as the signed-in user.** It is a same-origin iframe: nothing stops it from reading the
  portal's tokens or calling core APIs as that user, and a compromised dependency in your bundle would
  have the same power. The SDK's API-root pinning guards against mistakes, not against malice. Treat your
  plugin's code and dependencies with the care of the portal itself; the portal's CSP on
  `/plugin-assets/*` only lets your page load from and talk to the portal.

- **Build before synth, every time.** A missing `web-dist/index.html` fails `cdk synth`. Put the
  build in your pipeline before the CDK step.
- **Ship a new route and the page that uses it together.** For a moment during a deploy the route
  exists but the catalog does not know it yet, and calls get 403.
- **Never answer 401 from your Lambda.** The page's SDK treats 401 as "token expired" and retries
  once. Use 400, 404 or 409 for your own errors.
- **One request is for one account.** Use `ctx.accountNumber`. If your Lambda serves only one
  account, refuse any other with 409 instead of serving its own data.
- **Keep secrets out of logs.** The logger redacts obvious keys, but a value you log yourself is
  logged.
- **Keep construct ids stable.** Renaming `"MyPluginApi"` replaces the Lambda.

## Read more

| Read | When |
| --- | --- |
| [plugin-sdk README](../infra-client-plugin-sdk/README.md) | Every SDK function for the page and the Lambda, the manifest rules, the dev host. |
| [plugin-cdk README](../infra-client-plugin-cdk/README.md) | `definePlugin` in full and the install, update, rollback, disable, remove lifecycle. |
| [plugin-ui README](../infra-client-plugin-ui/README.md) | The `ic-*` CSS classes and the Angular interceptor. |
| [Core README, Plugins](../infra-client/README.md#plugins) | Exactly what a deploy creates, how the authorizer decides, what a grant means. |
| [Wiki: Runbooks, Plugins](../../wiki/Runbooks-Plugins.md) | The admin's side: granting, disabling, removing. |

Using a coding agent? Two skills ship inside the packages: `build-infra-client-plugin` in the SDK
and `integrate-infra-client-plugin` in the CDK package. Point the agent at them and it works in your
repo's own conventions.

## About this example

What it demonstrates is the whole path: a manifest, two permission levels, routes behind the
portal's shared authorizer, a frontend in an iframe using the browser SDK, and a Lambda using the
backend SDK.

```
src/index.ts       the registration a customer copies — manifest, handler factory, IAM
src/handler.ts     the Lambda: authorizer context in, business rules out
src/scope.ts       what this plugin will and will not touch — no AWS imports, so the registration loads without the Lambda's dependencies
src/parameters.ts  the SSM-backed store, loaded only inside the Lambda
web/               the frontend, plain TypeScript, no framework
```

The plugin's frontend must be built before synth, because `definePlugin` checks that the entry file
exists: `npm run build -w @fntio/infra-client-plugin-example`.

### What it does, and what it refuses

The user permission lists and reads parameters under the configured prefixes. The admin permission
also writes them, behind an explicit confirmation. Nothing else is reachable:

- **Prefixes bound it twice.** The handler refuses any name outside them, and the Lambda's IAM policy
  is scoped to the same prefixes. Neither is the only thing standing in the way.
- **A prefix is a path, not a string match.** `/app/production` is not reachable through `/app/prod`,
  and a `..` segment is refused outright.
- **One instance serves one account.** The portal authorizes a request for a particular account; if
  that is not the account this instance was registered for, it answers 409 rather than quietly
  serving its own. Two accounts means two registrations, each with its own function and policy.
- **Encrypted values stay encrypted.** A `SecureString` is fetched without decryption and returned as
  metadata only, so a viewer sees that a secret exists without seeing it.
- **Values never reach a log.** The logger records that a parameter changed and its new version.

### Develop

```
npm install                 # at the repository root
npm run build -w @fntio/infra-client-plugin-example
npx tsc --noEmit && npm test
```

Live testing uses disposable parameters only. Create a couple under a registered prefix, exercise the
plugin, then delete them:

```bash
aws ssm put-parameter --region <region> --overwrite --type String \
  --name <prefix>/db/host --value pg.internal
aws ssm put-parameter --region <region> --overwrite --type SecureString \
  --name <prefix>/db/password --value not-a-real-secret
aws ssm delete-parameters --region <region> --names <prefix>/db/host <prefix>/db/password
```

The `SecureString` is there on purpose: the plugin lists it and never reads its value.
