// Integration harness executes the real content scripts in two isolated page contexts.
// Synthetic clocks and media do not validate YouTube's selectors, policies, or audio output.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const core = fs.readFileSync(path.join(__dirname, "../core.js"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");

function harness({ blocked = false, delayed = false, ad = false, playlist = false, reusedTimeline = false, seekDelay = 0, responseDelay = 0 } = {}) {
  let clock = 0, nextTimer = 0, muted = true, clicks = 0;
  const timers = new Map(), statuses = [], overlap = [];
  function schedule(fn, ms, repeat) {
    const timer = ++nextTimer;
    timers.set(timer, { fn, at: clock + ms, repeat });
    return timer;
  }
  function video(start) {
    let position = start, at = clock, paused = true;
    return {
      volume: .7, muted: false, ended: false, seeking: false, readyState: 4,
      duration: 30, playbackRate: 1,
      get currentTime() { return Math.min(this.duration, position + (paused ? 0 : (clock - at) / 1000)); },
      set currentTime(value) {
        position = value; at = clock;
        if (this.sidecar && seekDelay) {
          this.seeking = true;
          schedule(() => { this.seeking = false; }, seekDelay, 0);
        }
      },
      get paused() { return paused || this.currentTime >= this.duration; },
      pause() { position = this.currentTime; at = clock; paused = true; },
      play() {
        if (this.sidecar && blocked) return Promise.reject(new Error("NotAllowedError"));
        at = clock; paused = false; return Promise.resolve();
      }
    };
  }
  const primaryVideo = video(25.4), sideVideo = video(0);
  let primaryOffset = reusedTimeline ? 500 : 0;
  const sideOffset = reusedTimeline ? 100 : 0;
  let songDuration = 30;
  if (reusedTimeline) {
    primaryVideo.currentTime = primaryOffset + 25.4;
    primaryVideo.duration = 1000;
    sideVideo.currentTime = sideOffset;
    sideVideo.duration = 500;
  }
  primaryVideo.play(); sideVideo.sidecar = true;
  const mainLocation = { href: "https://music.youtube.com/watch?v=outgoing123", hash: "" };
  if (playlist) mainLocation.href = "https://music.youtube.com/playlist?list=album123";
  const sideLocation = { href: "https://music.youtube.com/watch?v=outgoing123#crossfader-companion", hash: "#crossfader-companion" };
  const listeners = {};
  let activeSong = "outgoing123";
  async function command(role, message) {
    return new Promise(resolve => listeners[role](message, { id: "test" }, resolve));
  }
  function context(role, element, location) {
    const doc = {
      addEventListener() {},
      dispatchEvent() {},
      documentElement: { getAttribute: name => {
        if (name === "data-crossfader-video-id") return role === "primary" ? activeSong : "outgoing123";
        if (!reusedTimeline) return null;
        if (name === "data-crossfader-time") return String(element.currentTime - (role === "primary" ? primaryOffset : sideOffset));
        if (name === "data-crossfader-duration") return String(role === "primary" ? songDuration : 30);
        if (name === "data-crossfader-live") return "false";
        return null;
      } },
      querySelector(selector) {
        if (selector.includes("ad-showing")) return ad ? {} : null;
        if (selector.includes(".next-button")) return role === "primary" ? {
          disabled: false, getAttribute: () => null,
          click() {
            clicks++;
            activeSong = "incoming123";
            if (!playlist) mainLocation.href = "https://music.youtube.com/watch?v=incoming123";
            songDuration = 90;
            if (reusedTimeline) {
              primaryOffset = primaryVideo.currentTime;
              primaryVideo.duration = 1200;
            } else {
              primaryVideo.duration = 90; // Deliberately differs from the outgoing duration.
              primaryVideo.currentTime = 0;
            }
            if (delayed) { primaryVideo.pause(); primaryVideo.readyState = 1; }
          }
        } : null;
        if (selector.includes("repeat")) return null;
        return element;
      }
    };
    const sandbox = {
      document: doc, location, URL, console, Event: class { constructor(type) { this.type = type; } },
      Date: { now: () => clock },
      setTimeout: (fn, ms) => schedule(fn, ms, 0),
      setInterval: (fn, ms) => schedule(fn, ms, ms),
      clearInterval: timer => timers.delete(timer),
      MutationObserver: class { observe() {} },
      window: { addEventListener() {} },
      chrome: { storage: { onChanged: { addListener() {} } }, runtime: { id: "test", onMessage: { addListener: fn => { listeners[role] = fn; } },
        async sendMessage(message) {
          let value;
          try {
            switch (message.type) {
              case "hello": value = { role, seconds: 5 }; break;
              case "status": statuses.push(message.text); break;
              case "loadCompanion": muted = true; break;
              case "audible": muted = !message.value; break;
              case "companion": {
                const result = await command("companion", message);
                if (message.command === "start" && responseDelay) {
                  await new Promise(resolve => schedule(resolve, responseDelay, 0));
                }
                return result;
              }
              default: throw new Error("Unexpected request " + message.type);
            }
            return { ok: true, value };
          } catch (error) { return { ok: false, error: error.message }; }
        }
      } }
    };
    vm.createContext(sandbox);
    vm.runInContext(core, sandbox);
    vm.runInContext(script, sandbox);
  }
  context("companion", sideVideo, sideLocation);
  context("primary", primaryVideo, mainLocation);
  async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
  async function advance(ms) {
    const end = clock + ms;
    await flush();
    while (true) {
      const events = [...timers].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at);
      if (!events.length) break;
      const [key, task] = events[0];
      clock = task.at;
      if (task.repeat) task.at += task.repeat; else timers.delete(key);
      task.fn();
      await flush();
      if (activeSong === "incoming123" && !primaryVideo.paused && !sideVideo.paused &&
        primaryVideo.volume > 0 && sideVideo.volume > 0 && !muted) {
        overlap.push({ clock, incoming: primaryVideo.volume, outgoing: sideVideo.volume });
      }
    }
    clock = end;
    await flush();
  }
  return { advance, command, primaryVideo, sideVideo, statuses, overlap, mainLocation,
    get clicks() { return clicks; }, get muted() { return muted; } };
}

test("real scripts overlap distinct tracks and restore volume after the outgoing tail ends", async () => {
  const h = harness();
  await h.advance(8000);
  assert.equal(h.clicks, 1);
  assert.ok(h.overlap.length > 10, "Both distinct players must be playing with nonzero gain");
  assert.equal(h.primaryVideo.volume, .7);
  assert.ok(h.sideVideo.paused);
  assert.ok(h.muted);
  assert.ok(h.statuses.some(text => text.startsWith("Ready")));
});
test("blocked companion never advances the original queue or changes its volume", async () => {
  const h = harness({ blocked: true });
  await h.advance(4000);
  assert.equal(h.clicks, 0);
  assert.equal(h.primaryVideo.volume, .7);
  assert.ok(h.muted);
  assert.ok(h.statuses.some(text => text.includes("blocked")));
});
test("disable during overlap stops the companion and restores the main volume", async () => {
  const h = harness();
  await h.advance(1200);
  assert.ok(h.overlap.length > 0);
  await h.command("primary", { command: "disable" });
  await h.advance(300);
  assert.equal(h.primaryVideo.volume, .7);
  assert.ok(h.muted);
  assert.ok(h.sideVideo.paused);
  await h.advance(3000);
  assert.equal(h.primaryVideo.volume, .7);
});
test("pause during overlap is preserved and silences outgoing audio", async () => {
  const h = harness();
  await h.advance(1200);
  h.primaryVideo.pause();
  await h.advance(300);
  assert.ok(h.primaryVideo.paused);
  assert.ok(h.sideVideo.paused);
  assert.ok(h.muted);
  assert.equal(h.primaryVideo.volume, .7);
});
test("a stalled incoming song times out, restores volume, and stops the companion", async () => {
  const h = harness({ delayed: true });
  await h.advance(8000);
  assert.equal(h.clicks, 1);
  assert.ok(h.sideVideo.paused);
  assert.ok(h.muted);
  assert.equal(h.primaryVideo.volume, .7);
  assert.equal(h.overlap.length, 0);
});
test("ad detection leaves ordinary playback untouched", async () => {
  const h = harness({ ad: true });
  await h.advance(1000);
  assert.equal(h.clicks, 0);
  assert.equal(h.primaryVideo.volume, .7);
});
test("playlist playback overlaps and detects the next song while the page URL stays unchanged", async () => {
  const h = harness({ playlist: true });
  const url = h.mainLocation.href;
  await h.advance(8000);
  assert.equal(h.clicks, 1);
  assert.equal(h.mainLocation.href, url);
  assert.ok(h.overlap.length > 10);
  assert.equal(h.primaryVideo.volume, .7);
  assert.ok(h.muted);
});
test("player state reports the active song from a playlist page", async () => {
  const h = harness({ playlist: true });
  const response = await h.command("primary", { command: "playerState" });
  assert.ok(response.ok);
  assert.equal(response.value.id, "outgoing123");
  assert.equal(response.value.duration, 30);
});
test("real scripts overlap when native media clocks and durations span multiple songs", async () => {
  const h = harness({ playlist: true, reusedTimeline: true });
  await h.advance(8000);
  assert.equal(h.clicks, 1);
  assert.ok(h.primaryVideo.currentTime > 500);
  assert.ok(h.overlap.length > 10);
  assert.equal(h.primaryVideo.volume, .7);
  assert.ok(h.muted);
});

test("slow companion seeks recover synchronization before advancing the queue", async () => {
  const h = harness({ seekDelay: 700 });
  await h.advance(9000);
  assert.equal(h.clicks, 1);
  assert.ok(h.overlap.length > 10);
  assert.equal(h.primaryVideo.volume, .7);
  assert.ok(h.sideVideo.paused);
  assert.ok(h.muted);
});

test("delayed start responses do not compare a stale companion clock with the live source", async () => {
  const h = harness({ responseDelay: 650 });
  await h.advance(9000);
  assert.equal(h.clicks, 1);
  assert.ok(h.overlap.length > 10);
  assert.equal(h.primaryVideo.volume, .7);
  assert.ok(h.muted);
});

test("seeks that consume the remaining tail never advance the queue or leave audio changed", async () => {
  const h = harness({ seekDelay: 1400 });
  await h.advance(9000);
  assert.equal(h.clicks, 0);
  assert.equal(h.overlap.length, 0);
  assert.equal(h.primaryVideo.volume, .7);
  assert.ok(h.sideVideo.paused);
  assert.ok(h.muted);
  assert.ok(h.statuses.some(text => text.startsWith("Crossfade skipped:")));
});
