const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function harness(existing = {}) {
  const local = existing.local || {}, session = existing.session || {}, actions = [];
  const tabs = existing.tabs || new Map([[1, { id: 1, windowId: 1, url: existing.pageUrl || "https://music.youtube.com/watch?v=outgoing123" }]]);
  const playerId = "playerId" in existing ? existing.playerId : "outgoing123";
  const url = name => "chrome-extension://test/" + name;
  let receive, removed, updated;
  function storage(data) {
    return {
      async get(key) {
        if (typeof key === "string") return { [key]: data[key] };
        return { ...key, ...data };
      },
      async set(value) { Object.assign(data, value); },
      async remove(key) { delete data[key]; }
    };
  }
  const sandbox = {
    URL, console,
    chrome: {
      storage: { local: storage(local), session: storage(session) },
      runtime: { getURL: url, onMessage: { addListener(fn) { receive = fn; } } },
      tabs: {
        async get(id) { if (!tabs.has(id)) throw new Error("Tab closed"); return tabs.get(id); },
        async create(options) { tabs.set(2, { id: 2, ...options }); actions.push(["create", options]); return tabs.get(2); },
        async update(id, options) {
          if (!tabs.has(id)) throw new Error("Tab closed");
          actions.push(["update", id, options]); Object.assign(tabs.get(id), options); return tabs.get(id);
        },
        async remove(id) { actions.push(["remove", id]); tabs.delete(id); },
        async sendMessage(id, message) {
          actions.push(["message", id, message]);
          if (message.command === "playerState") {
            if (existing.disconnected) throw new Error("Could not establish connection");
            return { ok: true, value: { id: playerId, duration: 266 } };
          }
          return { ok: true, value: {} };
        },
        onRemoved: { addListener(fn) { removed = fn; } },
        onUpdated: { addListener(fn) { updated = fn; } }
      }
    },
    importScripts() { vm.runInContext(fs.readFileSync(path.join(__dirname, "../core.js"), "utf8"), sandbox); }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../background.js"), "utf8"), sandbox);
  const popup = { url: url("popup.html") };
  const request = (message, sender = popup) => new Promise(resolve => receive(message, sender, resolve));
  return { request, actions, session, local, removed, updated, tabs };
}
test("enable registers a muted companion before navigation and does not duplicate on repeated enable", async () => {
  const h = harness();
  assert.ok((await h.request({ type: "enable", tabId: 1 })).ok);
  assert.equal(h.session.session.primary, 1);
  assert.equal(h.session.session.seconds, 5);
  assert.equal(h.actions.find(a => a[0] === "create")[1].url, "chrome-extension://test/companion.html");
  const navigation = h.actions.find(a => a[0] === "update" && a[2].url);
  assert.ok(navigation[2].muted);
  assert.ok(navigation[2].url.includes("crossfader-companion"));
  await h.request({ type: "enable", tabId: 1 });
  assert.equal(h.actions.filter(a => a[0] === "create").length, 1);
});
test("enable on a playlist uses the current player identity, not the page URL", async () => {
  const h = harness({ pageUrl: "https://music.youtube.com/playlist?list=album123", playerId: "nXTYL2Rhieg" });
  assert.ok((await h.request({ type: "enable", tabId: 1 })).ok);
  const navigation = h.actions.find(a => a[0] === "update" && a[2].url);
  assert.equal(navigation[2].url, "https://music.youtube.com/watch?v=nXTYL2Rhieg#crossfader-companion");
});
test("missing playback and stale injection fail clearly without creating a companion", async () => {
  for (const options of [{ playerId: null }, { disconnected: true }]) {
    const h = harness(options);
    const response = await h.request({ type: "enable", tabId: 1 });
    assert.equal(response.ok, false);
    assert.match(response.error, /Start a song|Refresh YouTube Music/);
    assert.equal(h.actions.filter(a => a[0] === "create").length, 0);
  }
});
test("on-page controls act on their sender tab, and unrelated pages cannot enable", async () => {
  const h = harness({ pageUrl: "https://music.youtube.com/playlist?list=album123" });
  const musicSender = { tab: { id: 1 }, url: "https://music.youtube.com/playlist?list=album123" };
  assert.ok((await h.request({ type: "enableHere", tabId: 999 }, musicSender)).ok);
  assert.equal(h.session.session.primary, 1);
  assert.equal((await h.request({ type: "disableHere" }, { tab: { id: 9 }, url: "https://music.youtube.com/" })).ok, false);
  assert.ok((await h.request({ type: "disableHere" }, musicSender)).ok);
  assert.equal(h.session.session, undefined);
  assert.equal((await h.request({ type: "enableHere" }, { tab: { id: 1 }, url: "https://evil.example/" })).ok, false);
});
test("disable mutes first, restores the primary, and closes only its owned companion", async () => {
  const h = harness();
  await h.request({ type: "enable", tabId: 1 });
  h.actions.length = 0;
  assert.ok((await h.request({ type: "disable" })).ok);
  assert.equal(h.session.session, undefined);
  assert.equal(h.actions[0][0], "update");
  assert.equal(h.actions[0][2].muted, true);
  assert.deepEqual(h.actions.filter(a => a[0] === "remove"), [["remove", 2]]);
});
test("foreign tabs cannot control the companion, change settings, or close tabs", async () => {
  const h = harness();
  await h.request({ type: "enable", tabId: 1 });
  const stranger = { tab: { id: 9 }, url: "https://music.youtube.com/" };
  for (const type of ["disable", "settings", "audible", "loadCompanion"]) {
    assert.equal((await h.request({ type }, stranger)).ok, false);
  }
  assert.equal(h.session.session.primary, 1);
});
test("session survives service-worker recreation and only the selected tab gets primary role", async () => {
  const h = harness();
  await h.request({ type: "enable", tabId: 1 });
  const restarted = harness(h);
  const result = await restarted.request({ type: "hello" }, { tab: { id: 1 } });
  assert.equal(result.value.role, "primary");
  assert.equal((await restarted.request({ type: "hello" }, { tab: { id: 2 } })).value.role, "companion");
  assert.equal((await restarted.request({ type: "hello" }, { tab: { id: 8 } })).value.role, "none");
});

test("panel visibility persists independently of fade duration and active session", async () => {
  const h = harness({ local: { seconds: 9 } });
  await h.request({ type: "enable", tabId: 1 });
  assert.ok((await h.request({ type: "settings", showControls: false })).ok);
  assert.equal(h.local.seconds, 9);
  assert.equal(h.session.session.seconds, 9);
  assert.equal(h.session.session.primary, 1);
  const restarted = harness(h);
  assert.equal((await restarted.request({ type: "get" })).value.showControls, false);
  assert.equal((await restarted.request({ type: "hello" }, { tab: { id: 1 } })).value.showControls, false);
  await restarted.request({ type: "settings", seconds: 7 });
  assert.equal(h.local.showControls, false);
  await restarted.request({ type: "settings", showControls: true });
  assert.equal(h.local.seconds, 7);
  assert.equal(h.local.showControls, true);
});
