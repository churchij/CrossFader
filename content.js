(() => {
  "use strict";
  const C = CrossFader;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const media = () => document.querySelector("#movie_player video") || document.querySelector("video");
  const id = () => {
    document.dispatchEvent(new Event("crossfader-read-player"));
    return C.currentTrackId(document, location.href);
  };
  const ad = () => Boolean(document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting"));
  function timing(video) {
    document.dispatchEvent(new Event("crossfader-read-player"));
    return C.mediaTiming(document, video);
  }
  function canFade(video) {
    if (!video) return false;
    return C.eligible({ ...timing(video), paused: video.paused, ended: video.ended,
      seeking: video.seeking, muted: video.muted, volume: video.volume,
      readyState: video.readyState, playbackRate: video.playbackRate }, seconds, ad());
  }
  let role = location.hash === "#crossfader-companion" ? "companion" : "none";
  let enabled = false;
  let seconds = 5;
  let epoch = 0;
  let busy = false;
  let prepared = null;
  let attempted = null;
  let currentId = null;
  let running = false;
  let protectedVideo = null;
  let savedVolume = null;
  let lastStatus = "";
  let companionEpoch = 0;
  let fadeTimer;
  let controls;
  let controlsButton;
  let controlsStatus;
  let showControls = true;
  let fadeMarker;
  function renderFadeMarker() {
    if (!document.body || role !== "primary" || !enabled) {
      if (fadeMarker) fadeMarker.hidden = true;
      return;
    }
    const video = media();
    const duration = video ? timing(video).duration : 0;
    const bar = document.querySelector("ytmusic-player-bar #progress-bar");
    const track = bar?.querySelector?.("#progressContainer");
    const bounds = (track || bar)?.getBoundingClientRect?.();
    if (!bounds || bounds.width <= 0 || !Number.isFinite(duration) || duration <= seconds * 2 + 5 || repeatOne() || ad()) {
      if (fadeMarker) fadeMarker.hidden = true;
      return;
    }
    if (!fadeMarker) {
      fadeMarker = document.createElement("div");
      fadeMarker.id = "crossfader-fade-marker";
      fadeMarker.style.cssText = "position:fixed;z-index:2147483645;pointer-events:none;width:0;height:26px;font:600 10px system-ui;color:#dedaff";
      const label = document.createElement("span");
      label.style.cssText = "position:absolute;right:5px;top:0;white-space:nowrap;background:#202538e8;border-radius:4px;padding:2px 5px";
      const line = document.createElement("span");
      line.style.cssText = "position:absolute;left:-1px;top:15px;height:12px;width:2px;background:#b7b0ff;box-shadow:0 0 5px #0008";
      fadeMarker.append(label, line);
      document.body.append(fadeMarker);
    }
    fadeMarker.hidden = false;
    const start = Math.max(0, duration - seconds);
    fadeMarker.style.left = `${bounds.left + bounds.width * start / duration}px`;
    fadeMarker.style.top = `${bounds.top + (track ? 0 : bounds.height / 2) - 24}px`;
    fadeMarker.firstChild.textContent = `Fade · ${seconds}s`;
    fadeMarker.setAttribute("aria-label", `Planned crossfade starts ${seconds} seconds before the song ends`);
  }

  async function request(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "CrossFader was disconnected.");
    return response.value;
  }
  const companion = (command, args = {}) => request({ type: "companion", command, ...args });
  function status(text) {
    if (text === lastStatus) return;
    lastStatus = text;
    renderControls();
    request({ type: "status", text }).catch(() => {});
  }
  function restore() {
    if (protectedVideo && savedVolume !== null) protectedVideo.volume = savedVolume;
    protectedVideo = null;
    savedVolume = null;
  }
  function holdCompanion() {
    if (role !== "companion" || running) return;
    const video = media();
    if (video) { video.volume = 0; video.muted = true; video.pause(); }
  }
  function haltCompanion() {
    companionEpoch++;
    running = false;
    clearInterval(fadeTimer);
    holdCompanion();
  }
  async function waitFor(test, timeout, valid = () => true) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!valid()) throw new Error("Transition cancelled.");
      const value = test();
      if (value) return value;
      await sleep(50);
    }
    throw new Error("Player loading took too long.");
  }
  async function companionCommand(message) {
    if (role !== "companion") throw new Error("This is not the companion player.");
    switch (message.command) {
      case "halt": haltCompanion(); return;
      case "snapshot": {
        const video = media();
        return { playing: Boolean(video && !video.paused && !video.ended && video.readyState >= 3 && !ad()),
          time: video ? timing(video).currentTime : null, id: id() };
      }
      case "prepare": {
        haltCompanion();
        const token = companionEpoch;
        const valid = () => token === companionEpoch;
        const video = await waitFor(() => {
          const v = media();
          return id() === message.id && v && Number.isFinite(timing(v).duration) &&
            Math.abs(timing(v).duration - message.duration) < 2 && v.readyState >= 1 && !ad() && v;
        }, 12000, valid);
        const preparedTiming = timing(video);
        video.currentTime = preparedTiming.offset + C.clamp(message.time, 0, preparedTiming.duration - .5);
        await waitFor(() => !video.seeking && video.readyState >= 3 &&
          Math.abs(timing(video).currentTime - message.time) < .4 && !ad(), 6000, valid);
        return { id: id(), duration: timing(video).duration };
      }
      case "start": {
        haltCompanion();
        const token = companionEpoch;
        const valid = () => token === companionEpoch;
        const video = media();
        if (!video || id() !== message.id || ad() ||
          Math.abs(timing(video).duration - message.duration) >= 2) throw new Error("Companion song does not match.");
        const elapsed = Number.isFinite(message.sampledAt) ? Math.max(0, Date.now() - message.sampledAt) / 1000 : 0;
        const seekTime = C.clamp(message.time + elapsed + (Number(message.lead) || 0), 0, message.duration - .2);
        video.currentTime = timing(video).offset + seekTime;
        await waitFor(() => !video.seeking && video.readyState >= 3, 1500, valid);
        running = true;
        video.muted = false;
        video.volume = C.clamp(message.volume, 0, 1);
        // The tab remains muted until the primary has verified this player advances.
        try {
          await Promise.race([video.play(), sleep(1500).then(() => { throw new Error("Companion play timed out."); })]);
          await waitFor(() => !video.paused && timing(video).currentTime > seekTime + .08 && !ad(), 1000, valid);
          return { time: timing(video).currentTime, sampledAt: Date.now(), id: id() };
        } catch (error) { haltCompanion(); throw new Error("Companion playback blocked: " + error.message); }
      }
      case "fadeOut": {
        const video = media();
        if (!running || !video || video.paused || ad()) throw new Error("Outgoing player stopped.");
        const token = companionEpoch;
        const start = Date.now();
        const length = C.clamp(Number(message.seconds) || 1, .1, 12) * 1000;
        const volume = video.volume;
        clearInterval(fadeTimer);
        fadeTimer = setInterval(() => {
          if (token !== companionEpoch) { clearInterval(fadeTimer); return; }
          const progress = (Date.now() - start) / length;
          video.volume = volume * C.gains(progress).outgoing;
          if (progress >= 1 || video.ended || ad()) haltCompanion();
        }, 25);
        return;
      }
      default: throw new Error("Unknown player command.");
    }
  }

  function nextButton() {
    const wrapper = document.querySelector("ytmusic-player-bar .next-button");
    if (wrapper?.hasAttribute?.("disabled")) return null;
    const button = wrapper?.querySelector?.("button") || wrapper;
    return button && !button.disabled && button.getAttribute("aria-disabled") !== "true" ? button : null;
  }
  function repeatOne() {
    const mode = document.querySelector("ytmusic-player-bar")?.getAttribute?.("repeat-mode");
    return mode === "ONE" || Boolean(document.querySelector('ytmusic-player-bar [icon*="repeat_one"], ytmusic-player-bar [icon*="repeat-one"], ytmusic-player-bar [aria-label*="Repeat one"], ytmusic-player-bar [title*="Repeat one"]'));
  }

  async function transition(video, song, token) {
    const valid = () => enabled && epoch === token;
    const volume = video.volume;
    const outgoingDuration = timing(video).duration;
    let handedOff = false;
    let stopOnExit = false;
    try {
      const button = nextButton();
      if (!button || repeatOne()) throw new Error("No next song, or repeat-one is enabled.");
      let synchronizedTime = null;
      let lead = 0;
      let drift = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!valid()) throw new Error("Transition cancelled.");
        if (!canFade(video) || id() !== song) throw new Error("Source playback changed before handoff.");
        const sourceTime = timing(video).currentTime;
        if (outgoingDuration - sourceTime < 1) break;
        const started = await companion("start", { id: song, time: sourceTime,
          sampledAt: Date.now(), lead, duration: outgoingDuration, volume });
        if (!valid()) throw new Error("Transition cancelled.");
        if (!canFade(video) || id() !== song || started.id !== song) {
          throw new Error("Source playback changed before handoff.");
        }
        // Both clocks advance while a response travels through the service worker.
        const elapsed = Number.isFinite(started.sampledAt) ? Math.max(0, Date.now() - started.sampledAt) / 1000 : 0;
        const companionTime = started.time + elapsed;
        drift = timing(video).currentTime - companionTime;
        if (Math.abs(drift) <= .45) { synchronizedTime = companionTime; break; }
        // Measure seek/start lag and try again, without unmuting or advancing the queue.
        lead = C.clamp(lead + drift, 0, 1.5);
      }
      if (synchronizedTime === null) {
        throw new Error(`Players could not synchronize (${Math.abs(drift).toFixed(2)}s apart after retries); ordinary playback continues.`);
      }
      const remaining = outgoingDuration - synchronizedTime;
      if (remaining < 1) throw new Error("Too little outgoing audio remains.");
      protectedVideo = video;
      savedVolume = volume;
      video.volume = 0;
      await request({ type: "audible", value: true });
      // Unmuting can itself trigger Chrome's autoplay policy. Check before advancing.
      await sleep(120);
      const audible = await companion("snapshot");
      if (!valid() || video.paused || id() !== song || !audible.playing || audible.id !== song) {
        throw new Error("Simultaneous playback was blocked; ordinary playback continues.");
      }
      handedOff = true;
      status("Crossfading…");
      button.click();
      // The outgoing clone keeps playing while YouTube loads the next song.
      const incoming = await waitFor(() => {
        const v = media();
        if (ad()) throw new Error("An ad started; using ordinary playback.");
        if (id() !== song && v?.paused && timing(v).currentTime > .03) {
          throw new Error("Playback paused; transition cancelled.");
        }
        if (v && v !== protectedVideo) {
          protectedVideo.volume = savedVolume;
          protectedVideo = v;
        }
        if (v) v.volume = 0;
        return id() && id() !== song && v && !v.paused && !v.ended && !v.seeking &&
          v.readyState >= 3 && timing(v).currentTime > .03 && timing(v).currentTime < 2 && !ad() && v;
      }, Math.min(remaining * 1000, 8000), valid);
      const tail = await companion("snapshot");
      if (!valid() || !tail.playing) throw new Error("Next song arrived after the outgoing player stopped.");
      const length = Math.min(seconds, outgoingDuration - tail.time);
      if (length < .4) throw new Error("Buffering left no useful overlap.");
      await companion("fadeOut", { seconds: length });
      const start = Date.now();
      const incomingId = id();
      while (Date.now() - start < length * 1000) {
        if (!valid() || incoming.paused || incoming.seeking || incoming.playbackRate !== 1 ||
          id() !== incomingId || incoming.muted || ad()) {
          stopOnExit = incoming.paused;
          throw new Error("Playback changed; transition cancelled.");
        }
        incoming.volume = volume * C.gains((Date.now() - start) / (length * 1000)).incoming;
        await sleep(25);
      }
      status("Ready · waiting for the next song ending.");
    } catch (error) {
      if (valid()) status((handedOff ? "Overlap interrupted: " : "Crossfade skipped: ") + error.message);
    } finally {
      // Never resume media on failure: pausing is always the user's decision.
      await request({ type: "audible", value: false }).catch(() => {});
      await companion("halt").catch(() => {});
      restore();
      if (stopOnExit) media()?.pause();
      prepared = null;
    }
  }

  async function tick() {
    holdCompanion();
    if (role !== "primary" || !enabled || busy) return;
    const song = id();
    if (song !== currentId) {
      epoch++;
      currentId = song;
      prepared = null;
      attempted = null;
    }
    const video = media();
    if (!song || !canFade(video) || repeatOne()) return;
    const remaining = timing(video).duration - timing(video).currentTime;
    if (remaining > Math.max(35, seconds + 20) || remaining <= 1 || attempted === song) return;
    busy = true;
    const token = epoch;
    try {
      if (prepared !== song) {
        status("Preparing the outgoing song in the companion tab…");
        await request({ type: "loadCompanion", id: song });
        // Navigation and content-script registration may take a few seconds.
        await waitFor(asyncProbe, 10000, () => enabled && epoch === token && id() === song);
        await companion("prepare", { id: song, duration: timing(video).duration,
          time: Math.max(0, timing(video).duration - seconds - 10) });
        if (!enabled || epoch !== token || id() !== song) return;
        prepared = song;
        status("Ready · waiting for the song ending.");
      }
      if (timing(video).duration - timing(video).currentTime <= seconds + .65 && canFade(video)) {
        attempted = song;
        await transition(video, song, token);
      }
    } catch (error) {
      attempted = song;
      status("Crossfade skipped: " + error.message + " Open the companion if it needs a playback click.");
      await companion("halt").catch(() => {});
    } finally { busy = false; }

    // A synchronous readiness flag allows waitFor to poll without leaking async requests.
    function asyncProbe() {
      if (asyncProbe.ready) return true;
      if (!asyncProbe.pending) {
        asyncProbe.pending = true;
        companion("snapshot").then(value => { asyncProbe.ready = value.id === song; })
          .catch(() => {}).finally(() => { asyncProbe.pending = false; });
      }
      return false;
    }
  }

  function disable() {
    enabled = false;
    epoch++;
    restore();
    prepared = null;
    attempted = null;
    lastStatus = "Disabled · enable to crossfade automatic song endings.";
    renderControls();
    if (role === "companion") haltCompanion();
  }
  function renderControls() {
    if (!controls) return;
    controlsButton.textContent = enabled ? "Disable CrossFader" : "Enable CrossFader";
    controlsStatus.textContent = lastStatus || "Disabled · enable to crossfade automatic song endings.";
    controls.hidden = role === "companion" || !showControls;
    renderFadeMarker();
  }
  function mainControls() {
    if (role === "companion" || !document.body || controls) return;
    controls = document.createElement("aside");
    controls.id = "crossfader-controls";
    controls.style.cssText = "position:fixed;z-index:2147483646;right:12px;bottom:78px;background:#202538;color:#fff;padding:8px;border-radius:8px;font:11px system-ui;box-shadow:0 4px 20px #0008;width:190px";
    controlsButton = document.createElement("button");
    controlsButton.style.cssText = "background:#b7b0ff;color:#19152e;padding:5px 8px;border:0;border-radius:5px;font:600 11px system-ui;cursor:pointer";
    controlsStatus = document.createElement("p");
    controlsStatus.style.cssText = "margin:6px 0 0;line-height:1.3;overflow-wrap:anywhere";
    controlsStatus.setAttribute("role", "status");
    controlsButton.addEventListener("click", async event => {
      if (!event.isTrusted) return;
      controlsButton.disabled = true;
      try { await request({ type: enabled ? "disableHere" : "enableHere" }); }
      catch (error) { lastStatus = error.message; }
      finally { controlsButton.disabled = false; renderControls(); }
    });
    controls.append(controlsButton, controlsStatus);
    document.body.append(controls);
    renderControls();
  }
  function companionNotice() {
    if (role !== "companion" || !document.body || document.getElementById("crossfader-notice")) return;
    const notice = document.createElement("aside");
    notice.id = "crossfader-notice";
    notice.style.cssText = "position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);background:#202538;color:#fff;padding:12px 18px;border-radius:10px;font:14px system-ui;box-shadow:0 4px 20px #0008;max-width:600px";
    const text = document.createElement("span");
    text.textContent = "CrossFader companion · Keep this tab open. Use your original tab for playback. ";
    const button = document.createElement("button");
    button.textContent = "Allow player";
    button.style.cssText = "margin-left:10px;padding:6px 10px;cursor:pointer";
    button.addEventListener("click", async () => {
      const video = media();
      if (!video || !Number.isFinite(video.duration)) {
        text.textContent = "Wait until the song loads, then click Allow player. "; return;
      }
      const token = ++companionEpoch;
      running = true;
      video.volume = 0;
      video.muted = false;
      try {
        // This direct click gives this document user activation without playing sound.
        await video.play();
        text.textContent = "Player activated. Return to your original tab; keep this one open. ";
      } catch (error) { text.textContent = "Player could not start: " + error.message + " "; }
      finally { if (token === companionEpoch) haltCompanion(); }
    });
    notice.append(text, button);
    document.body.append(notice);
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    (async () => {
      if (message.command === "playerState") {
        const video = media();
        return { id: id(), duration: video ? timing(video).duration : null, paused: video?.paused };
      } else if (message.command === "enable") {
        disable(); role = "primary"; enabled = true; seconds = C.seconds(message.seconds);
        renderControls();
        status("Enabled · companion will prepare near the song ending.");
      } else if (message.command === "disable") disable();
      else if (message.command === "settings") { seconds = C.seconds(message.seconds); renderFadeMarker(); }
      else return companionCommand(message);
    })().then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
    return true;
  });
  // Companion protection begins before the site has created its video element.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.seconds) {
      seconds = C.seconds(changes.seconds.newValue);
      renderFadeMarker();
    }
    if (area === "local" && changes.showControls) {
      showControls = changes.showControls.newValue !== false;
      renderControls();
    }
  });
  new MutationObserver(holdCompanion).observe(document, { childList: true, subtree: true });
  setInterval(() => { renderFadeMarker(); tick().catch(() => {}); }, 200);
  request({ type: "hello" }).then(state => {
    // A restored, orphaned companion must remain silent until the user closes it.
    role = state.role === "none" && location.hash === "#crossfader-companion" ? "companion" : state.role;
    seconds = C.seconds(state.seconds);
    showControls = state.showControls !== false;
    enabled = role === "primary";
    if (enabled) lastStatus = "Enabled · companion prepares near the song ending.";
    renderControls();
    holdCompanion();
    companionNotice();
    mainControls();
  }).catch(() => { disable(); });
  document.addEventListener("DOMContentLoaded", companionNotice);
  document.addEventListener("DOMContentLoaded", mainControls);
  window.addEventListener("pagehide", disable);
  window.addEventListener("pagehide", () => {
    if (role === "primary") {
      request({ type: "audible", value: false }).catch(() => {});
      companion("halt").catch(() => {});
    }
  });
})();
