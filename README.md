# Pit Wall

A Formula 1 deck-building roguelike. Plain HTML/CSS/JS, no dependencies. It's mobile-first, saves automatically and works offline once loaded.

## Run it locally

```bash
npx serve .
```

Then open the address it prints (on your phone too, if you're on the same Wi-Fi). Opening `index.html` directly also works, but offline support only turns on when served over http(s).

## Deploying (GitHub Pages, automatic)

Every push to the `main` branch rebuilds and publishes the game. The workflow lives in `.github/workflows/deploy.yml` and does this:

1. Syntax-checks `game.js`, `sw.js` and `build.js` (a typo stops the deploy instead of shipping a broken game).
2. Runs `node build.js`, which copies the 8 game files into `dist/` and gives the service worker a fresh cache name, so players' browsers always pick up the new version.
3. Publishes `dist/` to GitHub Pages.

So the day-to-day flow is just:

```bash
git add -A
git commit -m "Describe the change"
git push
```

and the live site updates about a minute later. Watch progress under the repo's **Actions** tab; a failed check shows up there in red and leaves the live site untouched. You can also redeploy without changing anything: Actions, "Deploy to GitHub Pages", Run workflow.

### One-time setup

1. Create an empty GitHub repo (public; free Pages hosting needs a public repo) and push this project to it.
2. In the repo go to **Settings, Pages** and set **Source** to **GitHub Actions**.
3. Push (or run the workflow). The game appears at `https://<your-username>.github.io/<repo-name>/`.

All paths in the game are relative, so the `/<repo-name>/` subfolder URL works.

## Building by hand

```bash
node build.js
```

Copies the deployable files into `dist/` (about 72 KB). `dist/` is git-ignored because the workflow builds it fresh each time. Zip its contents if you ever want to upload manually somewhere (itch.io, Netlify Drop, Cloudflare Pages), and note that some hosts add their own badge or banner to the page.

## Playing it like an app

On a phone, open the hosted link and use **Add to Home Screen** (iOS Safari: Share menu; Android Chrome: menu, Install app). It then launches full-screen with its own icon and works without a connection.

## Notes

- Saves and stats live in the player's own browser (localStorage), per site address. They don't sync between devices or browsers, and clearing site data erases them. Moving to a new address (for example from Netlify to GitHub Pages) starts with empty saves and stats.
- Sound is generated in the browser, so there are no audio files to host.
- Files: `index.html`, `style.css`, `game.js` (all the game logic), `manifest.webmanifest` and `sw.js` (install and offline support), the three icon PNGs, and `build.js` (packaging).
