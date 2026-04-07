# MultiChat — Stream Chat Overlay

A single-page chat overlay that combines messages from **Twitch, YouTube, Kick, Abstract, and Discord** into one view. Built for use as a Browser Source in OBS.

---

## What You Need

- [OBS Studio](https://obsproject.com/)
- [Streamer.bot](https://streamer.bot/) (for Twitch, YouTube, Kick)
- [Node.js](https://nodejs.org/) v16 or higher (for the Discord bridge)
- A Discord bot token ([create one here](https://discord.com/developers/applications))

---

## Setup

### Step 1 — Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/multichat.git
cd multichat
```

### Step 2 — Install dependencies

```bash
npm install
```

### Step 3 — Create your config file

Copy the example config and fill in your details:

```bash
cp config.example.js config.js
```

Open `config.js` and replace all the placeholder values:

| Field | What to put |
|---|---|
| `SB_WS_URL` | Leave as-is if Streamer.bot is on the same PC |
| `ABS_WS_URL` | Your Abstract channel WebSocket URL |
| `DISCORD_WS_URL` | `ws://127.0.0.1:8081/` for local, or your Railway URL |
| `DISCORD_BOT_TOKEN` | Your Discord bot token |
| `DISCORD_CHANNEL_ID` | Right-click a Discord channel → Copy Channel ID |
| `BRAND_NAME` | Your streamer name |
| `CHANNELS` | Your stream URLs for each platform |

> ⚠️ **Never commit `config.js` to GitHub.** It's already in `.gitignore` but double-check with `git status` before pushing.

---

### Step 4 — Set up your Discord bot

1. Go to [discord.com/developers](https://discord.com/developers/applications)
2. Create a new application → go to the **Bot** tab
3. Click **Reset Token** and copy it into `config.js`
4. Scroll down to **Privileged Gateway Intents** and enable:
   - ✅ **Message Content Intent**
5. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Permissions: `View Channels` + `Read Message History`
6. Open the generated URL and invite the bot to your server

---

### Step 5 — Set up Streamer.bot

1. Open Streamer.bot → **Servers/Clients → WebSocket Server**
2. Make sure it's enabled on port `8080`
3. Connect your Twitch, YouTube, and Kick accounts in Streamer.bot

---

### Step 6 — Run the Discord bridge

In your project folder, run:

```bash
node discord-bridge.js
```

You should see:
```
✅  Config loaded — channel: YOUR_CHANNEL_ID
✅  Bridge WS server listening on ws://127.0.0.1:8081
🔄  Connecting to Discord Gateway…
✅  Discord Gateway connected
🤖  Logged in as YourBot
👂  Watching channel YOUR_CHANNEL_ID
```

Keep this terminal open while streaming.

---

### Step 7 — Add to OBS

1. In OBS, add a new **Browser Source**
2. Check **Local File** and browse to `multichat.html`
3. Set width/height to match your overlay size (e.g. 400×800 for portrait)
4. Done!

---

## Optional — Host the Discord Bridge on Railway

If you don't want to run `node discord-bridge.js` locally every stream, you can host it for free on [Railway](https://railway.app/).

1. Push your repo to GitHub (make sure `config.js` is gitignored!)
2. In Railway → **New Project** → **Deploy from GitHub Repo**
3. Go to your service → **Variables** tab and add:
   ```
   DISCORD_BOT_TOKEN=your-token-here
   DISCORD_CHANNEL_ID=your-channel-id
   ```
4. Go to **Settings → Networking → Generate Domain** on port `8081`
5. Copy the generated URL (e.g. `your-app.up.railway.app`)
6. Update `config.js` on your local machine:
   ```js
   DISCORD_WS_URL: 'wss://your-app.up.railway.app/',
   ```

---

## Controls

| Control | What it does |
|---|---|
| **BG** color swatch | Opens color picker for background color |
| **BG** opacity slider | 0% = fully transparent (for OBS chroma), 100% = solid |
| **Size** slider | Scale the chat text up or down |
| **UI button** (top right) | Hides/shows the header and footer — use this in OBS for clean overlay |
| **Footer icons** | Filter chat by platform (All / Twitch / YouTube / Kick / Abstract / Discord) |

All settings (color, opacity, font size) are **saved automatically** and restored next time you open the page.

---

## File Structure

```
multichat/
├── multichat.html        # The chat overlay (open in OBS)
├── discord-bridge.js     # Local Node.js server that bridges Discord → multichat
├── config.example.js     # Config template — copy to config.js and fill in
├── config.js             # Your personal config (gitignored — never commit!)
├── package.json          # Node dependencies
├── .env.example          # Environment variable template (for Railway hosting)
├── .gitignore
└── README.md
```

---

## Resetting Settings

If you want to go back to defaults, open the browser console on `multichat.html` and run:

```js
localStorage.removeItem('multichat_settings')
```

Then refresh the page.
