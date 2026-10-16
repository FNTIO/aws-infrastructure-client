Customer plugins: what they are, turning the feature on, and the grant, disable and removal lifecycle. Index: [[Runbooks]].

## Customer plugins — what a deployment is turning on

A **plugin** is a small app a deployment bolts onto the portal: a frontend
shown in an iframe on the portal's own origin, and Lambda routes behind the
portal's shared authorizer. The portal handles sign-in, which accounts a
caller may use, theming and permissions; the plugin handles its own subject
matter.

A plugin page runs as the signed-in user — it is a same-origin iframe, so
nothing in the browser stops it from reading the portal's tokens or calling
core APIs as that user. The permissions below decide who sees a plugin, not
what its code may do: install only plugins you would trust with the portal
itself. Plugin assets are served under a Content-Security-Policy that lets
the page load from and talk to the portal only.

Each plugin declares up to two permissions, `user` and `admin`, and is bound
to specific accounts. People are granted those permissions per account from
the same Users and Groups screens as roles. `admin` includes `user` only
where the plugin declares `user`. There is no bypass — a core administrator
holds no plugin access until someone grants it, and neither does a service
user.

Plugins are **off** until the configuration enables them, and enabling the
feature alone registers nothing. See
[Plugins](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#plugins)
for the deploy side and
[Plugin permissions](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client/README.md#plugin-permissions)
for what a stored grant means.

## Turning it on

Three deploys, so each step is verified alone: the feature off (storage
appears, nothing else), the feature on with nothing registered (the routing
changes, every existing route must still answer), then the first plugin.
The staged rollout, with what to check after each, belongs in the
"Customer plugins" section of the deployment's own README.

A registered plugin's frontend must be built before synth, and registering
one while the feature is off fails at synth rather than silently doing
nothing.

## Granting, and what a dormant grant is

Grant and revoke from a user's or a group's detail page, in the Plugins
panel beside Roles and Network resources. Both operations are idempotent.
A user grant can carry an expiry; a group's cannot, because a group's bundle
lasts as long as membership does.

A grant whose plugin was disabled or removed, or whose account is no longer
bound or registered, becomes **dormant**: still listed, still revocable,
authorizing nothing. That is deliberate — reinstalling the same plugin id
restores still-valid access rather than making an administrator re-grant
everything. Losing a capability raises the usual revocation notice.

## Disabling and removing

Disabling a plugin hides it and refuses its calls while keeping every grant.
Removing the registration tombstones its catalogue record, keeps the labels
so historical grants stay readable, and deliberately keeps the grant rows.

Turning the whole feature off is **two deploys in order**: remove the
registrations first, then disable the feature. Registrations passed while
`enabled` is false fail at synth, and tombstoning first is what notices the
holders; the table and bucket stay, with their exports, so the second deploy
cannot fail on an export in use.

## What revocation does and does not promise

A revocation that completed is honoured by any authorization check that
begins afterwards — decisions are never cached and the reads are strongly
consistent. A request already authorized finishes, and a long-running job a
plugin accepted runs until that plugin's own cancellation rules stop it.
There is no atomic snapshot across unrelated concurrent grant edits.

## Writing one

The step-by-step guide, with the code each step needs, is
[Your first plugin](https://github.com/FNTIO/aws-infrastructure-client/blob/main/packages/infra-client-plugin-example/README.md),
the README of the reference plugin (a scoped AWS Systems Manager Parameter
Store viewer and editor). Two agent skills ship inside the packages: one for
building a plugin, one for integrating it into a CDK application that
already exists. See [API Integration](API-Integration) for the portal's own
HTTP API.
