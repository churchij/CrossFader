importScripts("core.js");

const C = CrossFader;
const send = (id, message) => chrome.tabs.sendMessage(id, message);
const getSession = async () => (await chrome.storage.session.get("session")).session;
let changes = Promise.resolve();
function change(fn) {
  const result = changes.then(fn);
  changes = result.catch(() => {});
  return result;
}
async function stop() {
  const session = await getSession();
  await chrome.storage.session.remove("session");
  if (!session) return;
  // Mute the owned tab before asking either content script to tear down.
  await chrome.tabs.update(session.companion, { muted: true }).catch(() => {});
  await send(session.primary, { command: "disable" }).catch(() => {});
  await chrome.tabs.remove(session.companion).catch(() => {});
}
async function enable(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!C.isMusicUrl(tab.url)) throw new Error("Open YouTube Music and start a song first.");
  let state;
  try { state = await send(tabId, { command: "playerState" }); }
  catch { throw new Error("Refresh YouTube Music after reloading CrossFader, then try again."); }
  if (!state?.ok || !state.value?.id || !Number.isFinite(state.value.duration) || state.value.duration <= 0) {
    throw new Error("Start a song on YouTube Music, wait for it to load, then enable CrossFader.");
  }
  const url = C.companionUrlFromId(state.value.id);
  const existing = await getSession();
  if (existing?.primary === tabId) return existing;
  await stop();
  // Start on an inert extension page, register the role, then navigate while muted.
  const sidecar = await chrome.tabs.create({
    url: chrome.runtime.getURL("companion.html"), active: false, windowId: tab.windowId
  });
  const settings = await chrome.storage.local.get({ seconds: 5 });
  const session = { primary: tabId, companion: sidecar.id, seconds: C.seconds(settings.seconds),
    status: "Preparing companion. Keep both YouTube Music tabs open." };
  try {
    await chrome.storage.session.set({ session });
    await chrome.tabs.update(sidecar.id, { muted: true, autoDiscardable: false, url });
    await send(tabId, { command: "enable", seconds: session.seconds });
    return session;
  } catch (error) {
    await stop();
    throw new Error("Refresh YouTube Music after installing the extension, then try again. " + error.message);
  }
}

async function handle(message, sender) {
  const session = await getSession();
  // Only our popup can change the selected tab or close an owned companion.
  const popup = sender.url === chrome.runtime.getURL("popup.html") && !sender.tab;
  if (popup) {
    switch (message.type) {
      case "get": return { session, ...(await chrome.storage.local.get({ seconds: 5, showControls: true })) };
      case "enable": return change(() => enable(message.tabId));
      case "disable": return change(stop);
      case "settings": return change(async () => {
        const stored = await chrome.storage.local.get({ seconds: 5, showControls: true });
        const seconds = C.seconds(message.seconds === undefined ? stored.seconds : message.seconds);
        const showControls = typeof message.showControls === "boolean" ? message.showControls : stored.showControls !== false;
        await chrome.storage.local.set({ seconds, showControls });
        const current = await getSession();
        if (current) {
          current.seconds = seconds;
          await chrome.storage.session.set({ session: current });
          await send(current.primary, { command: "settings", seconds }).catch(() => {});
        }
        return { seconds, showControls };
      });
      case "showCompanion":
        if (session) await chrome.tabs.update(session.companion, { active: true });
        return;
    }
  }
  const id = sender.tab?.id;
  if (message.type === "enableHere" && id !== undefined && C.isMusicUrl(sender.url)) {
    return change(() => enable(id));
  }
  if (message.type === "disableHere" && id === session?.primary) return change(stop);
  if (message.type === "hello") {
    if (id === session?.primary) {
      await chrome.tabs.update(session.companion, { muted: true }).catch(() => {});
      await send(session.companion, { command: "halt" }).catch(() => {});
    }
    return { role: id === session?.primary ? "primary" : id === session?.companion ? "companion" : "none",
      seconds: session?.seconds ?? 5, showControls: (await chrome.storage.local.get({ showControls: true })).showControls !== false };
  }
  if (!session || id !== session.primary) throw new Error("No active CrossFader session.");
  if (message.type === "status") {
    return change(async () => {
      const current = await getSession();
      if (current?.primary !== id) return;
      current.status = String(message.text).slice(0, 250);
      await chrome.storage.session.set({ session: current });
    });
  }
  if (message.type === "loadCompanion") {
    const url = C.companionUrlFromId(message.id);
    await chrome.tabs.update(session.companion, { muted: true });
    const tab = await chrome.tabs.get(session.companion);
    if (C.trackId(tab.url) !== C.trackId(url)) await chrome.tabs.update(session.companion, { url });
    return;
  }
  if (message.type === "companion") {
    const allowed = ["prepare", "start", "snapshot", "fadeOut", "halt"];
    if (!allowed.includes(message.command)) throw new Error("Unsupported companion command.");
    const result = await send(session.companion, {
      command: message.command, id: message.id, time: message.time,
      duration: message.duration, volume: message.volume, seconds: message.seconds,
      sampledAt: message.sampledAt, lead: message.lead
    });
    if (!result?.ok) throw new Error(result?.error || "Companion is not ready.");
    return result.value;
  }
  if (message.type === "audible") {
    await chrome.tabs.update(session.companion, { muted: !message.value });
    return;
  }
  throw new Error("Unsupported request.");
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(value => respond({ ok: true, value }),
    error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(id => {
  change(async () => {
    const session = await getSession();
    if (session && (id === session.primary || id === session.companion)) await stop();
  }).catch(() => {});
});
chrome.tabs.onUpdated.addListener((id, info) => {
  if (!info.url) return;
  change(async () => {
    const session = await getSession();
    if (session && (id === session.primary || id === session.companion) &&
      !info.url.startsWith("https://music.youtube.com/")) await stop();
  }).catch(() => {});
});
