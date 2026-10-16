#!/usr/bin/env node
/**
 * FLEXIBLE PATH — the roles are yours, only the trust is ours.
 *
 * Skip TargetAccountStack entirely: create the OIDC provider once, then build
 * ordinary `iam.Role`s with `webIdentityPrincipal()` as the assume principal —
 * everything CDK's Role supports composes as usual.
 *
 * The two opinionated pieces you cannot change (they ARE the security model):
 *   - the trust conditions (`aud` + the role-scoped `sub` pin), and
 *   - the role's `roleName` must equal the name given to
 *     `webIdentityPrincipal()` — the sub pin names it, so a CDK-generated
 *     role name can never match.
 */
import { App, Stack, Duration } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { createIssuerProvider, webIdentityPrincipal } from "@fntio/infra-client";

const app = new App();
const stack = new Stack(app, "AccessTarget-DataPlatform", {
  env: { account: "444455556666", region: "eu-central-1" },
});

// One provider per account, shared by every role.
const provider = createIssuerProvider(
  stack,
  "IssuerProvider",
  "https://issuer.access.acme.com"
);

// A role shaped entirely by you: inline policy, boundary, longer sessions.
const dataScience = new iam.Role(stack, "DataScience", {
  roleName: "DataScience", // MUST equal the principal's roleName
  assumedBy: webIdentityPrincipal(provider, "DataScience"),
  description: "Athena + Glue for the data-science group.",
  maxSessionDuration: Duration.hours(4),
  permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(
    stack,
    "Boundary",
    "org-wide-boundary"
  ),
  inlinePolicies: {
    analytics: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          actions: ["athena:*", "glue:Get*", "glue:BatchGet*"],
          resources: ["*"],
        }),
      ],
    }),
  },
});

// …and it composes with the rest of your CDK app like any other role.
const lakeBucket = s3.Bucket.fromBucketName(stack, "Lake", "acme-data-lake");
lakeBucket.grantRead(dataScience);
