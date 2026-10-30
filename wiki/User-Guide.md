How you use the portal day to day: sign in, get credentials, open the console, ask for more access, and reach private resources. Installing the portal itself is [[Getting Started]]; what admins do is on [[Admin Guide]].

## Signing in

Enter your email. The page then offers the ways your account can sign in: password, passkey (Touch ID, Windows Hello or a security key), or a one-time code sent by email. The way you used last time is offered first. Nothing is sent until you choose.

- **Invitation.** The email's "Set your password" link signs you in and asks for a password. Links expire after 7 days; ask an admin to resend one. Under the sign-in card, **Open in the desktop app** continues the same invitation in the app.
- **Forgot password** on the password screen emails a reset code.
- **Passkeys** are managed under Passkeys in your profile menu. A passkey belongs to the browser or app it was created in (Windows shares one store between browser and app; macOS does not), so add one in each browser or app you use.
- **Authenticator app.** If your deployment offers or requires it, enrol from the profile menu; an admin can reset it if you lose the device.
- A session lasts up to 12 hours. Your profile menu shows when it ends, and 15 minutes before that a banner above the page and a notification tell you so. **Sign in again** from either keeps everything running — credentials, the network connection — and starts a fresh 12 hours; **Not now** takes you back. If the session runs out instead, the app takes you to the sign-in page and says why (the desktop app also removes the credentials it wrote and disconnects the VPN), and after signing in you land back on the page you were on. Signing out also ends the AWS console session the app opened for you.

## Your access

The Accounts page lists every account and role you may assume, grouped by account. A role card shows the role, an optional description, and the `~/.aws` profile name the app uses for it.

- **Get credentials** opens a dialog with the access key, secret and session token and a countdown. Copy them in the format for your shell or for `~/.aws/credentials`. Each vend is a new set of keys, and while the dialog is open it re-vends five minutes before expiry, so copy again after that. The session length is set per role by an admin, up to 12 hours.
- **Console** opens the AWS console in your browser, signed in as that role. To keep consoles for several accounts open at the same time, turn on multi-session once per browser: AWS console → account menu → Turn on multi-session.
- **Profile name.** The pencil on a card sets your own name for that role's profile; the default is the admin's naming for the account or role.
- **Temporary access** shows when it ends. The bell tells you shortly before it expires and again when it has.
- **Many accounts.** Once you hold an account an admin kept off the dashboard (or when an admin turns the layout on for everyone), the page becomes shortcuts instead of one long list: **Main** (the accounts an admin put there; asking for one you do not hold is still the **Request a role** button at the top), **Favorites** (the star on an account box — yours, on every device) and **Recently vended** (the last accounts you got credentials or a console for). Two more sections appear when they have something to show: **Signed in now** (roles whose credentials from this session are still running, with the countdown) above Main, and **Other accounts** below Recently vended — a table of the roles you hold outside Main and Favorites: five to start, more loading as you scroll to its end, and the search above as the short way. The search box at the top stays in view as you scroll and looks through everything you hold, by account name, number or role name; its results drop down under it, one row per role with the same star, Console and Get credentials as the cards (and the auto-login bolt in the desktop app). Press Escape or click elsewhere to fold them. On a deployment that sorts accounts by tenant, project and stage, the filter button next to the search narrows by those (and the same filter sits beside the account box when you request a role). **Group by** next to it heads the results by tenant, project or stage.

## Asking for access

- **Request a role** on the Accounts page, or **Request access** on the Network page. Pick from the catalog, say why, and choose long-term or a duration: 1 hour, 12 hours, 1 day, 3 days, 7 days or 30 days. The admin's decision sets the final duration, which may differ.
- One pending request per role or resource. The decision arrives in the bell; approved access appears on the page straight away.
- Standing access is reviewed once a year by an admin. You do nothing; if the review ends your access, the bell says so.

## The bell

The bell at the top of the sidebar collects decisions on your requests, temporary access about to expire or expired, access you were given without asking (an admin granted it, a group you are in now bundles it, someone shared a port with you), and access that was removed, with why: an admin revoked it, a group changed, a review ended it, or the role or resource was deleted.

The same items can pop up as system notifications when the app is behind another window: in the desktop app always (it keeps running in the menu bar or tray), in a browser once you allow it — **Notifications** in the user menu has the switch, an **Allow in this browser** button, and a checkbox per kind (access granted, access revoked, request decisions, access expiring; admins also get new requests and yearly reviews). Clicking a notification opens the app at the right place. Each item pops up once; opening the bell clears the badge as before. Your choices follow you across devices.

## The desktop app

The desktop app shows the same portal and adds what a browser cannot do:

- **Credentials in `~/.aws/credentials`.** Every vend is written under the card's profile name, so the AWS CLI and SDKs pick it up with `--profile`.
- **Auto-login star.** Star a role card and the app vends it on start and re-vends it before every expiry for as long as the app runs.
- **Tray icon.** Shows how fresh your profiles are, warns before they expire, and has Renew all now. Closing the window or Cmd+Q only hides the app to the tray, and it keeps renewing for up to 12 hours; **Quit and remove credentials** in the tray menu is the real quit and removes the profiles it wrote.
- **Several deployments** open as tabs, each with its own login.
- **Links.** A link of the form `infraclient://<portal host>/<page>` opens that page in the app. The sign-in page in a browser offers one.

Install it from the signed installer your admin provides, open it, and enter your portal address once. On macOS, passkeys need to be added inside the app, since it has its own passkey store.

## Private resources over the VPN

If your deployment runs the private network, the Network page lists the databases, internal web apps and hosts you may reach, with their addresses and ports.

1. **First time only:** install Tailscale from tailscale.com. On macOS, open it once and allow the VPN configuration. No Tailscale account is needed; your portal login is your identity.
2. In the desktop app, click **Connect network** (the pill at the bottom of the sidebar). The app mints a one-time key and joins the network for you.
3. On your first connection to a network your access rules are in place within seconds; later changes to your access take at most five minutes.
4. **Test connection** on a resource tells you whether it answers through the tunnel.

Your machine is on one network at a time. Deployments with several sites show which one you are on, and switching is a click in the pill or the tray. Access to a resource is requested and granted the same way as a role.

### Teammates' laptops (dev shares)

If your admin enabled dev shares, the Network page also lists ports teammates share from their laptops, and **Share a local port** in the header shares one of yours (desktop app only). A share names people or groups on one network and ends on its own after the time you pick. To open a teammate's share, connect to that network first — its group's bar has **Connect**, and joining needs no other access — then use **Open in browser**. The link is plain http inside the encrypted tunnel, so the browser may say "Not secure". A "404 page not found" text page means the link is an old IP-form one: ask the owner to stop the share and share the port again. Details: [Sharing a local port](https://github.com/FNTIO/aws-infrastructure-client/blob/main/desktop/README.md#sharing-a-local-port-dev-shares).
