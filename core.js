/* Shared, dependency-free transition rules. Also loaded by the Node tests. */
(function (root) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const seconds = (value) => Number.isFinite(Number(value)) ? clamp(Number(value), 1, 12) : 5;
  const validId = value => typeof value === "string" && /^[\w-]{6,64}$/.test(value);
  function isMusicUrl(url) {
    try { return new URL(url).origin === "https://music.youtube.com"; }
    catch { return false; }
  }
  function trackId(url) {
    try {
      const parsed = new URL(url);
      return parsed.origin === "https://music.youtube.com" && parsed.pathname === "/watch"
        ? parsed.searchParams.get("v") : null;
    } catch { return null; }
  }
  function companionUrl(url) {
    const id = trackId(url);
    return companionUrlFromId(id);
  }
  function companionUrlFromId(id) {
    if (!validId(id)) throw new Error("Start a song on YouTube Music first.");
    return `https://music.youtube.com/watch?v=${encodeURIComponent(id)}#crossfader-companion`;
  }
  function currentTrackId(document, url) {
    // An existing, empty bridge attribute means the player is still loading.
    // Do not mistake a stale watch URL for the currently playing song.
    const playerId = document.documentElement?.getAttribute("data-crossfader-video-id");
    if (playerId !== null && playerId !== undefined) return validId(playerId) ? playerId : null;
    const fallback = trackId(url);
    return validId(fallback) ? fallback : null;
  }
  function mediaTiming(document, video) {
    const root = document.documentElement;
    const rawTime = root?.getAttribute("data-crossfader-time");
    const rawDuration = root?.getAttribute("data-crossfader-duration");
    const bridged = rawTime !== null && rawTime !== undefined;
    const currentTime = bridged ? Number(rawTime) : video?.currentTime;
    const duration = root?.getAttribute("data-crossfader-live") === "true" ? Infinity :
      bridged ? Number(rawDuration) : video?.duration;
    return { currentTime, duration, offset: video ? video.currentTime - currentTime : 0 };
  }
  function eligible(media, fadeSeconds, ad) {
    return media && !media.paused && !media.ended && !media.seeking && !media.muted &&
      media.volume > 0 && media.readyState >= 3 && media.playbackRate === 1 && !ad &&
      Number.isFinite(media.duration) && media.duration > fadeSeconds * 2 + 5 &&
      media.currentTime > 2;
  }
  // Linear amplitude curves keep correlated recordings from increasing gain at handoff.
  function gains(progress) {
    const p = clamp(progress, 0, 1);
    return { outgoing: 1 - p, incoming: p };
  }
  const api = { clamp, seconds, trackId, isMusicUrl, companionUrl, companionUrlFromId, currentTrackId, mediaTiming, eligible, gains };
  root.CrossFader = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
