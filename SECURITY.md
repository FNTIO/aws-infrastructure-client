# Security policy

`@fntio/infra-client` vends AWS credentials and console sessions across
accounts and opens private network paths, so a vulnerability here is a
vulnerability in every deployment. Please report it the way this section
describes, and never in a public place.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting,
[Report a vulnerability](https://github.com/FNTIO/aws-infrastructure-client/security/advisories/new),
and do not open an issue, discussion, or pull request for it. If you would
rather not write it down, contact a maintainer directly.

Include what you can of:

- the package version (`@fntio/infra-client` in the deployment's
  `package.json`) or desktop app version, and which component: web app,
  desktop app, API, CDK stacks, private network, sign-in
- steps to reproduce, or the request/response pair that shows the problem
- the impact you believe it has (what an attacker gets, which trust boundary
  it crosses)

Leave out live credentials, tokens, or session material; describe them
instead.

You will get an acknowledgement, a fix or a mitigation coordinated with you,
and credit if you want it. The report stays private until a fixed version
has shipped to deployments.

## Scope

In scope: anything in this repository, including cross-account trust
(`TargetAccountStack`, sub-pinning), credential and console vending, the
access model, sign-in (Cognito, passkeys, service users), the VPN control
plane and its ACL and security-group automation, the desktop client's
credential handling, and the deploy workflows.

Out of scope: findings that require a compromised AWS account or admin user
of the deployment itself, and issues in third-party dependencies that have no
reachable path through this code (report those upstream; tell us if you think
we should pin or patch).

## Supported versions

The latest release receives fixes. Deployments on an older version
should upgrade first; the wiki's
[Deploy and Upgrade](https://github.com/FNTIO/aws-infrastructure-client/wiki/Deploy-and-Upgrade)
page lists version-specific steps.
