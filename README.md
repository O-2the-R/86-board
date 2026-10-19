# 86 Board

A live board for restaurant staff: what is eighty-sixed, since when, and why.
Managers and kitchen update it. Servers and hosts see it. Every change is
kept as history, and every person has their own login.

Live: https://main.d2w35vo1xnmx2i.amplifyapp.com
(AWS Amplify Hosting, Ohio region. Every push to `main` goes live in a few minutes.)

## Who can do what

| Role | Sees the board | Changes the board | Manages staff |
| --- | --- | --- | --- |
| Owner | every restaurant | yes | yes, everywhere |
| Manager | their restaurant | yes | yes, their restaurant |
| Kitchen | their restaurant | yes | no |
| Server, Host | their restaurant | no | no |

The rules are enforced by the database, not just hidden in the app. A server's
login cannot change an item even with the API called directly.

## First sign-in (owner)

1. Open the live URL. Username `omar`, temporary password `Change-Me-86!`.
   The app asks for a new password before letting you in.
2. The board is empty. Go to Staff and press "Load demo data". This creates
   the three restaurants, their menus, a week of history and 60 staff logins.
3. Every sample staff login uses the password `Welcome86!`. Try `priya.m`
   (manager, Main Street) and `sam.t` (server, Main Street) in a private window.

## Where things are

| File | What it does |
| --- | --- |
| `index.html` | The page shell and the fonts. |
| `src/App.tsx` | The screen: who is signed in, which restaurant, Board / History / Staff. |
| `src/components/Login.tsx` | Username and password; handles the first-time password change. |
| `src/components/Board.tsx` | The board. 86'd items on top, full menu below, the 86 confirmation sheet. |
| `src/components/History.tsx` | What was out, how often, for how long. |
| `src/components/Staff.tsx` | Add a person, switch someone off, reset a password, load demo data. |
| `src/components/Freshness.tsx` | The line that says how old the board is. Red after 30 seconds. |
| `src/hooks/useBoard.ts` | The 5-second refresh, plus the check that the account is still switched on. |
| `src/api/` | The data drawer. `aws.ts` talks to the backend; `mock.ts` is sample data in the browser; `index.ts` picks one. |
| `src/amplify.ts` | Picks AWS when `amplify_outputs.json` exists (it does on Amplify builds), sample data otherwise. |
| `shared/sample-data.ts` | The three restaurants, menus, sample history and 60 staff, used by both modes. |
| `amplify/auth/resource.ts` | The Cognito user pool and its groups (`owner`, `main-kitchen`, `water-server`, ...). |
| `amplify/data/resource.ts` | The database tables and who may read or change each one. |
| `amplify/functions/staff-admin/` | The only code allowed to create, switch off or reset logins. |
| `amplify/backend.ts` | Wires it together, switches sign-in to usernames, creates the first owner account. |
| `amplify.yml` | What Amplify runs on every push: deploy the backend, then build the app. |
| `styles.css` | The look: ivory paper, ink, oxblood for anything 86'd. |

## Run it locally

```
npm install
npm run dev        # sample data, no AWS needed
npm run build      # type-check, then build dist/index.html and dist/artifact.html
```

## Decisions

- Three boards, one login system. Each restaurant has its own menu and staff.
- The board refreshes every 5 seconds instead of holding a live connection.
  The freshness line makes a stale board impossible to mistake for a live one.
- People get switched off, never deleted, so the history keeps their name.
  A switched-off account is signed out by the app within seconds and loses
  API access within five minutes (tokens are short-lived).
- Usernames instead of email addresses, because restaurant staff should not
  need a personal email to see the board. A manager resets forgotten passwords.
- Vendor notes will be drafted by the morning email and sent by a manager with
  one tap, never automatically.

## Next

1. Custom domain (omars86board.com) on the Amplify app.
2. Morning email: last night's 86s and anything out more than three days.
3. Vendor note drafts, one per supplier, sent with one tap.
4. Stale-item prompt each morning: still out, or back on?
