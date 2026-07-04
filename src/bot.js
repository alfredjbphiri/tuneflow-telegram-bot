/**
 * TuneFlow — Telegram music bot.
 *
 *   /start         greeting + quick help
 *   /help          full command list
 *   /search <q>    search YouTube, show up to 5 results
 *   /get <n>       download the n-th result from your last search
 *   /trending      top 5 trending music videos (YouTube trending feed)
 *
 * The bot uses long polling. To run on Render free tier, the HTTP
 * /healthz endpoint is exposed so Render's health check doesn't
 * spin us down.
 */
const TelegramBot = require('node-telegram-bot-api');
const ffmpeg = require('fluent-ffmpeg');
const { Readable, PassThrough } = require('stream');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const config = require('./config');
const yt = require('./youtube');

// --- main bot (polling) ---------------------------------------------------
const bot = new TelegramBot(config.botToken, { polling: config.polling });

// Per-user rate limit (in-memory)
const rateState = new Map(); // userId -> { count, windowStart }
function rateLimited(userId) {
  if (config.maxPerHour <= 0) return false;
  const now = Date.now();
  const s = rateState.get(userId) || { count: 0, windowStart: now };
  if (now - s.windowStart > 3_600_000) { s.count = 0; s.windowStart = now; }
  if (s.count >= config.maxPerHour) return true;
  s.count += 1;
  rateState.set(userId, s);
  return false;
}

function isAllowed(userId) {
  if (config.allowedUsers.length === 0) return true;
  return config.allowedUsers.includes(String(userId));
}

// Per-chat memory of last /search results
const lastResults = new Map(); // chatId -> [{ id, title, ... }]

// --- health server so Render doesn't idle us out -------------------------
if (config.polling) {
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }).listen(port, () => {
    console.log(`✅ Health server listening on :${port}`);
  });
}

// --- helpers -------------------------------------------------------------
function fmtDuration(sec) {
  if (!sec) return '?';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtResultsList(results) {
  return results.map((r, i) =>
    `*${i + 1}.* ${r.title}\n    \u2014 ${r.channel}  ·  ${fmtDuration(r.durationSec)}`,
  ).join('\n\n');
}

async function answerAction(chatId, action = 'typing') {
  try { await bot.sendChatAction(chatId, action); } catch { /* ignore */ }
}

function safeName(s) {
  return s.replace(/[^\w\s.-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'audio';
}

// --- transcode m4a/webm stream to mp3 on the fly -------------------------
function transcodeToMp3(input) {
  const out = new PassThrough();
  const command = ffmpeg(input)
    .noVideo()
    .audioCodec('libmp3lame')
    .audioQuality(0) // 0 = best VBR (~245 kbps)
    .format('mp3')
    .on('error', (err) => {
      // ffmpeg errors are noisy but the output is already flowing; if
      // we abort, downstream sees the error. We let it propagate.
      if (!out.destroyed) out.destroy(err);
    });
  command.pipe(out);
  return out;
}

// --- commands ------------------------------------------------------------

bot.onText(/^\/start\b/, (msg) => {
  const name = msg.from?.first_name || 'there';
  bot.sendMessage(msg.chat.id,
    `👋 Hi ${name}! I'm *TuneFlow*.\n\n` +
    `Search and download songs as MP3 straight from Telegram.\n\n` +
    `Try:\n` +
    `  /search The Weeknd Blinding Lights\n` +
    `  /get 1\n\n` +
    `Type /help for the full command list.`,
    { parse_mode: 'Markdown' },
  );
});

bot.onText(/^\/help\b/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `*TuneFlow — commands*\n\n` +
    `\`/search <query>\` — search YouTube, show up to ${config.searchLimit} results\n` +
    `\`/get <n>\` — download the n-th result from your last search\n` +
    `\`/trending\` — top 5 trending music videos right now\n` +
    `\`/start\` — greeting + quick help\n` +
    `\`/help\` — this message\n\n` +
    `*Limits*\n` +
    `• ${config.maxPerHour === 0 ? 'unlimited' : `${config.maxPerHour} downloads per user per hour`}\n` +
    `• Max audio length: ${Math.round(config.maxDurationSec / 60)} min\n` +
    `• Max file size: ${Math.round(config.maxFileBytes / (1024 * 1024))} MB (Telegram Bot API cap)\n`,
    { parse_mode: 'Markdown' },
  );
});

bot.onText(/^\/search\b(?:\s+(.+))?/, async (msg, match) => {
  if (!isAllowed(msg.from.id)) return bot.sendMessage(msg.chat.id, '🔒 You\'re not allowed to use this bot.');
  const query = (match[1] || '').trim();
  if (!query) return bot.sendMessage(msg.chat.id, '💡 Usage: `/search <song name or artist>`', { parse_mode: 'Markdown' });

  await answerAction(msg.chat.id, 'typing');
  const sent = await bot.sendMessage(msg.chat.id, `🔎 Searching for *${query}*…`, { parse_mode: 'Markdown' });

  try {
    const results = await yt.search(query, config.searchLimit);
    if (results.length === 0) {
      return bot.editMessageText('❌ No results found.', {
        chat_id: msg.chat.id, message_id: sent.message_id,
      });
    }
    lastResults.set(msg.chat.id, results);
    const text = `Found *${results.length}* result(s) for *${query}*:\n\n${fmtResultsList(results)}\n\n` +
      `Reply with \`/get <n>\` to download one.`;
    bot.editMessageText(text, {
      chat_id: msg.chat.id, message_id: sent.message_id,
      parse_mode: 'Markdown',
    });
  } catch (err) {
    console.error(`search error: ${err.message}`);
    bot.editMessageText('⚠️ Search failed. Try again in a moment.', {
      chat_id: msg.chat.id, message_id: sent.message_id,
    });
  }
});

bot.onText(/^\/get\b(?:\s+(\d+))?/, async (msg, match) => {
  if (!isAllowed(msg.from.id)) return bot.sendMessage(msg.chat.id, '🔒 You\'re not allowed to use this bot.');
  if (rateLimited(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, `⏳ Slow down — ${config.maxPerHour} per hour max. Try again later.`);
  }
  const idx = parseInt(match[1] || '0', 10) - 1;
  const list = lastResults.get(msg.chat.id) || [];
  if (idx < 0 || idx >= list.length) {
    return bot.sendMessage(msg.chat.id, '💡 Run `/search <query>` first, then `/get <n>`.', { parse_mode: 'Markdown' });
  }
  const item = list[idx];
  await sendSong(msg.chat.id, item);
});

bot.onText(/^\/trending\b/, async (msg) => {
  if (!isAllowed(msg.from.id)) return;
  await answerAction(msg.chat.id, 'typing');
  const sent = await bot.sendMessage(msg.chat.id, '🔥 Fetching trending music…');
  try {
    // YouTube Music /charts has a raw JSON endpoint that lists top music videos
    const url = 'https://www.youtube.com/feed/trending?bp=4gINGgt5dG1hX2NoYXJ0cw%3D%3D';
    const html = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' },
    }).then((r) => r.text());
    const re = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{6,})"[^}]*?"title":\{"runs":\[\{"text":"([^"]+)"\}\][^}]*?"ownerText":\{"runs":\[\{"text":"([^"]+)"\}\][^}]*?"lengthText":\{"accessibility":\{"accessibilityData":\{"label":"([^"]+)"\}\},"simpleText":"([^"]*)"\}/g;
    const out = [];
    let m;
    while ((m = re.exec(html)) && out.length < 5) {
      const [, id, title, channel, , lengthSimple] = m;
      out.push({
        id, title, channel,
        durationSec: yt.parseDuration(lengthSimple),
        url: `https://www.youtube.com/watch?v=${id}`,
      });
    }
    if (out.length === 0) {
      return bot.editMessageText('❌ No trending data right now.', {
        chat_id: msg.chat.id, message_id: sent.message_id,
      });
    }
    lastResults.set(msg.chat.id, out);
    bot.editMessageText(`🔥 *Top ${out.length} trending music videos*\n\n${fmtResultsList(out)}\n\n` +
      `Reply with \`/get <n>\` to download one.`, {
      chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'Markdown',
    });
  } catch (err) {
    bot.editMessageText('⚠️ Trending fetch failed.', {
      chat_id: msg.chat.id, message_id: sent.message_id,
    });
  }
});

// --- the actual download + send ------------------------------------------
async function sendSong(chatId, item) {
  let status;
  try {
    if (item.durationSec > config.maxDurationSec) {
      return bot.sendMessage(chatId,
        `⏳ That track is ${fmtDuration(item.durationSec)} long, which is over the ${Math.round(config.maxDurationSec / 60)}-min cap. ` +
        `Try another result.`,
      );
    }
    status = await bot.sendMessage(chatId, `⬇️ Fetching *${item.title}*…`, { parse_mode: 'Markdown' });
    await answerAction(chatId, 'upload_voice');

    const { stream, contentLength } = await yt.openAudioStream(item.url);
    if (contentLength && contentLength > config.maxFileBytes) {
      stream.destroy();
      return bot.editMessageText(
        `⚠️ File is ${(contentLength / (1024 * 1024)).toFixed(1)} MB \u2014 over the ${(config.maxFileBytes / (1024 * 1024)).toFixed(0)} MB cap.`,
        { chat_id: chatId, message_id: status.message_id },
      );
    }

    const mp3Stream = transcodeToMp3(stream);

    const tmpPath = path.join(os.tmpdir(), `${safeName(item.title)}.mp3`);
    const out = fs.createWriteStream(tmpPath);
    mp3Stream.pipe(out);
    await new Promise((resolve, reject) => { out.once('finish', resolve); out.once('error', reject); });
    const stats = fs.statSync(tmpPath);

    if (stats.size > config.maxFileBytes) {
      fs.unlink(tmpPath, () => {});
      return bot.editMessageText(
        `⚠️ Encoded MP3 is ${(stats.size / (1024 * 1024)).toFixed(1)} MB \u2014 over the cap.`,
        { chat_id: chatId, message_id: status.message_id },
      );
    }

    await bot.editMessageText(`🎧 Sending *${item.title}*…`, {
      chat_id: chatId, message_id: status.message_id, parse_mode: 'Markdown',
    });

    await bot.sendAudio(chatId, tmpPath, {
      title: item.title,
      performer: item.channel,
      duration: item.durationSec,
    });

    fs.unlink(tmpPath, () => {}); // best-effort cleanup
    bot.deleteMessage(chatId, status.message_id).catch(() => {});
  } catch (err) {
    console.error(`sendSong error: ${err.message}`);
    if (status?.message_id) {
      bot.editMessageText(`⚠️ Download failed: ${err.message.slice(0, 200)}`, {
        chat_id: chatId, message_id: status.message_id,
      }).catch(() => {});
    } else {
      bot.sendMessage(chatId, `⚠️ Download failed: ${err.message.slice(0, 200)}`);
    }
  }
}

// --- allow direct YouTube URLs via /play ---------------------------------
bot.onText(/^\/play\b\s+(https?:\/\/\S+)/, async (msg, match) => {
  if (!isAllowed(msg.from.id)) return;
  if (rateLimited(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, `⏳ Slow down — ${config.maxPerHour} per hour max.`);
  }
  const url = match[1].trim();
  try {
    const info = await yt.getInfo(url);
    lastResults.set(msg.chat.id, [info]);
    await sendSong(msg.chat.id, info);
  } catch (err) {
    bot.sendMessage(msg.chat.id, `⚠️ ${err.message}`);
  }
});

// --- startup -------------------------------------------------------------
bot.on('polling_error', (err) => console.error(`polling error: ${err.message}`));
console.log('🎵 TuneFlow is online.');
