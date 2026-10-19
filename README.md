# 86 Board

A live board for restaurant staff: what is 86'd, since when, and why.
Managers and kitchen update it. Servers and hosts see it. Every change is
kept as history.

Live: https://main.d2w35vo1xnmx2i.amplifyapp.com
(AWS Amplify Hosting, Ohio region. Every push to `main` goes live in about three minutes.)

## Where things are

| File | What it does |
| --- | --- |
| `index.html` | The page shell and the fonts. |
| `src/App.tsx` | The screen: header, which restaurant, who you are, the Board / History tabs. |
| `src/components/Board.tsx` | The board. 86'd items on top, full menu below, the 86 confirmation sheet. |
| `src/components/History.tsx` | What was out, how often, for how long. |
| `src/components/Freshness.tsx` | The pill that says how old the board is. Red after 30 seconds. |
| `src/hooks/useBoard.ts` | The 5-second refresh. |
| `src/api/` | The data drawer. `mock.ts` is sample data in the browser. The AWS version will go next to it and plug into the same drawer. |
| `src/types.ts` | The shapes of the data (restaurant, menu item, 86 event). |
| `src/styles.css` | The look. Dark first, for kitchen tablets at night. |
| `scripts/make-artifact.mjs` | Turns the build into one page that can be previewed as a Claude artifact. |

## Run it

```
npm install
npm run dev        # local preview at the address it prints
npm run build      # type-check, then build dist/index.html and dist/artifact.html
```

## Decisions so far

- Three boards, one login system. Each restaurant has its own menu.
- The board refreshes every 5 seconds instead of holding a live connection.
  The freshness pill makes a stale board impossible to mistake for a live one.
- People get deactivated, never deleted, so the history keeps their name.
- Vendor notes are drafted by the morning email and sent by a manager with one tap, never automatically.

## Next

1. Logins with roles (AWS Cognito through Amplify).
2. A shared database so every phone sees the same board (replaces `mock.ts`).
3. Deploy from GitHub so every push goes live (Amplify Hosting).
4. Staff admin page, then history reports, then the morning email.
