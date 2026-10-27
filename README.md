# 86 Board

A live board for restaurant staff: what is 86'd, what is running low, since
when, and why. Managers and kitchen update it. Servers and hosts see it, and
their phones buzz when something changes. Every 86 is kept as history, and
every person has their own login.

Live: https://main.d2w35vo1xnmx2i.amplifyapp.com
(AWS Amplify Hosting, Ohio region. Every push to `main` goes live in a few minutes.)

## Who can do what

| Role | Sees the board | Changes the board | Manages staff |
| --- | --- | --- | --- |
| Owner | every restaurant | yes | yes, everywhere |
| Manager | their restaurant | yes | yes, their restaurant |
| Kitchen | their restaurant | yes | no |
| Server, Host | their restaurant | no | no |

The rules are enforced on the server, not just hidden in the app. Every item,
history entry and staff row carries the groups allowed to read it, so a Main
Street server's login cannot read the Waterfront board or staff list even with
the API called directly. Nobody writes to the board directly: every 86, running
low and back on goes through the `board` function, which checks the caller's
role against the item's restaurant and stamps who did it from their login.
(Restaurant names are the one thing every signed-in login can read.)

## What an item can be

- **Available.** The default.
- **Running low.** The kitchen is down to the last few. The count is shown
  ("Last 4") and can be changed from the item's ticket.
- **86'd.** Gone, with an optional note and the time. Goes into the history.

Editors tap a menu item and choose "86 it" or "Running low". Both move the item
onto a paper ticket at the top of the board, where "Back on" or "Plenty again"
returns it.

## First sign-in (owner)

1. Before the first deploy of a new environment, set `OWNER_TEMP_PASSWORD`
   as an environment variable on the Amplify app (App settings, Environment
   variables). The deploy creates the owner login `omar` with it. Open the
   live URL and sign in; the app asks for a new password before letting you
   in. Remove the variable afterwards. (The live app already has its owner.)
2. The board is empty. Go to Staff and press "Load demo data". This creates
   the three restaurants, their menus, a week of history and 60 staff logins,
   and shows the one password they all share, once.
3. Try `priya.m` (manager, Main Street) and `sam.t` (server, Main Street) in a
   private window.

## Adding people

Staff, "Add a person". Name, username, role, restaurant.

- **Username.** Suggested from the name, in plain letters: "José Peña" becomes
  `jose.pena`. The app checks it is free while you type. If `marco.r` is taken,
  the new Marco gets `marco.r2`, and the form says so before you save.
- **Password.** Leave it empty and they get a temporary one, which they replace
  at their first sign-in. Or tap Generate for a password that is theirs from
  the start. Either way it looks like `Basil-Tray-4821!`: two kitchen words,
  four digits and a symbol. Easy to read out over the pass, and one of over a
  billion possibilities.
- **Login message.** After saving, "Copy login message" copies a ready-to-text
  note with the app's address, the username and the password.

The rules live in `shared/logins.ts`, used by the app and the server alike, and
`shared/logins.test.ts` proves them.

Tap a person to reset their password, switch them off, or switch them back on.
Switching off signs them out within seconds, stops their phone alerts, and keeps
their name in the history. Only a login that was never used can be removed.

## The public demo

Anyone can try the app without an account: the "Try the demo" button under the
sign-in, or the link `…/?demo`. The visitor picks a role (kitchen, server,
manager, owner), gets a made-up login like `guest.kitchen.4821` from the same
password generator, and explores the three sample restaurants.

The demo never talks to AWS. `src/lib/demo.ts` switches the data drawer to
sample data (`src/api/mock.ts`) for that browser tab, so nothing a visitor does
reaches the real board, sends an alert, or creates a real login. "Exit demo"
goes back to the staff sign-in.

## Phone alerts and the home-screen app

The site installs on a phone like an app (its own icon, no browser bars). On
Android, Chrome offers it; on an iPhone, Share, "Add to Home Screen".

The bell in the top bar turns alerts on for that phone. From then on it buzzes
when something at that restaurant is 86'd, runs low, or comes back on, even
with the app closed. On an iPhone this only works once the site is on the Home
Screen; the Alerts sheet walks through it. The owner's phone gets every
restaurant.

How it works: `public/sw.js` is the service worker that shows the notification.
`amplify/functions/push/` keeps one row per phone and, fed by the menu table's
change stream, sends the push. The signing keys are created on first use and
stored in the `PushKey` table, so nothing is configured by hand.

The n8n workflow files in `n8n/` carry placeholders (`YOUR_EMAIL@example.com`,
`YOUR_REPORT_LINK`, `YOUR_GOOGLE_SHEET_ID`); the filled-in copies live with the
person who runs them, not in the repo.

## Where things are

| File | What it does |
| --- | --- |
| `index.html` | The page shell, icons and the home-screen app tags. |
| `public/manifest.json`, `public/sw.js`, `public/icons/` | What makes the site installable, and the service worker that shows alerts. |
| `src/App.tsx` | The screen: who is signed in, which restaurant, Board / History / Staff, the bell. |
| `src/components/Login.tsx` | Username and password; handles the first-time password change; the "Try the demo" button. |
| `src/components/DemoStart.tsx` | The demo's front door: pick a role, get a made-up login, start. |
| `src/lib/demo.ts` | Decides when this tab is the demo, and the demo roles. |
| `src/components/Board.tsx` | The board. 86'd and running-low tickets on top, full menu below, the item sheet. |
| `src/components/Alerts.tsx` | The bell, the nudge, and the sheet that turns alerts on or off. |
| `src/components/History.tsx` | What was out, how often, for how long. |
| `src/components/Staff.tsx` | Add a person, the person sheet (reset, switch off, remove), load demo data. |
| `src/components/Freshness.tsx` | The line that says how old the board is. Red after 30 seconds. |
| `src/hooks/useBoard.ts` | The 5-second refresh, plus the check that the account is still switched on. |
| `src/push.ts` | The browser side of alerts: permission, subscription, install prompt. |
| `src/api/` | The data drawer. `aws.ts` talks to the backend; `mock.ts` is sample data in the browser; `index.ts` picks one. |
| `src/amplify.ts` | Picks AWS when `amplify_outputs.json` exists (it does on Amplify builds), sample data otherwise. |
| `shared/sample-data.ts` | The three restaurants, menus, sample history, low items and 60 staff, used by both modes. |
| `shared/logins.ts` | Usernames (plain letters, next free one) and generated passwords, used by the app and the server. |
| `amplify/auth/resource.ts` | The Cognito user pool and its groups (`owner`, `main-kitchen`, `water-server`, ...). |
| `amplify/data/resource.ts` | The database tables and who may read or change each one. |
| `amplify/functions/board/` | The only code that changes the board: checks who is asking, stamps their name, keeps the history entry in step. `transitions.ts` is the plain logic; `transitions.test.ts` proves it. |
| `amplify/functions/staff-admin/` | The only code allowed to create, switch off or reset logins. `rules.ts` holds the who-may-do-what rules. |
| `amplify/functions/push/` | Phone alerts: registers phones and sends the push on every item change. |
| `amplify/backend.ts` | Wires it together: usernames for sign-in, the first owner account, the table stream into the push function. |
| `amplify.yml` | What Amplify runs on every push: deploy the backend, then build the app. |
| `src/styles.css` | The look, "The Pass": dark espresso field, amber accent, paper tickets with a red stamp. |

## Run it locally

```
npm install
npm run dev        # sample data, no AWS needed
npm test           # the unit tests, under two seconds
npm run check      # type-check the app and the backend, then the tests
npm run build      # type-check, then build dist/index.html and dist/artifact.html
```

## How changes reach the restaurant

Nothing goes to `main` directly. Work happens on a branch and lands through a
pull request. GitHub runs `check` (install, type-check, tests) on every pull
request, and `main` is protected so a red check cannot be merged. A merge to
`main` is the deploy: Amplify runs the type-check and the tests once more, then
updates the backend, then builds the app.

After an update that changes the data shape, the owner presses "Repair data"
on the Staff screen once. It fills in what older rows are missing and is safe
to run any time.

## Decisions

- Three boards, one login system. Each restaurant has its own menu and staff.
- The board refreshes every 5 seconds instead of holding a live connection.
  The freshness line makes a stale board impossible to mistake for a live one.
  Alerts cover the gap: a phone in a pocket still hears about an 86.
- People get switched off, never deleted, so the history keeps their name.
  A switched-off account is signed out by the app within seconds and loses
  API access within five minutes (tokens are short-lived).
- Usernames instead of email addresses, because restaurant staff should not
  need a personal email to see the board. A manager resets forgotten passwords.
- The service worker does not cache the app. A stale board is worse than a slow one.
- Vendor notes will be drafted by the morning email and sent by a manager with
  one tap, never automatically.

## Next

1. Custom domain (omars86board.com) on the Amplify app.
2. Morning email: last night's 86s and anything out more than three days.
3. Vendor report: how often each supplier shorted us.
4. Stale-item prompt each morning: still out, or back on?
