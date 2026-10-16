# Samples — the consumer's view of the CDK API

Single-file CDK apps written the way a **consuming developer** (an
experienced AWS/CDK architect at a customer) would write them. They import
`@fntio/infra-client` — the real package from `packages/infra-client`,
resolved through the repo's npm workspaces — so every line here is exactly
what a customer writes.

| Sample | Shows | Path |
| --- | --- | --- |
| [01-hub-and-targets.ts](01-hub-and-targets.ts) | The whole landscape in one app: typed config → hub stacks, plus a stack per workload account and per connector VPC | both |
| [02-target-account-quickstart.ts](02-target-account-quickstart.ts) | `TargetAccountStack` + prepackaged `InfraClientRoles`, spread-tweaked and custom specs | quick |
| [03-target-account-custom-roles.ts](03-target-account-custom-roles.ts) | `createIssuerProvider` + `webIdentityPrincipal` on a hand-built `iam.Role` (inline policies, boundary, S3 grant) | flexible |
| [04-connector-quickstart.ts](04-connector-quickstart.ts) | `ConnectorStack` wired entirely from `AccessPortalHub.fromAttributes` | quick |
| [05-connector-in-existing-stack.ts](05-connector-in-existing-stack.ts) | `TailnetConnector` + `SgManager` composed into an existing stack with the consumer's own `IVpc` | flexible |

## The API rules these demonstrate

- **Constructs take CDK interface objects** (`IVpc`, `IFunction`,
  `IPrincipal`, `IManagedPolicy`) — never ARNs or ids. If you only have a
  string, CDK's own `fromXxx()` escape hatches convert it.
- **Ready-made stacks are the data boundary**: stack props may be plain
  values (`vpcId`, account ids), because stack props exist before any scope
  does.
- **Cross-account identity goes through the hub locator.**
  `AccessPortalHub.fromAttributes({account, region, ...})` derives every
  well-known name/ARN of the hub's cross-account contract — consumers never
  assemble one by hand, and site selection stays "which minter may this
  account invoke" (the security boundary).
- **Opinionated only where the security model requires it**: the trust
  conditions (`aud` + role-scoped `sub` pin), the role-name-equals-sub-pin
  rule, the `connector-<account>[-<name>]` hostname contract, and the well-known
  resource names. Everything else is ordinary CDK.

## Type-checking the samples

```bash
npm run build                      # once — samples resolve the package's dist/ types
npx tsc -p samples/tsconfig.json   # from the repo root, after `npm install`
```

They are illustrations — synthesizing/deploying them requires real accounts,
zones, and VPC ids.
