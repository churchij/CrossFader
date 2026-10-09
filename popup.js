const $ = id => document.getElementById(id);
let session;
let selected;
async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Extension did not respond.");
  return response.value;
}
function render() {
  $("toggle").textContent = session ? "Disable crossfade" : "Enable on this tab";
  $("toggle").disabled = !session && !CrossFader.isMusicUrl(selected?.url);
  $("companion").hidden = !session;
  $("status").textContent = session?.status || "Play a song on YouTube Music, then enable here.";
}
async function refresh() {
  const state = await request({ type: "get" });
  session = state.session;
  $("seconds").value = state.seconds;
  $("showControls").checked = state.showControls !== false;
  $("length").textContent = `${state.seconds} ${state.seconds === 1 ? "second" : "seconds"}`;
  render();
}
$("toggle").addEventListener("click", async () => {
  $("toggle").disabled = true;
  try {
    await request(session ? { type: "disable" } : { type: "enable", tabId: selected.id });
    await refresh();
  } catch (error) { render(); $("status").textContent = error.message; }
});
$("seconds").addEventListener("input", () => {
  const seconds = Number($("seconds").value);
  $("length").textContent = `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
});
$("seconds").addEventListener("change", async () => {
  try { await request({ type: "settings", seconds: Number($("seconds").value) }); }
  catch (error) { $("status").textContent = error.message; }
});
$("companion").addEventListener("click", async () => {
  try { await request({ type: "showCompanion" }); window.close(); }
  catch (error) { $("status").textContent = error.message; }
});
$("showControls").addEventListener("change", async () => {
  try { await request({ type: "settings", showControls: $("showControls").checked }); }
  catch (error) { $("status").textContent = error.message; await refresh(); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.session) { session = changes.session.newValue; render(); }
});
(async () => {
  try { [selected] = await chrome.tabs.query({ active: true, currentWindow: true }); await refresh(); }
  catch (error) { $("status").textContent = error.message; }
})();
