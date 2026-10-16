Operating the private network: connectors, sites, split DNS and the Headscale control plane. Concepts are on [[Private Network]]; the index is [[Runbooks]]. Every `cdk deploy` on this page is a hand deploy and passes `--exclusively`: without it CDK also deploys the `DataStack` and `CredsStack` dependencies from your local tree and can race the pipeline.

## Adding a VPC to the network (ConnectorStack)

Manual, per target VPC — Epic 4 stacks never deploy from CI:

1. **Declare the VPC in config** — inside its account's SITE in
   `config/project.ts`: add the account to
   `network.sites.<site>.accounts` (an account lives in exactly one site) and
   a `connectorVpcs` entry keyed by the account id:
   `{ vpcId: "vpc-0abc…", routes: ["10.1.0.0/16"] }` (routes = usually just
   the VPC's CIDR). For an account's SECOND VPC make the entry a list and
   give the new VPC a `name` (`{ vpcId, routes, name: "sandbox" }`): it
   becomes that connector's hostname suffix, stack id suffix and function-name
   suffix, so set it once; redeploy the account's existing connector stack too
   (its SG-manager learns which VPC is its own). Add `region: "eu-west-1"` when the VPC is outside the
   hub's region (step 2's NetworkStack deploy then also adds the relay the
   reconciler uses to reach that account's SG-manager and resolver). Synth
   **fails on any CIDR overlap within the site**
   (`packages/infra-client/lib/network-validation.ts`) — a colliding VPC goes in a different
   site instead (that's what sites are,
    the sites design note).
   Non-overlapping ranges share a site for free.
2. **Grant the account on THAT SITE's connector minter** — add the account id
   (or a role ARN for least privilege) to the site's `connectorAccounts`,
   then `npx cdk deploy NetworkStack --exclusively --profile main`.
3. **Deploy the connector** into the target account:
   `npx cdk deploy Connector-<id> --exclusively --profile <target>` (one stack per
   `connectorVpcs` entry: `Connector-<id>` for the account's unnamed VPC,
   `Connector-<id>-<name>` for a named one; the deployed CloudFormation names
   stay `ConnectorStack` and `ConnectorStack-<name>`). A VPC in another region deploys there: bootstrap that
   account in the VPC's region first
   (`npx cdk bootstrap aws://<id>/<region> --profile <target>`).
   The account's site picks the control plane + minter automatically. The
   connector self-enrolls at boot (mints a key, joins, advertises its
   routes) — re-enrolling later is just restarting the task / redeploying.
   One-time note: connectors deployed before the per-account stack ids
   (2026-08-19) get an ECS task-family rename on their next deploy — a
   normal rolling task restart, not an outage.
4. If the VPC needs private DNS names, add its resolver to the SITE's
   `splitDns` (VPC CIDR base + 2) and redeploy NetworkStack.

Reachability appears after the next reconciler pass (≤5 min) for users
holding grants on resources registered in that account.

Retiring a VPC in another region: unregister its resources (or clear their
security group ids) and let one reconciler pass sweep the managed rules
BEFORE removing the `connectorVpcs` entry — once NetworkStack redeploys
without that region the hub can no longer reach it; the reconciler then logs
the account once, stops retrying, and the rules must be revoked by hand.

Retiring any connector VPC, in order: unregister its resources and let one
reconciler pass sweep their rules, `cdk destroy` its `Connector-<id>[-<name>]`
stack (the VPC itself only after that — the connector's network interfaces
live in it), remove the `connectorVpcs` entry and redeploy `NetworkStack`.
Then delete the retired connector's node on the site's control server — the
reconciler only prunes a connector that has a live replacement in the SAME
VPC, so this one stays listed as stale (and alarms) until removed:

```bash
aws ecs execute-command --cluster <NetworkStack cluster> --task <site's headscale task> \
  --container headscale --interactive --command "headscale nodes list"
# then, with the connector's ID from that list:
#   --command "headscale nodes delete --identifier <ID> --force"
```

CloudFormation keeps the destroyed stacks' log groups; delete them in the
target account if nothing needs them.

## Which network runbook do I need?

- **First time ever moving this deployment to sites** (from the old single
  `headscale.…` plane) → "One-time migration" below. Runs once, re-enrolls
  everything, never again.
- **Adding a VPC whose range doesn't collide** with its site → "Adding a VPC
  to the network". No new site, no re-enrollment, users notice nothing.
- **Adding a VPC whose range DOES collide** (the synth error says so) →
  "Adding a SITE" first, then "Adding a VPC" into the new site. Existing
  sites and devices are untouched; users just gain a switcher entry.

## One-time migration: single plane → sites

Moving off `headscale.portal.example.com` to `dev.network.…` re-enrolls
every device and connector ONCE (login hostnames are baked into their state —
SITES.md calls this the deliberate break). Order matters twice: TestbedStack
must come DOWN before NetworkStack deploys (it imports the old connector
minter cross-stack, and CloudFormation refuses to delete an in-use export),
and the manual NetworkStack deploy goes BEFORE the CI push — pushing first
would make the API advertise site URLs that don't exist yet.

1. `npx cdk destroy TestbedStack --profile main` (temporary stack, nothing
   precious — its Aurora/nginx are test fixtures).
2. `npx cdk deploy NetworkStack --exclusively --profile main` — replaces the old single
   Headscale with `headscale-dev` behind the new wildcard ALB setup. The old
   EFS directory (`/headscale`) is abandoned in place; the site starts empty
   (that IS the re-enrollment). The deploy creates the site's `infra` user
   and admin API key itself (since 2026-08-28 — no secret placeholder, no
   ECS Exec, no rotation stamp on a first deploy); the output
   `HeadscaleApiKeydev` reads `created`.
3. `npx cdk deploy TestbedStack --exclusively --profile main` — its connector re-enrolls
   itself into dev at boot; re-register/verify any testbed catalog resources
   whose endpoints changed with the rebuild.
4. Commit + push (CI deploys the API/frontend that advertise the site list).
5. Each device: relaunch the desktop app (tray → Quit, reopen — the shell
   itself changed), click Connect (fresh enrollment; first-connect rules take
   ≤5 min). The old `headscale.…` DNS record and the old
   `infra-client/headscale-apikey` secret can be deleted once everything is
   over — that secret deletion is a hand step by design (see "Removing a
   SITE").

## Adding a SITE (a new control plane)

Only when a new VPC's CIDR collides with an existing site (the synth error
tells you). Site ids are permanent — pick a short meaningful slug.

1. Add `network.sites.<newsite>` to config (accounts, connectorVpcs,
   splitDns). Move NOTHING between existing sites — that re-enrolls devices.
2. `npx cdk deploy NetworkStack --exclusively --profile main` — brings up the site's
   Headscale, ALB rule, minter, AND its `infra` user + admin API key (the
   server container mints them at start; `Custom::HeadscaleApiKey` stores the
   key as `<resourcePrefix>/headscale-apikey-<newsite>`). DNS/cert need
   nothing (wildcard). Output `HeadscaleApiKey<newsite>` = `created`.
3. **Commit + push promptly** — until CI updates the API, an old API omits
   the new site and mints default to the FIRST site.
4. Deploy the site's connectors (previous runbook). Users see the new site's
   VPCs in the app and switch from the pill — one site at a time (desktop
   users must have relaunched the app since the sites update, or switching
   asks them to).

## Removing a SITE

Delete `network.sites.<site>` from config and `npx cdk deploy NetworkStack
--exclusively --profile main`: the service, ALB rule, minter, and the site's custom
resource go away; devices enrolled there lose that site. **The one manual
step left in the whole VPN lifecycle:** the site's API-key secret is kept on
purpose (the custom resource's Delete is a no-op — deleting it automatically
could strand a still-running server or a rollback mid-teardown), so remove it
by hand once you're sure:
`aws secretsmanager delete-secret --secret-id <resourcePrefix>/headscale-apikey-<site> --profile main`
and the certificate parameter the task published:
`aws ssm delete-parameter --name /<resourcePrefix>/headscale-tls-<site> --profile main`.
The site's EFS directory stays too (RETAIN under `prod`); delete it only if
the site will never return.

## Headscale admin ops

Connector hygiene is automatic: a redeployed connector enrolls as a new
node, and the reconciler deletes its offline predecessor once a trusted
replacement for the same account is online for 24h+ (logged as
`prunedConnectors`). An account's ONLY connector is never deleted — it stays
in the stale list and the alarm, so an outage is seen rather than tidied away.

No admin port is exposed; admin operations go through ECS Exec — per SITE
(each site is its own Fargate service, `headscale-<site>`):

```bash
TASK=$(aws ecs list-tasks --cluster <cluster> --service-name <headscale-<site> service> \
  --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster <cluster> --task $TASK --container headscale \
  --interactive --command "headscale nodes list"
```

The `infra` user and the admin API key are created BY THE DEPLOY (since
2026-08-28). Headscale's CLI only works inside the serving container (it
talks to the running server over a Unix socket on the container's own tmpfs
at `/tmp`; the rendered config and the self-signed TLS pair sit next to the
database on the EFS mount, `/var/lib/headscale`), so the `headscale`
container runs the two CLI steps itself once its server answers:
`headscale users create infra` and `headscale apikeys create --expiration
87600h`, printed to its own log stream `headscale-<site>/headscale/<task>`.
A `Custom::HeadscaleApiKey` resource per site then reads that stream and
stores the key under
`<resourcePrefix>/headscale-apikey-<site>` — a hand-made secret is adopted as
is. Every task start mints a key; only the newest is stored, and only when
the secret is absent or the rotation stamp changed (`headscale apikeys list`
/ `expire` via ECS Exec if you want to prune old ones). The stack output
`HeadscaleApiKey<site>` says `existing`, `created`, or `rotated`; the
handler's log group is `/aws/lambda/NetworkStack-HeadscaleApiKeyFn*`.

The secret is resolved by CloudFormation at deploy time. To ROTATE the key,
redeploy with `-c headscaleKeyRotation=$(date +%s)`: the stamp rolls the
service (fresh task → fresh key), the resource stores it, and every
minter/reconciler picks it up in the same deploy (without the stamp
CloudFormation keeps the old key). Teardown keeps
the secret (the resource's Delete is a no-op) — delete it by hand with the
stack if the site is gone for good. The public ALB 403-blocks `/api/*` — admin traffic goes
Lambda → Cloud Map (`headscale-<site>.tailnet.internal`) → task over HTTPS,
verified against the certificate the task published to SSM
(`/<resourcePrefix>/headscale-tls-<site>`), never through the ALB.
