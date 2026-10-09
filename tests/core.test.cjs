const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");

test("settings are bounded and default to five seconds", () => {
  assert.equal(C.seconds(undefined), 5);
  assert.equal(C.seconds("bad"), 5);
  assert.equal(C.seconds(-2), 1);
  assert.equal(C.seconds(30), 12);
});
test("companion uses a normal watch URL without duplicating the queue", () => {
  assert.equal(C.companionUrl("https://music.youtube.com/watch?v=abcdef12345&list=myqueue&t=99"),
    "https://music.youtube.com/watch?v=abcdef12345#crossfader-companion");
  assert.throws(() => C.companionUrl("https://evil.example/watch?v=abcdef12345"));
  assert.throws(() => C.companionUrl("https://music.youtube.com/"));
});
test("ads, short tracks, pause, seek, mute, speed changes and live streams are excluded", () => {
  const video = { paused: false, ended: false, seeking: false, muted: false,
    volume: .7, readyState: 4, playbackRate: 1, duration: 180, currentTime: 174 };
  assert.ok(C.eligible(video, 5, false));
  assert.ok(!C.eligible(video, 5, true));
  for (const [key, value] of Object.entries({ paused: true, ended: true, seeking: true,
    muted: true, volume: 0, readyState: 2, playbackRate: 2, duration: Infinity, currentTime: 0 })) {
    assert.ok(!C.eligible({ ...video, [key]: value }, 5, false), key);
  }
  assert.ok(!C.eligible({ ...video, duration: 10 }, 5, false));
});
test("fade contains simultaneous nonzero gains, with bounded endpoints", () => {
  assert.deepEqual(C.gains(-1), { outgoing: 1, incoming: 0 });
  assert.deepEqual(C.gains(.5), { outgoing: .5, incoming: .5 });
  assert.deepEqual(C.gains(2), { outgoing: 0, incoming: 1 });
});
test("all YouTube Music views can enable, while foreign origins cannot", () => {
  assert.ok(C.isMusicUrl("https://music.youtube.com/playlist?list=album"));
  assert.ok(C.isMusicUrl("https://music.youtube.com/"));
  assert.ok(!C.isMusicUrl("https://music.youtube.com.evil.example/"));
  assert.ok(!C.isMusicUrl(undefined));
});
test("player identity overrides unrelated navigation, and an empty player never falls back to a stale URL", () => {
  const document = value => ({ documentElement: { getAttribute: () => value } });
  assert.equal(C.currentTrackId(document("nXTYL2Rhieg"), "https://music.youtube.com/playlist?list=album"), "nXTYL2Rhieg");
  assert.equal(C.currentTrackId(document("nXTYL2Rhieg"), "https://music.youtube.com/watch?v=stalesong123"), "nXTYL2Rhieg");
  assert.equal(C.currentTrackId(document(""), "https://music.youtube.com/watch?v=stalesong123"), null);
  assert.equal(C.currentTrackId(document(null), "https://music.youtube.com/watch?v=outgoing123"), "outgoing123");
  assert.throws(() => C.companionUrlFromId("https://evil.example/"));
});
test("song timing uses the logical clock and a stable duration, retaining the native seek offset", () => {
  const attributes = { "data-crossfader-time": "65.15", "data-crossfader-duration": "228", "data-crossfader-live": "false" };
  const document = { documentElement: { getAttribute: name => attributes[name] ?? null } };
  const actual = C.mediaTiming(document, { currentTime: 372.51, duration: 477.1 });
  assert.equal(actual.currentTime, 65.15);
  assert.equal(actual.duration, 228);
  assert.ok(Math.abs(actual.offset - 307.36) < .001);
  attributes["data-crossfader-live"] = "true";
  assert.equal(C.mediaTiming(document, {}).duration, Infinity);
});
