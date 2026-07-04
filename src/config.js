/**
 * Tiny env loader. Reads `.env` and exports a frozen config object.
 * Throws on startup if anything required is missing.
 */
require('dotenv').config();

function need(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var: ${name}. See .env.example.`);
  }
  return v.trim();
}

function optInt(name, def) {
  const v = process.env[name];
  if (!v) return def;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be an integer, got: ${v}`);
  return n;
}

function optBool(name, def) {
  const v = process.env[name];
  if (v == null) return def;
  return /^(1|true|yes|on)$/i.test(v);
}

module.exports = Object.freeze({
  botToken:  need('BOT_TOKEN'),
  // Per-user rate limit (searches per hour). 0 = unlimited.
  maxPerHour: optInt('MAX_PER_HOUR', 10),
  // Max results per /search reply
  searchLimit: optInt('SEARCH_LIMIT', 5),
  // Max audio file size we'll send to Telegram in bytes.
  // Telegram Bot API limit is 50 MB for downloads. Stay safely under.
  maxFileBytes: optInt('MAX_FILE_BYTES', 45 * 1024 * 1024),
  // Hard cap on search duration in seconds (skip live streams, super long mixes).
  maxDurationSec: optInt('MAX_DURATION_SEC', 600),
  // Use polling (true) or webhook (false). Polling is the simplest for Render free.
  polling: optBool('POLLING', true),
  // Whitelist of user IDs allowed to use the bot. Empty = allow everyone.
  allowedUsers: (process.env.ALLOWED_USERS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
});
