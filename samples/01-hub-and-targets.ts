#!/usr/bin/env node
/**
 * THE WHOLE LANDSCAPE IN ONE APP — hub, workload accounts, private network.
 *
 * What a customer's platform team writes (imports included): one typed config
 * object, the hub stacks from it, then one small stack per workload account.
 * Deploys select by stack name — hub stacks with hub credentials, each
 * target/connector stack with that account's credentials.
 */
import { App } from "aws-cdk-lib";
import {
  addAccessPortal,
  AccessPortalHub,
  TargetAccountStack,
  InfraClientRoles,
  TargetRoleSpec,
  ConnectorStack,
  resolveSites,
  type ProjectConfig,
} from "@fntio/infra-client";

const HUB_ACCOUNT = "111122223333";
const REGION = "eu-central-1";

// ---------------------------------------------------------------------------
// The deployment, described once. Every value is typed; misconfigurations
// fail at synth with a plain-language error, not mid-deploy.
// ---------------------------------------------------------------------------
const config: ProjectConfig = {
  projectName: "Acme Access",
  env: { account: HUB_ACCOUNT, region: REGION },
  prod: true, // RETAIN + PITR on every table
  alertEmail: "platform@acme.com",

  // PERMANENT once anything deploys against it — every workload account's
  // trust policy names this host.
  issuer: {
    hostedZoneId: "Z0ABC12DEF34GH",
    zoneName: "access.acme.com",
    domainName: "issuer.access.acme.com",
    keyVersions: [1],
    signerVersion: 1,
  },

  // Sign-in methods. Every field is listed so none is missed; the first three
  // are the choices users see on the sign-in page.
  loginMethods: {
    password: true, // always on: Cognito requires it
    passkey: true, // Touch ID / Windows Hello / security keys; needs the `web` block
    emailOtp: true, // passwordless one-time code by email
    mfa: "optional", // TOTP on password sign-ins, "optional" | "required"; a password-only pool must set it
    threatProtection: false, // Cognito threat protection (PLUS plan, about $0.02 per active user); needs mfa
    federation: [], // your own OIDC provider(s): wiki Runbooks-Users, "Federated sign-in (SSO)"
  },

  web: {
    hostedZoneId: "Z0ABC12DEF34GH",
    zoneName: "access.acme.com",
    domainName: "access.acme.com",
    authDomainName: "auth.access.acme.com",
  },

  // WAF on CloudFront + the API — the defaults, spelled out. `enabled: false` opts out.
  waf: { enabled: true, rateLimit: 5000, perTokenRateLimit: 2000 },
  // Deployment-wide API ceiling (requests per second across every caller) — the defaults.
  apiThrottle: { rateLimit: 100, burstLimit: 200 },
  // Activity log retention; 400 outlasts the yearly access review.
  audit: { retentionDays: 400 },

  branding: {
    logoUrl: "https://acme.com/logo.svg",
    primaryColor: "#0E7490",
    accentColor: "#F59E0B",
  },

  // Assumable roles per workload account (must mirror the portal's catalog).
  rolesByAccount: {
    "444455556666": [InfraClientRoles.READ_ONLY, InfraClientRoles.FULL_ADMIN],
    "777788889999": [InfraClientRoles.READ_ONLY],
  } satisfies Record<string, TargetRoleSpec[]>,

  // Optional private network: one site = one routing domain.
  network: {
    hostedZoneId: "Z0ABC12DEF34GH",
    zoneName: "access.acme.com",
    subdomain: "network",
    sites: {
      main: {
        displayName: "Acme",
        accounts: ["444455556666"],
        connectorAccounts: ["444455556666"], // may mint machine keys
        connectorVpcs: {
          "444455556666": { vpcId: "vpc-0abc1234", routes: ["10.20.0.0/16"] },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Hub (deploys into the hub account; certs land in us-east-1 automatically).
// ---------------------------------------------------------------------------
const app = new App();
const sites = config.network ? resolveSites(config.network) : undefined;
addAccessPortal(app, { project: config, resourcePrefix: "acme-access", sites });

// The same hub, as cross-account stacks see it.
const hub = AccessPortalHub.fromAttributes({
  account: HUB_ACCOUNT,
  region: REGION,
  issuerDomain: config.issuer.domainName,
  resourcePrefix: "acme-access",
  network: { zoneName: "access.acme.com", subdomain: "network" },
});

// ---------------------------------------------------------------------------
// Workload accounts — one small, auditable stack each.
// ---------------------------------------------------------------------------
for (const [account, roles] of Object.entries(config.rolesByAccount)) {
  new TargetAccountStack(app, `AccessTarget-${account}`, {
    env: { account, region: REGION },
    issuerUrl: hub.issuerUrl!,
    roles,
  });
}

// Connectors for every VPC the network block lists.
for (const site of sites ?? []) {
  for (const [account, vpcs] of Object.entries(site.connectorVpcs)) {
    for (const vpc of vpcs) {
      // An account's second VPC carries a name; it suffixes the stack id and the connector's hostname.
      const suffix = vpc.name ? `-${vpc.name}` : "";
      new ConnectorStack(app, `Connector-${account}${suffix}`, {
        env: { account, region: vpc.region ?? REGION },
        hub,
        site: site.id,
        vpcId: vpc.vpcId,
        routes: [...vpc.routes],
        name: vpc.name,
      });
    }
  }
}
