const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
test("actual popup enables on the user's playlist and passes the selected tab to enable", async () => {
  const elements = {}, sent = [];
  for (const id of ["toggle", "seconds", "length", "status", "companion", "showControls"]) {
    elements[id] = { callbacks: {}, addEventListener(type, fn) { this.callbacks[type] = fn; } };
  }
  const sandbox = {
    URL,
    document: { getElementById: id => elements[id] },
    window: { close() {} },
    chrome: {
      tabs: { query: async () => [{ id: 137467698, url: "https://music.youtube.com/playlist?list=OLAK5uy_kLUThP15xOy-B9p1KdQRFphoGu5_ymQlg" }] },
      storage: { onChanged: { addListener() {} } },
      runtime: { sendMessage: async message => {
        sent.push(message);
        return { ok: true, value: { seconds: 5 } };
      } }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../core.js"), "utf8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8"), sandbox);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(elements.toggle.disabled, false);
  assert.equal(elements.toggle.textContent, "Enable on this tab");
  await elements.toggle.callbacks.click();
  assert.equal(sent.find(m => m.type === "enable")?.tabId, 137467698);
});
