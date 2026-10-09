// Runs in the page's MAIN world because the player API is not visible to an
// isolated content script. Publishes song timing and ID, never media URLs.
(() => {
  "use strict";
  const attribute = "data-crossfader-video-id";
  function publish() {
    const root = document.documentElement;
    if (!root) return;
    try {
      const player = document.getElementById("movie_player");
      if (typeof player?.getVideoData !== "function") {
        root.removeAttribute(attribute);
        return;
      }
      const id = player.getVideoData()?.video_id;
      const value = typeof id === "string" && /^[\w-]{6,64}$/.test(id) ? id : "";
      if (root.getAttribute(attribute) !== value) root.setAttribute(attribute, value);
      const data = player.getVideoData();
      const details = player.getPlayerResponse?.()?.videoDetails;
      const time = player.getCurrentTime?.();
      const duration = details?.videoId === value ? Number(details.lengthSeconds) :
        !details ? Number(document.querySelector('ytmusic-player-bar #progress-bar')?.getAttribute('aria-valuemax')) : 0;
      root.setAttribute("data-crossfader-time", Number.isFinite(time) && time >= 0 ? String(time) : "");
      root.setAttribute("data-crossfader-duration", Number.isFinite(duration) && duration > 0 ? String(duration) : "");
      root.setAttribute("data-crossfader-live", data?.isLive || data?.isWindowedLive ? "true" : "false");
    } catch { root.setAttribute(attribute, ""); }
  }
  // The isolated controller can request a synchronous refresh before decisions.
  document.addEventListener("crossfader-read-player", publish);
  setInterval(publish, 200);
  publish();
})();
