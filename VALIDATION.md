# Validation — 9 October 2026

## Verified

- `npm test`: 29 tests pass using Node's built-in test runner. The integration harness executes the **real content scripts** in two isolated VM page contexts with synthetic media and a deterministic clock. It verifies nonzero simultaneous outgoing and incoming gains on different track IDs, successful tail completion, restoration of the main volume, cancellation on disable/pause, blocked companion playback without advancing the original queue, timeout recovery, and ad exclusion. Added regressions verify playlist playback and next-song detection with an unchanged page URL, reused native media clocks across songs, the actual popup's playlist enable button, worker activation using player identity, on-page controls restricted to their sender tab, missing-injection diagnostics, and the MAIN-world metadata bridge. Version 0.1.3 tests cover a 700 ms seek delay, a 650 ms delayed start response, and safe skipping when seeking consumes the remaining tail.
- Worker simulations verify mute-before-navigation, one companion per session, owned-tab cleanup, rejection of control messages from unrelated tabs, and role recovery after a fresh worker context using retained session storage.
- Pure-rule tests cover duration bounds, URL restriction, eligibility, and gain endpoints.
- `npm run check`: all five JavaScript source files parse successfully.
- Browser inspection of the **current signed-out YouTube Music page** confirmed `#movie_player video`, `ytmusic-player-bar .next-button`, and English repeat accessibility labels exist. A real browser reached the YouTube Music application after its consent page. This checks DOM structure, not playback behavior.

## Live diagnosis of the user's existing Chrome tab (0.1.1)

The user's actual signed-in Chrome tab was inspected through the connected browser, without navigating or changing its playback. “In My Head” was playing at normal volume with `readyState: 4`, duration 266 seconds, while its URL remained the album's `/playlist?list=…` page. Runtime contexts showed **CrossFader for YouTube Music** was injected. A read-only player inspection returned `getVideoData().video_id === "nXTYL2Rhieg"`; the player's repeat mode was `NONE`.

This reproduced the specific defect in 0.1.0: the popup enabled only for `/watch` URLs, worker activation constructed the companion from the tab URL, and the content controller used that URL as the current song ID. All three paths now use the actual player ID, and all YouTube Music page views can enable. The bridge publishes validated song identity and timing, with no new permissions or media extraction.

Browser control blocks Chrome's internal `chrome://extensions` page, so reloading the locally changed extension requires the user to click Reload in Chrome and refresh the music tab. The user completed that step for version 0.1.2 before the successful live check below.

After the user's first reload, Chrome confirmed version 0.1.1, `player-state.js` running in the page's MAIN world, and the isolated controller running with the new identity rules. The shared track ID matched the live player. A real companion loaded the same song with matching duration and remained paused, muted, and buffered at `readyState: 4`. The companion then disappeared before the attempted end-of-song check could complete; the cause of its closure was not established. The main player's volume remained restored at 1. An on-page enable/status panel was added so active state and transition errors can be inspected directly on the permitted website surface.

## Live timing diagnosis and transition (0.1.2)

The live page reused its native media timeline across songs: the media element reported time 372.51 and duration 477 seconds while YouTube's logical song time was 65.15 and the current track duration was 228 seconds. This prevented reliable preparation and transition timing. Version 0.1.2 reads the logical clock from `getCurrentTime()` and stable duration from matching current-track metadata. Companion seeks translate logical time back into the native media timeline using its measured offset.

After the user reloaded 0.1.2 and resumed playback, CrossFader prepared “FEVER DREAM” (`y8uzycmSwM4`, metadata duration 153 seconds). The source was sought near the ending, then allowed to advance automatically. The original queue advanced once to “Waiting On the World to Change” (`pquX7Ya4-wE`). Both media players advanced with different IDs during the approximately five-second fade. For example, the incoming song reached 2.45 seconds at volume 0.482 while the outgoing song reached 150.45 seconds at volume 0.513; later the incoming reached 4.36 seconds at volume 0.866 and outgoing reached 152.25 seconds at volume 0.131. At completion the source continued at volume 1 and the companion was paused at volume 0. The panel returned to “Ready · waiting for the next song ending.” The required companion was retained open.

This confirms real concurrent player state and volume automation in the user's signed-in profile. Audio was not monitored, so audible continuity is not established by these measurements.

## Not verified here

The user subsequently reported “Players could not synchronize” in 0.1.2. The live source confirmed that status, but the exact clocks at the failed handoff were not recorded. Two deterministic regressions reproduced the same failure with slow seeks and stale response clocks; both failed before the 0.1.3 fix and passed afterward. Version 0.1.3 timestamps clock samples, compensates for response delivery time, and performs bounded muted retries using measured seek lag.

After the user reloaded and enabled 0.1.3, two successive transitions completed in the original “My Playlist”: OVERDRIVE → Genesis, then Genesis → Promise. The first was observed during crossfading with both different track IDs advancing, followed by a paused companion and continuing source. The second was measured using full media properties: incoming Promise at 2.13 seconds had volume 0.410, while outgoing Genesis at 172.97 seconds had volume 0.583; at 4.70 seconds incoming volume was 0.927 and outgoing volume 0.071. After approximately five seconds the source returned to volume 1 and the companion paused at volume 0. The original four-song playlist remained intact, with Si tu m'aimes demain next. Playback was sought near an ending during testing; this does not establish full-length unattended listening or audible continuity. Neither observed transition reported synchronization failure. Evidence screenshot: `output/live-0.1.3.jpg`.

- Audible continuity, concurrent-player policies in other accounts/profiles, and repeated unattended transitions.
- Actual audio continuity at the companion handoff, autoplay permission after each navigation, background timer behavior, browser restart cleanup, or casts. The source has timer-based fades; real-world timing can be less precise than the deterministic test clock.

## Live acceptance checklist

1. Load unpacked, refresh YouTube Music, sign into Premium, and play a queue with two or more ordinary songs. Turn repeat off and use playback speed 1×.
2. Enable CrossFader. Confirm exactly one companion tab opens and stays silent before the transition. If necessary, use the companion banner's **Allow player** button, then return to the source tab.
3. Let a song finish naturally (or seek to about 25 seconds before its end and then allow playback to continue). Confirm the popup progresses from preparing to ready. Listen for outgoing song audio continuing under the beginning of the next song. Check that the original queue advances once.
4. Repeat at 1, 5, and 12 seconds, and with the source tab in the background. Longer fades may shorten if the incoming song loads slowly.
5. Pause during the overlap, then test disabling during the overlap. Confirm outgoing audio stops and the main player's original volume returns; pausing must not be undone.
6. Close the companion. Confirm the session disables and the source remains controllable. Re-enable and close the source; confirm the companion closes.
7. Test manual next/previous, muted playback, short songs, repeat-one, and buffering. Confirm normal playback remains available, skipped fades report their reason, and no muted main player is left behind after a timeout.

One live five-second transition passed in the user's signed-in Chrome profile. The broader checklist remains outstanding; treat this as an experimental build whose audible seamlessness still needs listening checks.
