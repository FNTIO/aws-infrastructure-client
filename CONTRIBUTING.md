# Contributing

This repository is the public home of `@fntio/infra-client`: Releases, the
wiki, the issue tracker and the consumer documentation. The source code is
maintained in a private repository and every release lands here as published
artifacts (npm packages and desktop installers), so code changes are not
taken as pull requests here; report what you found instead and it is fixed
at the source.

## What a pull request here can change

- `wiki/`: the wiki's source. A workflow mirrors the folder into the GitHub
  wiki on every push to `main` after checking that every link and heading
  anchor resolves (`node .github/scripts/check-wiki-links.mjs`). Anything
  typed into the wiki web UI is overwritten by the next sync, so edit the
  files. Pages carry no deployment-specific values: no account ids, customer
  names or internal hostnames.
- `samples/`: the five consumer-voice CDK apps.
- The READMEs: `packages/*/README.md`, `desktop/README.md`,
  `frontend/README.md`, this file.

`packages/infra-client/CHANGELOG.md` and `openapi.yaml` are copies of what
ships inside the package for the released version; they are updated by the
release, not by hand.

Commit messages: `<area>: <what changed>` in the imperative, e.g.
`wiki: document the alertEmail list`.

## Issues and labels

Open issues through the forms (bug, feature, deployment problem, design
feedback). A security report never goes in an issue: use private
vulnerability reporting as [SECURITY.md](SECURITY.md) describes. Questions
and open-ended topics go to
[Discussions](https://github.com/FNTIO/aws-infrastructure-client/discussions): Q&A for
how-do-I questions, Ideas for proposals that are not yet a feature request,
Announcements for releases, Show and tell for what people built. Labels are
declared in
[.github/labels.json](.github/labels.json) and synced by
`.github/workflows/labels.yml`; edit the file, not the label settings page.

| Prefix | Meaning | Who sets it |
| --- | --- | --- |
| `type:` | bug, feature, chore, docs, design, deployment, security, question | The form, or whoever files it |
| `area:` | web, desktop, api, infra, vpn, auth, release | Added automatically from the form's Component / Surface / Stack dropdown |
| `priority:` | p0 (production broken) to p3 (nice to have) | Triage |
| `status:` | needs-triage (set by the forms), needs-info, blocked | Triage |

Triage means: confirm the type, set a priority, drop
`status: needs-triage`.

## Repository settings (maintainers, one-time)

GitHub keeps these outside the repo; each is a few clicks in the repo's
**Settings**. The second list needs a public repository: GitHub offers
those features on public repositories only.

### Any repository

1. **Wiki.** Settings → General → Features → tick **Wikis** (available on
   private repos only on paid GitHub plans; public repos always). Then open
   the **Wiki** tab → **Create the first page** → Save with any text. That
   creates the wiki's git repo; the next push to `main` touching `wiki/` (or
   Actions → **Wiki** → Run workflow) replaces the placeholder with the real
   pages. Keep **Restrict editing to collaborators only** ticked: edits made
   on the wiki site are overwritten by the next sync anyway.
2. **Labels.** Actions → **Labels** → Run workflow once to create the set;
   afterwards it runs whenever `.github/labels.json` changes.
3. **Workflow permissions.** Nothing to change by default: each new
   workflow declares the write scope it needs (`contents: write` for the
   wiki sync, `issues: write` for labels). Only if an organization policy
   pins the token to read-only will those runs fail with a 403; then
   Settings → Actions → General → Workflow permissions is where to look.

### Public repository

The issue chooser (`.github/ISSUE_TEMPLATE/config.yml`), the feature form
and SECURITY.md already link to these; the settings make the links work.

1. **Private vulnerability reporting.** Settings → **Advanced Security** →
   next to "Private vulnerability reporting" click **Enable**.
2. **Discussions.** Settings → General → Features → tick **Discussions**.
   On the Discussions tab, click the pencil next to **Categories**: keep
   **Announcements** (releases; maintainers post only), **Q&A** (enable
   "mark as answer"), **Ideas**, **Show and tell**; delete **General** and
   **Polls**.
3. **Fork pull requests.** Settings → Actions → General → under "Fork pull
   request workflows from outside collaborators" choose **Require approval
   for all outside collaborators**, so a workflow from a fork never runs
   before a maintainer has read it.

