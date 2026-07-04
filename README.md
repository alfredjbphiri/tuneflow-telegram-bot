# 🎵 TuneFlow

> A Telegram bot that lets users search and download songs as MP3s from YouTube. Minimal: just `/search` + `/get`. Built for Render free tier.

TuneFlow is added to a Telegram chat, the user types `/search <song>`, the bot replies with the top 5 results, the user replies `/get 1`, and the bot delivers the song as an MP3 audio file (Telegram's native audio player shows it with cover art and a title).

---

## 🚀 Deploy to Render (one click, free tier)

The fastest way to get a free, always-on TuneFlow is Render's free web service. Click the button, paste your bot token, done.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/alfredjbphiri/tuneflow-telegram-bot)

After clicking the button:

1. **Sign in to Render** (free account is fine).
2. Render will read the `render.yaml` and pre-fill the service config. Hit **Apply**.
3. While it builds, open the new `tuneflow` service → **Environment** and set:
   - `BOT_TOKEN` — your Telegram bot token from [@BotFather](https://t.me/BotFather)
   - `ALLOWED_USERS` (optional) — comma-separated Telegram user IDs to whitelist
4. Wait for the first deploy to finish (~2 min, the image already has `ffmpeg` baked in).
5. Open your bot in Telegram, send `/start`. If it replies, you're done.

### What you get for free
- ✅ 24/7 uptime (with a 30–60s cold start after 15 min of no HTTP traffic — fine for a music bot)
- ✅ Auto-deploy on every push to `main`
- ✅ `/healthz` health check so Render doesn't kill the worker
- ✅ Free TLS, no credit card required

### What you don't get
- ⚠️ No always-on (free plan spins down after 15 min idle). Cold start ≈ 30–60s.
- ⚠️ 512 MB RAM cap. ffmpeg is fine, but if you ever add heavy features, upgrade to Render Starter ($7/mo).

### Local dev (no Render)

```bash
git clone https://github.com/alfredjbphiri/tuneflow-telegram-bot.git
cd tuneflow-telegram-bot
npm install
cp .env.example .env   # then fill BOT_TOKEN
npm start
```

You'll need `ffmpeg` installed locally (`apt install ffmpeg` / `brew install ffmpeg`).

### Talk to the bot

1. Open Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`. Pick a name and a username, paste the token into your `.env` (or the Render environment).
2. Open your new bot in Telegram, hit **Start**.
3. Try:
   ```
   /search The Weeknd Blinding Lights
   /get 1
   ```

---

## ✨ Features

- 🔎 **YouTube search** via `/search <query>` — returns the top 5 results with title, channel, and duration
- ⬇️ **MP3 download** via `/get <n>` — picks the n-th result from your last search and sends it as a Telegram audio file (native player, cover art, title, duration)
- 🔥 **Trending** via `/trending` — top 5 trending music videos right now, then `/get <n>` to download
- 🔗 **Direct URL** via `/play <youtube-url>` — paste a link and the bot will download it
- ⏱️ **Per-user rate limit** — `MAX_PER_HOUR` (default 10) to prevent abuse
- 📏 **Size & duration guards** — files over 45 MB or tracks over 10 min are rejected with a friendly message
- 🔒 **Optional allowlist** — set `ALLOWED_USERS` to a comma-separated list of Telegram user IDs to restrict who can use the bot
- 🩺 **Health endpoint** at `/healthz` so Render's health check doesn't idle us out
- 🐳 **Dockerfile + render.yaml** — one-click deploy, no configuration beyond the bot token

---

## 🤖 Commands

| Command | What |
|---|---|
| `/start` | Greeting + quick help |
| `/help` | Full command list + limits |
| `/search <query>` | Search YouTube, show top 5 results |
| `/get <n>` | Download the n-th result from your last search |
| `/trending` | Top 5 trending music videos right now |
| `/play <youtube-url>` | Download a specific YouTube URL directly |

### Example session

```
> /search Daft Punk Around the World

🔎 Searching for "Daft Punk Around the World"…

Found 5 result(s) for "Daft Punk Around the World":

1. Around the World (Official Video) - Daft Punk
    — Daft Punk  ·  7:10

2. Around the World (Radio Edit) - Daft Punk
    — Daft Punk  ·  4:02

3. Daft Punk - Around the World (Live)
    — Live Music  ·  9:15

…

Reply with /get <n> to download one.

> /get 1

⬇️ Fetching "Around the World (Official Video) - Daft Punk"…

🎧 Sending "Around the World (Official Video) - Daft Punk"…

[Telegram audio file with cover art, title, channel, duration]
```

---

## 🏗️ Architecture

```
src/
├── bot.js          # Telegram bot (long polling) + command handlers
├── youtube.js      # YouTube search + audio stream resolver
└── config.js       # .env loader with required-var check on startup
Dockerfile          # node:20-bookworm-slim + ffmpeg baked in
render.yaml         # One-click deploy config (free plan)
.env.example        # All env vars documented
__tests__/
└── youtube.test.js # Smoke tests for parseDuration + URL validation
```

The flow:
1. `/search` hits the YouTube search HTML page (no API key needed), scrapes the first 5 `videoRenderer` blobs, returns them as a list.
2. `/get` opens an `audioonly` m4a stream via `@distube/ytdl-core`, pipes it through `ffmpeg` (libmp3lame, VBR ~245 kbps) into a temp file.
3. Bot calls `sendAudio()` with the temp file — Telegram renders it as a proper audio file with cover art + duration.
4. Temp file is deleted after the upload.

---

## ⚙️ Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `BOT_TOKEN` | _required_ | Telegram bot token from @BotFather |
| `ALLOWED_USERS` | _empty_ | Comma-separated Telegram user IDs. Empty = allow everyone |
| `MAX_PER_HOUR` | `10` | Per-user download rate limit. `0` = unlimited |
| `SEARCH_LIMIT` | `5` | Max results per `/search` reply |
| `MAX_FILE_BYTES` | `47185920` | Max file size we'll send (Telegram cap is 50 MB) |
| `MAX_DURATION_SEC` | `600` | Max track length (10 min) |
| `POLLING` | `true` | `true` = long polling, `false` = webhook |
| `PORT` | `3000` | HTTP port for the `/healthz` endpoint |

---

## ⚠️ Legal note

This bot downloads audio from YouTube. That audio is subject to YouTube's Terms of Service and copyright law. The bot is provided for personal/educational use — the kind of thing you do to grab a song you already have access to, just in MP3 form. Don't use it to redistribute copyrighted music at scale, and don't blame me if YouTube changes their bot-detection and ytdl breaks.

## 🛣️ Roadmap

- [x] YouTube search (`/search`)
- [x] MP3 download (`/get <n>`)
- [x] Direct URL (`/play <url>`)
- [x] Trending (`/trending`)
- [x] Per-user rate limit
- [x] Size & duration guards
- [x] Optional user allowlist
- [x] `/healthz` for Render
- [x] One-click Render deploy
- [ ] Inline mode — type `@tuneflow_bot song` in any chat
- [ ] Per-user download history (`/history`)
- [ ] Playlists (`/playlist add <query>`)
- [ ] Album art always shown (Telegram picks the right thumbnail from the audio file metadata)

---

## 📄 License

MIT
