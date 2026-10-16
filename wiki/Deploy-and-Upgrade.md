Deploys are ordinary `cdk deploy` runs from your deployment project. Stacks are picked by name and run with the credentials of the account they live in: the hub stacks with hub credentials, each workload-account and connector stack with that account's credentials.

## First deploy

The commands live in one place, the package README that ships with your version: [1. Bootstrap the hub account, both regions](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#1-bootstrap-the-hub-account-both-regions), [2. Deploy the hub](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#2-deploy-the-hub), [3. Connect a workload account](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#3-connect-a-workload-account), [4. Join a VPC to the VPN (optional)](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#4-join-a-vpc-to-the-vpn-optional) and [Tear down](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#tear-down). [[Getting Started]] walks the same steps with the decisions around them.

Two things in the README that people miss: bootstrap `us-east-1` in the hub account even without a custom web domain, because the certificates live there; and confirm the SNS subscription email that lands in `alertEmail` on the first deploy, or alarms go nowhere.

## Upgrade

Fixes and features arrive as package releases on npm. Install the version you are moving to (a vendored tarball: replace the file and the `file:` spec instead), review the diff before anything changes, then deploy the hub stacks together by name:

```bash
npm install @fntio/infra-client@0.5.0                    # vendored: replace the .tgz and the file: spec, then npm install
npx cdk diff DataStack CredsStack WebStack               # review before anything changes
npx cdk deploy DataStack CredsStack WebStack
```

Things to know:

- The web app and the API version together. If one stack fails partway, the web app can briefly run one release ahead of the API and some admin pages error until the failed stack deploys cleanly. Finish the upgrade before troubleshooting the UI.
- After a clean upgrade, browsers and especially the desktop app can keep serving the previous web bundle for a while, rendering data from the new API with old labels. Desktop users quit from the tray icon and relaunch.
- Workload-account stacks rarely need redeploying. Their job is deliberately frozen so hub upgrades do not cascade into every account. Redeploy one when you add or change its roles.

Detail: [Upgrade](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#upgrade) in the package README. What each release changed is in [[Release Notes]].

## Version-specific upgrade notes

### Upgrading to 0.5.0: non-root network containers, access logs, large catalogs

Deploy the hub stacks as usual, then, if you run the private network, `NetworkStack` and **every** `Connector-<account>` stack: the control-server and connector task definitions change (every container non-root with its own tmpfs; the ALB gains an access-log bucket), so each control server restarts once and each connector re-registers once. Needs aws-cdk-lib 2.263 or later and Fargate platform version `LATEST`. The hub deploy adds `DataStack`'s `AccessLogsBucket`, which the web, issuer and plugin-asset buckets and both CloudFront distributions log into; suppress Security Hub's S3.9 finding on that one bucket (its own text says so). Everything else in 0.5.0 (paged lists, the dashboard sections, pickers, the access report) rides the hub deploy with nothing to migrate: `accountDimensions` is opt-in, and when you turn it on, `scripts/backfill-dimensions.mjs` fills tenant / project / stage on accounts registered before it (new registrations store them as they come in).

### Upgrading to 0.4.0: HTTPS to Headscale, read-only containers

Private network only: `NetworkStack` first (SSM interface endpoint, TLS between the load balancer and Headscale, the key minter and reconciler verify it against `/<resourcePrefix>/headscale-tls-<site>`), then every `Connector-<account>` stack (read-only root filesystems). Removing a site now also means deleting that SSM parameter next to the API-key secret. Desktop 0.4.0 updates itself on macOS from then on; a 0.3.0 install needs one last manual DMG.

### Upgrading to 0.1.17: the activity log and pop-up notifications

Nothing to migrate: older vend rows are read in the new shape. The deploy adds one index to the audit table (`byActor`), which rides the normal hub deploy. The reconciler writes VPN-session, firewall-rule and connector rows only after a manual `NetworkStack` deploy (it needs the table and the retention in its environment). Set `audit.retentionDays` if the 400-day default is not what your policy says; rows already written keep the retention they were written with. Desktop users get the pop-up changes (Windows toasts, click-to-open, wake refresh, VPN-drop notice) with the next desktop build; the web app works with older shells. Detail: [Upgrading to 0.1.17](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#upgrading-to-0117--the-activity-log-and-pop-up-notifications) in the package README.

### Upgrading to 0.1.16: several connector VPCs per account

`connectorVpcs.<account>` may now be a list (every entry but one named). Nothing changes for a single VPC per account, but the hub's reconciler now tells each VPC's SG-manager and resolver apart, so deploy the hub's `NetworkStack` first. When an account gains a second VPC, redeploy its existing `Connector-<account>` stack as well as deploying the new `Connector-<account>-<name>`: the existing SG-manager learns which VPC is its own and answers `other-vpc` for groups elsewhere instead of trying to open them. See [[Runbooks Network]].

### Upgrading to 0.1.13: connector VPCs outside the hub's region

Only if you set `connectorVpcs.<account>.region`. The hub gains a relay function on its own invoke-only role, so `NetworkStack` needs a manual deploy; the next `ConnectorStack` deploy rolls the connector task once, and a foreign region must be CDK-bootstrapped before you deploy into it. Without the field nothing else changes.

### Upgrading to 0.1.12: federated sign-in and dev shares

Both are off by default. Dev shares (`network.devShares`) need a manual `NetworkStack` deploy (reconciler rules and reserved concurrency); the access table gains a `ttl` attribute on share rows and group rows now honor an `expiresAt`. Federated sign-in (`loginMethods.federation`) rides the hub deploy; its runbook is [Federated sign-in (SSO)](Runbooks-Users#federated-sign-in-sso).

### Upgrading to 0.1.8: the issuer moves onto CloudFront

The credential issuer (`https://issuer.<your zone>`) is served from a private S3 bucket behind CloudFront instead of an API Gateway HTTP API. The hostname, the signing keys and every workload account's trust are unchanged; nothing moves on the workload side. The deploy migrates in one CloudFormation update, about 15 minutes: the `us-east-1` certificate first, then the bucket, the published documents and the distribution, then an in-place DNS flip once the files exist, and the old API, its domain, the issuer Lambda and the old regional certificate deleted last. A failure before that last phase rolls back to the untouched API Gateway path.

Before you deploy it:

- `us-east-1` must be CDK-bootstrapped in the hub account even if you run without `web` and with WAF off; the issuer's certificate now lives in the `us-east-1` companion stack. Step 1 above covers it.
- Do not combine it with a `keyVersions` / `signerVersion` change.

After it, verify from a laptop (public DNS, like STS):

```bash
H=issuer.<zone>
dig +short $H                                  # CloudFront IPs now; `dig AAAA` answers too
curl -sI https://$H/.well-known/openid-configuration | grep -iE '^(HTTP|content-type|cache-control|x-cache)'
curl -s  https://$H/.well-known/openid-configuration | jq .   # issuer == https://$H, jwks_uri under it
curl -s  https://$H/.well-known/jwks.json | jq '.keys[] | {kid, alg, use}'   # one entry per keyVersions
curl -sI https://$H/ | head -1                 # 200: the root page (CloudFront.1)
```

Then get credentials for one role from the portal and run `aws sts get-caller-identity` with them. That is the real proof: STS fetched the new JWKS to accept the token. The `IssuerHealth` alarm must stay OK.

Post-deploy checks:

1. The ACM validation CNAME for the issuer host is still in the zone; the new certificate needs it for its yearly renewal. If it is gone, re-create it: ACM (`us-east-1`) → the certificate → **Create records in Route 53**.
2. The old regional certificate is gone. If CloudFormation left it behind as "in use" during cleanup, delete it once nothing lists it: `aws acm delete-certificate --certificate-arn <arn>`.
3. Delete the two orphaned log groups (CloudFormation retains log groups): `aws logs describe-log-groups --log-group-name-prefix CredsStack-Issuer` lists the `…IssuerApiAccessLogs…` and `…IssuerFunctionLogs…` groups; `aws logs delete-log-group --log-group-name <name>` for each.
4. Security Hub, if you run it: the APIGateway.8 and APIGateway.11 findings archive themselves once their resources are gone. A new CloudFront.17 finding appears for the issuer distribution; suppress it like the web one (see [[Security Posture]]).

With WAF on, a third web ACL `<prefix>-issuer` appears. It is observe-only and never blocks. No API Gateway or Lambda charges remain; the distribution and bucket sit inside the free tiers at issuer traffic.

Rollback is deploying the previous release again: CloudFormation rebuilds the API Gateway path and flips the record back in place, about 10 minutes. Nothing in any workload account changes either way.

Detail: [Upgrading to 0.1.8](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#upgrading-to-018--the-issuer-moves-onto-cloudfront) in the package README; the migration mechanics, full verification commands and rollback are in the deployment README's [Issuer on S3 + CloudFront](Runbooks-Issuer#issuer-on-s3--cloudfront--migration-from-api-gateway) section.
