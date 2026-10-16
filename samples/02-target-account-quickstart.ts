#!/usr/bin/env node
/**
 * QUICK PATH — connect one workload account to the hub.
 *
 * The whole stack a customer's security team reviews before granting trust:
 * an OIDC provider pointing at the hub's issuer, plus the listed roles
 * trusting it — nothing else. Nobody can use the roles until an admin grants
 * them in the portal.
 */
import { App } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { TargetAccountStack, InfraClientRoles } from "@fntio/infra-client";

const app = new App();

new TargetAccountStack(app, "AccessTarget-Sandbox", {
  env: { account: "444455556666", region: "eu-central-1" },

  // The hub's issuer — permanent, printed by the hub deploy.
  issuerUrl: "https://issuer.access.acme.com",

  roles: [
    // Prepackaged specs with frozen, AWS-collision-free names
    // (InfraReadOnly / InfraPowerUser / InfraFullAdmin).
    InfraClientRoles.READ_ONLY,
    InfraClientRoles.FULL_ADMIN,

    // Specs are plain data — spread-and-tweak one…
    {
      ...InfraClientRoles.READ_ONLY,
      roleName: "InfraAuditor",
      description: "Read-only for the external audit team.",
    },

    // …or declare a fully custom one.
    {
      roleName: "BillingViewer",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("job-function/Billing"),
      ],
    },
  ],
});
