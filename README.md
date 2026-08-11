# Price Challenge

A classroom-friendly price guessing game inspired by classic TV game mechanics. Create 2–4 teams, add product photos and actual prices, give each team a timed private turn to submit a bid, and automatically award the point to the closest bid without going over.

## Features

- 2–4 customizable teams
- Team names and colors
- Configurable per-team timer: 15, 20, 30, 45, 60, or 90 seconds
- “Pass the device” ready screen so the timer does not run while teams switch
- Automatic no-bid when a team runs out of time
- Product photo upload with browser-side image resizing
- Hidden locked bids until the reveal
- Closest-without-going-over scoring
- Tie support: tied teams each receive one point
- Running scoreboard
- Reusable saved games stored in IndexedDB
- JSON export/import for backups and moving games between devices
- Optional timer/reveal sound effects
- Responsive layout for laptops, tablets, projectors, and TVs
- No server, database account, build step, or paid hosting required

## Run it locally

Because this is a static website, you can open `index.html` directly in most browsers.

For the most reliable local test, serve the folder with a tiny local server. If Python is installed:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Put it on GitHub Pages

1. Create a new GitHub repository, for example `price-challenge`.
2. Upload `index.html`, `styles.css`, and `app.js` to the root of the repository.
3. Commit the files.
4. Open the repository's **Settings**.
5. Select **Pages** in the sidebar.
6. Under **Build and deployment**, choose **Deploy from a branch**.
7. Choose your main branch (usually `main`) and the `/ (root)` folder.
8. Save.

GitHub will provide the public Pages URL after deployment.

## How the timer works

Each team gets its own full countdown.

1. The app displays “Pass to Team X.”
2. The team presses **Start My Timer** when they are ready.
3. Their bid field appears and the countdown begins.
4. They enter a price and press **Lock In**.
5. Their bid is hidden and the app moves to the next team.
6. If the timer reaches zero, that team receives **No Bid** for the round.
7. After all teams are done, the host presses **Reveal Price**.

## Data/privacy notes

All game data stays in the browser unless you export a JSON file. There is no login and nothing is sent to a server by this app.

Saved browser games are device/browser specific. Use **Export** if you want a backup or want to move a game to another computer.

## Game rule

The winner is the highest valid bid that is less than or equal to the actual price. Any bid over the actual price is disqualified for that round.

If multiple teams submit the same winning bid, each tied team receives one point.
