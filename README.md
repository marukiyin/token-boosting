# Token Boosting queue

A public queue site for joining a host's game sessions. Players pick one or two hours, optionally buy a skip, and pay you through PayPal or Cash App. You confirm payments and call players up from the Host desk.

No accounts are needed to join. The server has no dependencies and needs Node 18 or newer.

## Files

- `server.js` keeps the queue, checks who may change what, and serves the site.
- `public/index.html` is the whole website (design, music, intro, pages).
- `package.json` tells hosting services how to start it.

## Run it on your computer

    HOST_KEY=choose-a-long-password node server.js

Then open http://localhost:3000. Windows PowerShell: `$env:HOST_KEY="choose-a-long-password"; node server.js`.

`HOST_KEY` is your Host desk password. The server will not start without one (8 characters or more).

## Put it on the web

Any host that runs Node works (Render, Railway, Fly.io and similar). The steps are the same everywhere:

1. Put this folder in a GitHub repository (do not put your password in it).
2. Create a new "Web Service" from that repository on the host.
3. Start command: `node server.js`. No build step is needed.
4. Add an environment variable named `HOST_KEY` with your password.
5. Deploy. The host gives you a web address with HTTPS already on.
6. To use your own domain, add it in the host's dashboard and point your domain's DNS at it. Domains are bought from a registrar, not from the host.

Run only one copy of the server. The queue is kept in memory and saved to `data.json`.

Free plans on some hosts erase files when the service restarts or sleeps, which would empty the queue. If that matters, add a persistent disk and set `DATA_FILE` to a path on it (for example `DATA_FILE=/var/data/data.json`). Check each host's current plans.

## Using the Host desk

Open `your-site/#host` (or the "Host" link in the footer) and enter your password. You can confirm payments, call players up, end sessions, remove passes, close the line and switch your online status. Your login lasts until you close the tab.

## Changing things

Open `public/index.html` and look for `CONFIG` near the top of the second script:

- `host` is the name shown as the host.
- `tickets` and `skipPrice` are your prices.
- `pay` holds your PayPal.Me link and Cash App name.
- `LYRICS` (just above `CONFIG`) holds the lyrics shown during the loading screen, as `{ t: seconds, text: "line" }` entries.

## How it protects people

- Players are recognised by a random ID kept in their browser. There are no accounts and no emails.
- A player can only change their own pass. Only the Host desk can confirm payments, call people up or remove passes.
- A player's contact detail is visible only to that player and to you.
- Finished passes are deleted automatically after 24 hours.
- Wrong Host desk passwords are rate-limited, and changes are limited per IP address.

## Before you share it

- Use a long, unique `HOST_KEY` and never put it in the code or the repository.
- The Terms of Service and Privacy Policy pages are plain-language templates written to match what the site does. Have someone review them, especially if you take real payments.
- The "My Song" audio is embedded in the page. Only keep it if you own it or have permission to use it.
- This site only helps people pay you. It never handles money itself, so check each payment arrived before you confirm it.
