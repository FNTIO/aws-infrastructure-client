#!/usr/bin/env node
/**
 * FLEXIBLE PATH — drop the connector into a stack you already own.
 *
 * The constructs take CDK objects (`IVpc`, `IFunction`, `IPrincipal`), so
 * they compose with whatever your stack already has; only the cross-account
 * references come from the hub locator.
 */
import { App, Stack } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { TailnetConnector, SgManager, AccessPortalHub } from "@fntio/infra-client";

const app = new App();
const stack = new Stack(app, "PlatformNetworking", {
  env: { account: "444455556666", region: "eu-central-1" },
});

const hub = AccessPortalHub.fromAttributes({
  account: "444455556666",
  region: "eu-central-1",
  network: { zoneName: "access.acme.com", subdomain: "network" },
});

// Your VPC — new here, but any IVpc works (ec2.Vpc.fromLookup(...) included).
const vpc = new ec2.Vpc(stack, "Vpc", {
  ipAddresses: ec2.IpAddresses.cidr("10.20.0.0/16"),
  maxAzs: 2,
});

const connector = new TailnetConnector(stack, "Connector", {
  vpc,
  controlUrl: hub.controlUrl("sandbox"),
  minter: hub.connectorKeyMinter(stack, "sandbox"),
  routes: [vpc.vpcCidrBlock],
  // `connector-<account>[-<name>]` is the reconciler's naming contract (naming.ts) — keep it.
  hostname: `connector-${stack.account}`,
});

// Optional: grant-driven SG automation. Omit to manage ingress yourself —
// then resources become reachable by allowing `connector.securityGroup`.
// A VPC outside the hub's region trusts hub.aclReconcilerRelayPrincipal() instead.
new SgManager(stack, "SgManager", {
  resourcePrefix: hub.resourcePrefix,
  vpc,
  connectorSecurityGroup: connector.securityGroup,
  trustedInvoker: hub.aclReconcilerPrincipal(),
});

// The payoff of construct-level composition: your resources reference the
// connector's SG directly, no exported ids or lookups.
const dbSg = new ec2.SecurityGroup(stack, "DatabaseSg", { vpc });
dbSg.addIngressRule(
  connector.securityGroup,
  ec2.Port.tcp(5432),
  "Postgres over the tailnet"
);
