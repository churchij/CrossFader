const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
test("MAIN-world bridge publishes only a validated current ID, refreshes on request, and clears loading state", () => {
  const attributes = new Map(), listeners = {};
  let song = "nXTYL2Rhieg", interval;
  const sandbox = {
    document: {
      documentElement: { getAttribute: key => attributes.get(key) ?? null,
        setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) },
      getElementById: () => ({ getVideoData: () => ({ video_id: song, ignoredSecret: "never-published" }),
        getPlayerResponse: () => ({ videoDetails: { videoId: song, lengthSeconds: "228" } }),
        getCurrentTime: () => 65.15 }),
      addEventListener: (key, fn) => { listeners[key] = fn; }
    },
    setInterval: fn => { interval = fn; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../player-state.js"), "utf8"), sandbox);
  assert.equal(attributes.get("data-crossfader-video-id"), song);
  assert.equal(attributes.size, 4);
  assert.equal(attributes.get("data-crossfader-time"), "65.15");
  assert.equal(attributes.get("data-crossfader-duration"), "228");
  assert.ok(![...attributes.values()].includes("never-published"));
  song = "Anm9OH8Kbdc";
  listeners["crossfader-read-player"]();
  assert.equal(attributes.get("data-crossfader-video-id"), song);
  song = undefined;
  interval();
  assert.equal(attributes.get("data-crossfader-video-id"), "");
  song = "https://evil.example/";
  interval();
  assert.equal(attributes.get("data-crossfader-video-id"), "");
});
