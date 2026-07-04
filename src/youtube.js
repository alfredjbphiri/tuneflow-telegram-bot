/**
 * YouTube search + audio download.
 *
 * We use @distube/ytdl-core (an actively-maintained fork of ytdl-core
 * that actually works in 2026). For search we hit the YouTube
 * `search` endpoint via ytdl-core's helper.
 *
 * The download path returns a Promise<{ stream, meta }>. The stream
 * is a raw `audioonly` m4a/webm stream that the caller pipes through
 * ffmpeg to remux to MP3.
 */
const ytdl = require('@distube/ytdl-core');
const { Readable } = require('stream');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/**
 * Search YouTube and return an array of up to `limit` results.
 * Each: { id, title, channel, durationSec, url, thumbnail }
 */
async function search(query, limit = 5) {
  if (!query || !query.trim()) return [];
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`;
  const html = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html',
    },
  }).then((r) => r.text());

  // YouTube embeds results as JSON inside a JS variable. We pull the
  // first batch of `videoRenderer` objects.
  const out = [];
  const re = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{6,})"[^}]*?"title":\{"runs":\[\{"text":"([^"]+)"\}\][^}]*?"ownerText":\{"runs":\[\{"text":"([^"]+)"\}\][^}]*?"lengthText":\{"accessibility":\{"accessibilityData":\{"label":"([^"]+)"\}\},"simpleText":"([^"]*)"\}/g;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    const [, id, title, channel, , lengthSimple] = m;
    out.push({
      id, title, channel,
      durationSec: parseDuration(lengthSimple),
      url: `https://www.youtube.com/watch?v=${id}`,
    });
  }
  // Dedupe by id
  const seen = new Set();
  return out.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

function parseDuration(s) {
  // Accepts "3:45" or "1:02:33"
  if (!s) return 0;
  const parts = s.split(':').map((x) => parseInt(x, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/**
 * Validate the URL and fetch metadata. Throws on failure.
 */
async function getInfo(url) {
  if (!ytdl.validateURL(url)) {
    throw new Error('That doesn\'t look like a YouTube URL.');
  }
  const info = await ytdl.getInfo(url, { requestOptions: { headers: { 'User-Agent': UA } } });
  const d = info.videoDetails;
  return {
    id: d.videoId,
    title: d.title,
    channel: d.author?.name || '',
    durationSec: parseInt(d.lengthSeconds, 10) || 0,
    url,
    thumbnail: d.thumbnails?.[0]?.url || '',
  };
}

/**
 * Open an audio-only stream and resolve its size in bytes.
 * Uses 'highestaudio' with a hard preference for m4a/aac.
 */
function openAudioStream(url) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const stream = ytdl(url, {
      requestOptions: { headers: { 'User-Agent': UA } },
      quality: 'highestaudio',
      filter: 'audioonly',
      highWaterMark: 1 << 25, // 32 MiB
    });
    stream.once('response', (res) => {
      resolved = true;
      const len = parseInt(res.headers['content-length'] || '0', 10);
      resolve({ stream, contentLength: len, contentType: res.headers['content-type'] || '' });
    });
    stream.once('error', (err) => {
      if (!resolved) reject(err);
    });
  });
}

module.exports = { search, getInfo, openAudioStream, parseDuration };
