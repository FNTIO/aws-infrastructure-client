#!/usr/bin/env node
/**
 * QUICK PATH — join one VPC to the private network.
 *
 * One ready-made stack per VPC. Everything cross-account derives from the hub
 * locator — you never assemble an ARN: the site's key-minter, control-plane
 * URL, and reconciler principal are well-known names computed from the hub's
 * identity.
 *
 * Prerequisite (hub side): the hub must list this account under the site's
 * `connectorAccounts` (→ NetworkStack.grantConnectorAccount) — WHICH minter
 * an account may invoke is what selects its site, by design.
 */
import { App } from "aws-cdk-lib";
import { ConnectorStack, AccessPortalHub } from "@fntio/infra-client";

const app = new App();

// The hub, located by identity alone — this app never touches its stacks.
const hub = AccessPortalHub.fromAttributes({
  account: "444455556666",
  region: "eu-central-1",
  network: { zoneName: "access.acme.com", subdomain: "network" },
});

new ConnectorStack(app, "Connector-Sandbox", {
  env: { account: "444455556666", region: "eu-central-1" },
  hub,
  site: "sandbox", // permanent site id — decides control plane AND minter
  vpcId: "vpc-0abc1234def567890", // looked up at synth (needs credentials)
  routes: ["10.20.0.0/16"], // advertised into the tailnet
  // containerInsights: true, // Container Insights on this cluster (Security Hub ECS.12)
});
