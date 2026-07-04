// Smoke tests for YouTube helpers. We don't hit the network here
// (CI doesn't need to), we just verify the pure functions work.
const yt = require('../src/youtube');

describe('parseDuration', () => {
  test('parses mm:ss', () => {
    expect(yt.parseDuration('3:45')).toBe(225);
  });
  test('parses hh:mm:ss', () => {
    expect(yt.parseDuration('1:02:33')).toBe(3753);
  });
  test('returns 0 for empty / garbage', () => {
    expect(yt.parseDuration('')).toBe(0);
    expect(yt.parseDuration('abc')).toBe(0);
    expect(yt.parseDuration(undefined)).toBe(0);
  });
});

describe('search (no network)', () => {
  test('empty query returns empty list', async () => {
    expect(await yt.search('', 5)).toEqual([]);
    expect(await yt.search('   ', 5)).toEqual([]);
  });
});

describe('getInfo URL validation', () => {
  test('rejects a non-YouTube URL', async () => {
    await expect(yt.getInfo('https://example.com/foo')).rejects.toThrow(/YouTube/);
  });
});
