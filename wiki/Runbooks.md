Index of the operational runbooks. Each row names a runbook, says when you reach for it, and whether the source describes it as a one-time step per deployment or a recurring one (blank where the source does not say). Hub operations live on this wiki's Runbooks pages; `desktop/README.md` (the Electron client) and `frontend/README.md` (the web app) keep their own. For the first deploy see [[Getting Started]] and [[Deploy and Upgrade]]; for symptom-first help see [[Troubleshooting]]; for the private network as a whole see [[Private Network]].

## Deploy & CI

| Runbook | When you need it | Cadence |
| --- | --- | --- |
| [Install, test, deploy](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#deploy) | Root install, tests, the frontend build every `cdk` command needs, bootstrapping (including us-east-1) and the first manual hub deploy; also the Lambda concurrency raise a fresh account needs | |
| [Setup checklist](Admin-Guide#setup-checklist--first-admin-onboarding-card) | What the in-app setup card checks off (admin, branding, workload account, team, custom email) and how it is dismissed or reopened | |
| [Theme wizard](Admin-Guide#theme-wizard--admin-set-branding-overlay) | How admins restyle the portal after deploy (`/branding.json` merged over `config.json`) and the by-name site bucket migration on the first deploy that includes it | |

## Users, admins & service users

| Runbook | When you need it | Cadence |
| --- | --- | --- |
| [Add a user (and make one an admin)](Runbooks-Users#add-a-user-and-make-one-an-admin) | Command-line recipe: create a user in the pool, get a token, register an account and role, vend credentials and grant a user through the admin API | recurring |
| [First admin: created by the deploy](Runbooks-Users#first-admin--created-by-the-deploy) | `firstAdmin` in config makes the deploy create the first admin and send the invite; re-sending after the 7-day expiry, what `prod: false` means for the pool, and the SES sandbox decision to make before the first deploy | one-time |
| [Invite emails](Runbooks-Users#invite-emails) | What an invite contains with and without a custom web domain, the 7-day expiry, and the live invite check to run after any deploy that touches sign-in config | recurring |
| [Federated sign-in (SSO)](Runbooks-Users#federated-sign-in-sso) | Register the portal at the customer's identity provider (Entra worked example), put the client secret in Secrets Manager, map the customer's own identifier (a GID) as a claim, rotate the secret, remove a provider, and what the desktop app needs | one-time per provider |
| [Service users: machine access to the API](Runbooks-Service-Users#service-users--machine-access-to-the-api) | What a service user is (a client-credentials app client with scopes: `aws`, `network`, `shares`, `admin.read.all`, `admin.write.all`), how its auth and revocation work, how to treat its secret, and the headless vend-and-join sequence | |
| [Add one (admin UI)](Runbooks-Service-Users#add-one-admin-ui) | Create a service user, capture the shown-once client ID and secret, grant it roles and call the API with a token | recurring |
| [Rotate a secret](Runbooks-Service-Users#rotate-a-secret) | Replace-with-overlap rotation on a suspected leak, a holder leaving, a lost secret or a policy demand; remove the old client once the new one shows as used | recurring |
| [Cost note (per clone)](Runbooks-Service-Users#cost-note-per-clone) | Cognito's usage-based machine-to-machine pricing | |

## Customer plugins

| Runbook | When you need it | Cadence |
| --- | --- | --- |
| [What a deployment is turning on](Runbooks-Plugins#customer-plugins--what-a-deployment-is-turning-on) | What a plugin is, the two permission levels, and why nobody — core admin included — holds plugin access until it is granted | |
| [Turning it on](Runbooks-Plugins#turning-it-on) | The three-deploy rollout, and the build step a registered plugin needs before synth | one-time |
| [Granting, and what a dormant grant is](Runbooks-Plugins#granting-and-what-a-dormant-grant-is) | Grant and revoke from the Users and Groups screens, user expiry versus standing group access, and why a dormant grant is kept rather than deleted | recurring |
| [Disabling and removing](Runbooks-Plugins#disabling-and-removing) | What disable, remove and reinstall each do to grants, and the two-deploy order for switching the feature off | |
| [What revocation promises](Runbooks-Plugins#what-revocation-does-and-does-not-promise) | Why a completed revocation bites on the next request, and what it does not stop | |

## Cross-account & trust

| Runbook | When you need it | Cadence |
| --- | --- | --- |
| [Cross-account: trust a second account](Access-Model#cross-account-trust-a-second-account) | Bootstrap and deploy `Roles-<account>` into a workload account; fixed role names and the destroy-then-redeploy rule on an "already exists" error; the 12 h session-length cap | |
| [Sub-pinning: role-scoped trust](Access-Model#sub-pinning--role-scoped-trust) | Why each role's trust pins a role-scoped `sub`, and the load-bearing order: CredsStack first, then every `Roles-<account>`, then vend end to end | |

See [[Access Model]] for how grants turn into vended credentials.

## Keys, backups & recovery

| Runbook | When you need it | Cadence |
| --- | --- | --- |
| [Signing-key rotation (issuer)](Runbooks-Issuer#signing-key-rotation-issuer) | Introduce, wait 10+ minutes, flip, retire: rotating the issuer's signing key through `issuer.keyVersions` and `signerVersion`; retiring orphans a KMS key under `prod: true` | recurring |
| [Issuer on S3 + CloudFront](Runbooks-Issuer#issuer-on-s3--cloudfront--migration-from-api-gateway) | What the 0.1.8 issuer migration changes (certificate to us-east-1, WebCertStack on every deployment) and what it leaves alone (issuer URL, keys, every workload account's trust) | one-time |
| [Zero-downtime sequencing](Runbooks-Issuer#zero-downtime--how-the-one-deploy-sequences-it) | The order CloudFormation applies the migration in and what a mid-way failure rolls back to | |
| [Before pushing it](Runbooks-Issuer#before-pushing-it) | Preconditions: us-east-1 bootstrapped, a clean current tree, no key rotation in the same deploy | one-time |
| [Verify before any client gets 0.1.8](Runbooks-Issuer#verify--before-any-client-gets-018) | `dig` and `curl` checks of the discovery document and JWKS, a real vend, then the ACM CNAME, old certificate, orphaned log group and Security Hub follow-ups | one-time |
| [Republish by hand](Runbooks-Issuer#republish-by-hand) | Invoke the publisher Lambda with a Create-shaped event if the issuer bucket was ever emptied | |
| [Rollback](Runbooks-Issuer#rollback) | `git revert` the migration commit and push; CloudFormation rebuilds the API Gateway path | |
| [Restore from backup (PITR)](Runbooks-Operations#restore-from-backup-pitr) | Restore a table to a side table, verify counts, copy rows back into the live table; a restored table comes back with TTL and PITR disabled | |

## Email & domains

| Runbook | When you need it | Cadence |
| --- | --- | --- |
| [Email deliverability: Cognito via SES](Runbooks-Operations#email-deliverability--cognito-via-ses) | The `email` block: SES identity plus DKIM, MAIL FROM and DMARC records, the sandbox limitation, requesting production access and checking SPF/DKIM/DMARC | one-time |
| [Custom web domain](Runbooks-Operations#custom-web-domain) | The `web` block: certificate in us-east-1, CloudFront alias, Cognito custom auth domain (a child of the app domain), first-deploy timing and cutover notes | one-time |

## Security posture

| Runbook | When you need it | Cadence |
| --- | --- | --- |
| [Security posture: WAF + Security Hub CSPM](Security-Posture#security-posture--waf--security-hub-cspm) | Entry point: how a stock deployment relates to the Foundational Security Best Practices control set | |
| [What deploys (default on)](Security-Posture#what-deploys-default-on) | The three web ACLs, the per-IP and per-token rate rules, managed rule groups in COUNT, logging, cost, the `waf` config, 403/429 triage and the hand cleanup when turning WAF off | |
| [Accepted findings](Security-Posture#accepted-findings-cannot-pass-inside-this-product) | CloudFront.17 cannot pass; suppress it by workflow status per hub account (or disable the control / add an automation rule in an administrator account) | one-time |
| [FSBP coverage](Security-Posture#fsbp-coverage) | Control-by-control status: by construction, with `prod: true`, opt-in knobs, unbuilt cost knobs, accepted by design, account-level; upgrade notes for existing deployments | |

Background in [[Security Posture]].

## Private network

Network stacks are deployed by hand, never from CI. Concepts are on [[Private Network]]; procedures on [[Runbooks-Network]].

| Runbook | When you need it | Cadence |
| --- | --- | --- |
| [Adding a VPC to the network (ConnectorStack)](Runbooks-Network#adding-a-vpc-to-the-network-connectorstack) | Declare the VPC in its site, allow the account on the site's connector minter, deploy NetworkStack then `Connector-<account>`; add split DNS if the VPC has private names | recurring |
| [Which network runbook do I need?](Runbooks-Network#which-network-runbook-do-i-need) | Decision list: first migration to sites, adding a non-colliding VPC, or adding a site for a colliding CIDR | |
| [One-time migration: single plane to sites](Runbooks-Network#one-time-migration-single-plane--sites) | Moving a pre-sites deployment onto per-site control planes; re-enrolls every device and connector once | one-time |
| [Adding a SITE (a new control plane)](Runbooks-Network#adding-a-site-a-new-control-plane) | Only when a new VPC's CIDR collides with an existing site; site ids are permanent; deploy NetworkStack, push promptly, then the site's connectors | |
| [More security-model notes](Private-Network#more-security-model-notes) | Reconciler freshness (rules render every 5 minutes), two-keyed reachability (route plus security group), Headscale state on EFS | |
| [Split DNS (private names over the VPN)](Private-Network#split-dns-private-names-over-the-vpn) | Per-site `splitDns` maps a private domain to its VPC resolver; one config entry plus a NetworkStack redeploy | |
| [Removing a SITE](Runbooks-Network#removing-a-site) | Delete the site from config and redeploy NetworkStack, then delete its API-key secret by hand, the one manual VPN step left | |
| [Headscale admin ops](Runbooks-Network#headscale-admin-ops) | ECS Exec into a site's Headscale task, how the deploy mints the `infra` user and admin API key, and rotating that key with `-c headscaleKeyRotation=<stamp>` | |

## Debugging & teardown

| Runbook | When you need it | Cadence |
| --- | --- | --- |
| [Debugging](Runbooks-Operations#debugging) | Where the API logs are and the per-request JSON trail; cached 401s at CloudFront and how to tell an API Gateway 401 from the app's | |
| [Tear down](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#tear-down) | Lift termination and deletion protection, destroy in reverse order, then clean up retained tables, web ACLs, EFS recovery points and test users | |

## Desktop

| Runbook | When you need it | Cadence |
| --- | --- | --- |
| [Package (distribution)](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#package-distribution) | `npm run dist` builds the one public binary; where the app name, bundle id and runtime strings come from; what unsigned builds can and cannot do | recurring |
| [Code signing & notarization (macOS)](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#code-signing--notarization-macos) | How the `desktop-build` workflow signs, notarizes and Gatekeeper-verifies, why it is pinned to `macos-15`, the one-time Apple enrollment behind the five repository secrets, and adding those secrets to a repository that cuts releases | one-time (setup) |
| [Windows installer](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#windows-installer) | The unsigned Windows build on every Release, what a user clicks through on first launch, and where signing stands | recurring |
| [Passkeys (per platform)](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#passkeys-per-platform) | Passkey support on Windows, signed macOS builds and Linux, plus the Windows verification checklist | |

## Frontend

| Runbook | When you need it | Cadence |
| --- | --- | --- |
| [Build + deploy](https://github.com/FNTIO/aws-infrastructure-client/blob/main/frontend/README.md#build--deploy) | `npm run build` then `cdk deploy WebStack`; where WebStack looks for a bundle and the "Web assets not found" failure | recurring |
| [E2E (Playwright)](https://github.com/FNTIO/aws-infrastructure-client/blob/main/frontend/README.md#e2e-playwright) | The suite against a live deployment: setup once per machine (e2e users, `.env.e2e`, Chromium), the commands, and re-approving screenshot baselines | |

Release mechanics (packing the tarball, cutting a desktop build) are on [[Releasing]].
