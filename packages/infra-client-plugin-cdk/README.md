# @fntio/infra-client-plugin-cdk

Registers customer plugins from an existing CDK application. This package holds
`definePlugin`, the synth-time validation of a definition; the constructs that create the
gateway methods, upload the assets and write the catalog record (`resolvePlugins`,
`PluginApi`, `PluginCatalogActivation`) live in `@fntio/infra-client` and run when the
definition is passed to `addAccessPortal` — see the core README's
[Plugins](../infra-client/README.md#plugins) section. Published to npm as
`@fntio/infra-client-plugin-cdk`, at one version with `-sdk`, `-ui` and `-example`.

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
`dist/`, so run `npm run build:plugins` at the repository root to build all four.

## Agent skill

`skills/integrate-infra-client-plugin/` ships with this package: it inspects an existing CDK
application's own conventions — where the portal is composed, how Lambdas are built, how it deploys —
and makes the smallest correct change, then diffs it. Its frontmatter `version` equals the package
version. There is no installer and no generated project: for Claude Code, link or copy the folder
into the project's `.claude/skills/`; for other agents, copy it to wherever they read skills from.

```bash
mkdir -p .claude/skills
ln -s ../../node_modules/@fntio/infra-client-plugin-cdk/skills/integrate-infra-client-plugin .claude/skills/integrate-infra-client-plugin
# or copy: cp -R node_modules/@fntio/infra-client-plugin-cdk/skills/integrate-infra-client-plugin .claude/skills/
```

## IAM examples

IAM is the customer's configuration: the portal decides who may call a route, the handler's policy
decides what the code may touch, and `definePlugin` adds nothing to it. Three shapes that come up,
with placeholders; scope every one to the resources the plugin exists for.

**SSM path + KMS key** (the example plugin's policy, see
[`@fntio/infra-client-plugin-example`](../infra-client-plugin-example/README.md)):

```ts
fn.addToRolePolicy(new iam.PolicyStatement({
  actions: ["ssm:GetParameter", "ssm:GetParameters", "ssm:PutParameter"],
  resources: [`arn:aws:ssm:${region}:${account}:parameter/myapp/prod/*`],
}));
fn.addToRolePolicy(new iam.PolicyStatement({
  actions: ["ssm:GetParametersByPath"],
  resources: [`arn:aws:ssm:${region}:${account}:parameter/myapp/prod`],
}));
// only if the handler decrypts SecureStrings, and only the key they use
fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["kms:Decrypt"], resources: [parameterKey.keyArn] }));
```

**A designated Step Functions workflow plus a plugin state table** (start and inspect one state
machine; read and write one table):

```ts
workflow.grantStartExecution(fn);                                   // states:StartExecution on this ARN only
fn.addToRolePolicy(new iam.PolicyStatement({
  actions: ["states:DescribeExecution"],
  resources: [`arn:aws:states:${region}:${account}:execution:${workflow.stateMachineName}:*`],
}));
jobsTable.grantReadWriteData(fn);                                    // dynamodb on this table (and its indexes) only
```

**RDS snapshot and restore on named or tagged instances:**

```ts
fn.addToRolePolicy(new iam.PolicyStatement({
  actions: ["rds:CreateDBSnapshot", "rds:DescribeDBSnapshots", "rds:RestoreDBInstanceFromDBSnapshot"],
  resources: [
    `arn:aws:rds:${region}:${account}:db:myapp-*`,
    `arn:aws:rds:${region}:${account}:snapshot:myapp-*`,
  ],
  conditions: { StringEquals: { "aws:ResourceTag/plugin": "backups" } },   // or drop the condition and rely on the names
}));
```

`region` and `account` are `Stack.of(scope).region` / `.account` or the values the registration was
given; the handler runs in the hub account with the function's own credentials, so another account
needs an assume-role of the customer's own.

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
