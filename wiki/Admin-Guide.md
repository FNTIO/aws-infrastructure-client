What an admin sees and does in the portal that a user does not. Every admin action here is also an API route (see [[API Integration]]); how access is computed is on [[Access Model]]. Only admins can add accounts and roles; there is no self-service.

## Setup checklist — first-admin onboarding card

Admins see a "Set up <project>" band pinned above the content panel on every
page until the deployment is actually set up. Items check themselves off from real
state (`GET /admin/setup` + the branding overlay): admin created (always, by
the deploy) → branding chosen (a theme saved; skipping records the dismissal
but leaves the step open) → workload
account connected (≥1 registered account AND ≥1 successful vend on record) →
team invited (someone besides the caller has finished sign-in) → custom email
(optional; from `EmailConfig` presence, baked in as `EMAIL_CONFIGURED`). The
trust-stack sub-step renders a copyable `TargetAccountStack` snippet with the
deployment's real issuer URL; accounts named in the config's `rolesByAccount`
(baked in as `CONFIG_ACCOUNTS`) are suggested for registration until they're
in the catalog. Once everything required is done the band condenses to a
one-line "Setup complete" strip — it stays until its ✕ dismisses it
(per-browser, localStorage), and dismissing points at the sidebar user
menu's "Onboarding" item (which also shows "n of 5 done"), which reopens
it any time. Progress re-checks on every navigation. Nothing here is
consulted for any access decision.

## Theme wizard — admin-set branding overlay

The first admin to sign in with no saved theme gets the **Customize theme**
wizard (also in the sidebar user menu, admins only). Saving writes
`/branding.json` into the site bucket via `PUT /admin/branding`; the SPA
fetches it at boot and merges it over `config.json`'s `branding` — admin
choices win field-by-field, `config/project.ts` stays the deploy-time
default and the template example. "Skip for now" records a dismissal in the
same file so no admin is prompted again. The plumbing behind it is on [[Architecture]].

## Accounts and roles

The admin Accounts page is the catalog every grant refers to.

- **Register an account** with its 12-digit id, a friendly name and, optionally, a default `~/.aws` profile name users get when they hold exactly one role there. The account's trust stack must already be deployed (the setup card shows the snippet); the portal cannot verify that across accounts.
- **Add a role** with its IAM name and ARN (the ARN's account must be the account you are adding it to), a display name, a description, a chip colour and icon, a default profile name, and the session length credentials are vended for (15 minutes to 12 hours, default 1 hour). **Test** tries that length against the IAM role as you, so a role capped lower by its `MaxSessionDuration` is caught before a user hits it.
- **Arrange order** on the Accounts tab: drag accounts, and the roles inside each, into the order every page shows to every user — Your access and the admin tabs alike — so dev, stage and prod, and the roles in them, stay where people expect them. The arrows on each row do the same from the keyboard; Done saves, Cancel drops the changes. Entries without a position list after the ordered ones, by name.
- **Show in the Main section** (on the account form, on by default) puts the account in everyone's dashboard Main section. Turn it off for accounts few people need day to day: users then reach them by search, favorites and recents, and the dashboard switches to that shortcuts layout only for users who hold such an account — for everyone else it stays the plain list. Arrange order covers the Main accounts; the rest list by name. A pipeline that registers accounts passes `main: false` the same way.
- **Dashboard layout** is the deployment-wide choice behind that, set in the deployment config (`dashboard: { layout }`, see the [[Configuration Reference]]), not on this page: **auto** (the default) gives a user the Main / Favorites / Recent layout once they hold an account that is off the Main section and the plain list until then; **sections** and **plain** apply that layout to every user. A change deploys with the next hub-stack deploy.
- **Dimensions** (deployments with `accountDimensions` on — see the Configuration Reference): tenant, project and stage are read off the account's name when it is registered (`<tenant>-<project>-<stage>`) and shown under its number. The three fields on the account form correct them; renaming an account never changes them, and an account whose name does not fit the rule shows as `unclassified`. The filter button beside the search narrows the Accounts tab by them, and the same filter sits beside every account picker (add role, grant roles, request access).
- **Who can assume it** lists holders, direct and through groups, with expiry.
- **Deleting a role revokes every grant on it, drops it from group bundles and closes its open requests; deregistering an account does that for each of its roles.** An account that still has network resources cannot be deregistered — remove those first. Both notify the people affected, and a delete that fails halfway can simply be repeated.

## Users

The Users page is the Cognito directory, so a user with no access still appears.

- **Create user** sends the invitation email (a set-your-password link, valid 7 days) and opens the new user's panel, so you can grant access right away; no link is shown while the email goes out. Switch **Send invitation email** off to create the user without any email: the panel then shows the **sign-up link** and the app's address to copy, and that link is the only invitation. Anyone holding the link can set that user's password, so send it privately. While the invite is open, the user's panel offers **Copy sign-up link** (a fresh link — the emailed one and any earlier copy stop working) and **Send invite email** (which likewise replaces a copied link). Bulk invites take up to 50 addresses at once and report per address; with the email off, the result list carries the app's address and a copy button per created user.
- **Admin** makes or unmakes an admin; the last admin cannot be demoted.
- The row's panel shows the user's roles and network resources and how each is held: directly, through named groups, or both, plus when they were last seen.
- **Roles** and **Network** grant or revoke access directly, long-term or for a duration; a temporary grant never overwrites a long-term one.
- **Revoke everything** removes every direct grant and every group membership at once.
- **Reset MFA** turns an authenticator off so a user who lost the device can sign in with a password again and re-enrol.
- **Delete user** removes the account, its grants, memberships and requests. Bulk delete refuses your own account.
- Selecting rows arms the bulk bar: send invite emails, add to a group, delete. Grants are made from a user's panel or through a group.

## Groups

A group is a bundle of roles and network resources plus a member list. Every member holds the whole bundle. Editing the bundle applies to every member: added roles are granted, removed ones revoked unless a member also holds them directly or through another group. Deleting a group pulls its bundle from everyone the same way. Group-provided access is reviewed once a year (see Requests). Groups are the way to give a team the same access without per-person grants. On a deployment with account dimensions, an existing group's form also has **Add one role across many accounts**: type the role name, narrow by tenant, project or stage, count the matches, then add them in one step (accounts already in the bundle are skipped; members get the new access immediately). And when you add a role to an account that has dimensions, the form ends with the groups that already bundle that role in the account's siblings (same tenant and stage): tick the ones this account belongs in and they get the role at once, or skip.

## Requests

- **Pending** is the queue, oldest first; **Decided** the history. Each row shows who, what, why, the requested duration, and for reviews how much the holder actually used the role in the review window.
- **Approve** grants immediately. You choose the final duration, long-term or a preset, whatever the user asked for, and can leave a note the requester sees.
- **Deny** grants nothing and leaves existing access untouched, except on a review, where denying ends the standing access under review.
- **Reviews** are raised by the portal once a year for standing access: a user's long-term role or resource, a group's bundle, an admin's admin rights, and each service user. They sit in the same queue. A review nobody decides eventually lapses per the grace rules on [[Access Model]].
- Two admins cannot decide the same request; the second sees it was already decided.

## Service users

The Users page's second tab. A service user is an app client for a system, not a person: it authenticates with a client id and secret and reaches only its **scopes**: AWS (list its roles, get credentials), Network devices (enroll machines on the private network), Shares, Admin (read) — every administration page read-only — and Admin (read + write) — every admin action, including creating users and service users. Give the admin scopes only to a system that administers or audits the portal; a VM agent gets AWS and Network devices plus the roles and network resources it needs, granted from its panel like a person's. **Change scopes** on the panel holds from its next call. Creating one shows the secret exactly once. **Rotate** issues a replacement client and secret that work alongside the old ones until you **Remove previous secret**. Deleting removes the client, its grants and its record. Service users are reviewed yearly like admins. The calling side is on [[API Integration]].

## Activity

The activity log: every action that changes or uses access, one row each, newest first — who did it, what, to whom or what, the outcome (OK, denied, failed) and why. It covers credential vends, console sign-ins and device enrollments; grants and revokes of roles, network resources, plugin permissions and dev shares, directly or through a group; group membership and bundle edits; requests raised, approved and denied, and the yearly reviews the sweep raises or lets lapse; catalog changes to accounts, roles, resources, groups and the branding (a save that changes nothing writes no row); user invites, deletions, admin changes, MFA resets and service-user lifecycle; VPN sessions per site (from the reconciler's five-minute pass), firewall rules it writes and connectors it prunes; and refused admin or plugin calls. Actions nobody clicked show **System** as the actor with the job's name (yearly review, reconciler, deploy).

Filter by time — the last 7, 30 or 90 days, or a custom range with a date and time at each end (a span of up to 90 days, anywhere inside the retention) — and by type, outcome, account, who did it, the person it was about, and the specific role, resource, group, site, plugin, share or service user. Search covers every visible string. **Per-user effects** shows the rows the access diff writes for each person a group, cascade or bulk change touched ("gained DeployRole via group Platform"); they are hidden by default and always included in a person's own trail. Every role, resource and group panel has a **History** link that opens this page pre-filtered; a user's panel shows their history in place on its **History** tab (last 90 days, older on demand), with **Open in Activity** for the full filters. When a window holds more than the page fetched, **Load older** continues from the oldest row shown.

**Export CSV** exports the rows loaded and filtered. **Access report** (on the Users page) exports the state the log explains: one row per person and everything they can reach right now, with how (direct, or through which groups), who granted it, when, and until when. It is built in the background — a large catalog makes more rows than one request may carry — and opens as a download link once ready; the link works for 15 minutes and the file is kept for a week.

Retention is `audit.retentionDays` in the deployment config (default 400 days, which outlasts the yearly review; the review reads a role's usage from this log). Nothing here is used to decide access; it is the record.

## Network

The admin Network page has two halves. The catalog registers each private resource: name, type (database, web server, host), address and ports, an optional DNS name users connect to, an optional security group so the portal opens the firewall rule itself, and a description; **Who can reach it** manages grants like roles, and a resource's grants go with it when it is deleted. The map shows the sites, their connectors, the devices enrolled, and the reconciler's last pass per resource with the reason a resource is or is not reachable; **Sync now** runs the reconciler ahead of its five-minute schedule. Concepts on [[Private Network]], procedures on [[Runbooks-Network]].

## Branding

Deploy-time defaults come from the config's `branding` block; the theme wizard above overrides them field by field at runtime, and the desktop app adopts whatever the deployment serves.
