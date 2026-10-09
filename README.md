# CrossFader for YouTube Music

A Manifest V3 Chrome extension with a **five-second default**, adjustable **1–12 second** duration, and an enable/disable button. This is an experimental implementation of **actual simultaneous playback**, intended for local YouTube Music Premium playback.

## Install

1. In Chrome, open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select **`C:\Git\CrossFader`** (the folder containing `manifest.json`). No build or npm installation is needed.
4. Refresh any already-open YouTube Music tabs.
5. Sign into your Premium account at [YouTube Music](https://music.youtube.com), start a playlist or queue, and click the CrossFader extension icon. Pin it from Chrome's Extensions menu if desired.
6. Click **Enable on this tab** in the popup, or **Enable CrossFader** in the on-page panel at the bottom right. One background **companion tab** opens. Keep it open and control playback from your original tab. The on-page panel shows preparation, skipped transitions, and errors.
7. Adjust the slider as desired. Click **Disable crossfade** to stop transitions, restore the current player's volume, and close the extension's companion tab.

The duration is remembered. Enabling is per browser session and selects one source tab. To switch source tabs, disable, then enable from the new tab. Reload the extension and refresh YouTube Music after changing its code.

In version 0.1.4, **Show on-page controls** in the popup lets you hide or restore the compact bottom-right panel. The choice is remembered and applies immediately to refreshed extension pages. Hiding the panel leaves crossfading enabled; you can still control it from the extension popup.

Version 0.1.5 adds a small **Fade · Ns** marker on the seek bar while crossfading is enabled. It marks the planned starting point (song duration minus the selected fade length), moves when the length or track changes, and follows the bar when the window resizes. It remains visible when the larger control panel is hidden, does not intercept clicks, and disappears when disabled or the track is ineligible. Buffering can shorten the actual overlap; the marker shows the planned point, not a guarantee of its timing.

### Updating from 0.1.0

Version **0.1.3** compensates for message delivery time when comparing player clocks and retries a delayed companion seek up to three times while the tab stays muted. It retains the 450 ms synchronization requirement; it still skips if the players cannot align or too little outgoing audio remains. Disable/re-enable now clears the attempted-song marker so the same track can be retried. No permissions were added.

Version **0.1.2** fixes activation and song tracking when you listen from a playlist, album, home, or browse page. Version 0.1.0 incorrectly required the page URL to be `/watch?v=…` even while a song was already playing. The live investigation also found that YouTube can reuse a native media timeline across songs; 0.1.2 uses YouTube's logical song clock and stable track duration instead of the video's growing timeline.

Open `chrome://extensions`, click **Reload** on CrossFader, refresh your YouTube Music tab, start/resume the album, then click **Enable CrossFader** in the on-page panel (or **Enable on this tab** in the popup). You can stay on the album's `/playlist` page. If an old companion survives the extension reload, close it before enabling again. Closing the active companion disables the session, so enable again to create a replacement.

## How the overlap works

YouTube Music's page has a single media player. Fading that player down and back up would not overlap two songs. CrossFader instead loads a normal YouTube Music copy of the current song in a second tab, pauses it, and prepares the ending roughly 35 seconds before the song finishes.

The active song is read from the player's `getVideoData().video_id`, using a small MAIN-world script that publishes only song identity, timing, duration, and live-stream status into the shared DOM. This is necessary because the page can remain on an album or playlist while several songs play. The popup asks the content script for the current song before opening the companion; an unrelated page URL is never treated as the queue's track identity. Time comes from `getCurrentTime()` and duration from the current player response's track metadata, because the native media element can contain an offset and a buffered duration spanning several songs.

Near the configured ending, it seeks and starts the companion at the source player's position while the companion tab is still muted. It checks that playback advances and that the positions agree within 450 ms. It transfers the outgoing audio to that companion, then clicks the **normal Next control in your original tab**, keeping your original queue and shuffle order authoritative. Once the new song is playing, the outgoing and incoming media players play together with opposite linear volume curves. No media URLs are extracted, no audio is recorded, and no DRM is bypassed. Protected content is played only by YouTube Music's own pages.

Because the next song loads after the handoff, the actual overlap can be shorter than the slider setting. The companion-to-original synchronization can also cause an audible seam. This approach cannot promise the precision or seamlessness of a music service's native crossfade feature.

## Playback limitations and troubleshooting

- **Live playback:** version 0.1.2 completed a five-second transition in the user's signed-in Chrome profile, with different songs advancing simultaneously and opposite volume curves. This verifies the player behavior for that transition; audible continuity and other profiles still need listening checks. If the site pauses either player, CrossFader skips or cancels the fade. It does not fight the site's playback restrictions.
- **Autoplay:** if the popup says companion playback is blocked, click **Open companion tab**, then **Allow player** in the companion's banner. This makes a direct playback request during a user click without emitting sound. Return to your original tab. A song already skipped by CrossFader is not retried until a different song plays. Navigation to another companion song creates a new document, so this permission may need to be granted again; some Chrome profiles will therefore not support unattended transitions. Chrome's [autoplay policy](https://developer.chrome.com/blog/autoplay) explains why extension clicks alone cannot guarantee playback permission in a website document.
- **Buffering or missing controls:** the popup reports a skipped or interrupted fade and volume is restored. If the original queue has already advanced, it stays on the next song. Loading may cause a gap; this extension cannot prebuffer the next song while also preserving the main page's queue.
- **Ads:** detected ads cause ordinary playback or immediate cancellation. The extension does not skip ads. Premium is recommended; ad detection depends on YouTube's DOM and cannot be guaranteed.
- **Supported transitions:** automatic endings of finite songs at normal playback speed. Live streams, muted playback, short songs (less than twice the selected fade plus five seconds), and detected repeat-one mode are excluded. Repeat-one detection uses the player's `repeat-mode` attribute, with English accessibility labels as a fallback; switch repeat off for reliable operation. Local playback only; casting is unsupported.
- **Manual actions:** manual skips outside an automatic transition use ordinary playback. Pause, seek, mute, or a track change during the fade cancels it. A pause during the incoming loading phase is detected once playback has started; cancellation can otherwise take until the loading timeout (at most eight seconds). Avoid changing volume during the brief transition because the fade controls the media volume then.
- **Extra playback:** the companion uses bandwidth and memory and may affect account playback history/recommendations. It uses the signed-in account in the same Chrome profile. Browser or extension restarts can leave a muted companion tab behind; close it and enable again from your original tab. Other extensions that control YouTube Music's volume or playback may conflict.
- **Site changes:** this implementation uses DOM controls, including `ytmusic-player-bar .next-button`, and undocumented player metadata/timing APIs. Site changes can break it. Refresh after installation if the popup asks you to.

## Privacy and permissions

Only `storage` and access to `https://music.youtube.com/*` are requested. The Chrome Tabs API can create and mute tabs without the broad `tabs` permission; this site's host permission permits access to its URL. Settings are local; active session state uses `chrome.storage.session` so the service worker can restart without forgetting its owned tab. No analytics, network backend, downloads, remote code, or credentials handling are included. The two YouTube Music pages make their usual requests to YouTube.

## Validation

Run with Node.js (no dependencies):

```powershell
cd C:\Git\CrossFader
npm test
npm run check
```

See [VALIDATION.md](VALIDATION.md) for the verified scope and the live playback checklist.

## Files

`manifest.json` declares the extension; `background.js` owns session and companion lifecycle; `player-state.js` publishes the active player's song identity and logical clock; `content.js` controls the page players; `core.js` contains transition rules; `popup.html`, `popup.css`, and `popup.js` implement controls. `companion.html` is an inert staging page used to create the second tab safely before navigating it while muted. `tests/` contains dependency-free simulation tests.

Primary references: [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs), [extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage), and [service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
