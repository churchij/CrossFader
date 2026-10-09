YTXfade - CrossFader for YouTube Music
Version 0.1.5

A Chrome extension that overlaps the ending of one song with the beginning
of the next. Fade length is adjustable from 1 to 12 seconds (default: 5).
This is an experimental build. YouTube Music Premium is recommended.

INSTALL

1. Extract the extension into a permanent folder, if supplied as a ZIP.
2. In Chrome, open chrome://extensions and enable Developer mode.
3. Click Load unpacked and select the folder containing manifest.json.
4. Refresh YouTube Music and start a playlist or queue.
5. Open the extension popup and click Enable on this tab. Alternatively,
   use Enable CrossFader in the on-page controls.
6. Keep the companion tab open and control playback from the original tab.

No build step or npm installation is needed to use the extension.

SETTINGS AND CONTROLS

- Crossfade length: choose 1-12 seconds in the extension popup.
- Show on-page controls: show or hide the compact bottom-right panel.
  Hiding the panel does not disable crossfading.
- Fade marker: while enabled, a small "Fade" label on the progress bar
  marks the planned transition point. It moves when fade length changes
  and remains visible when the control panel is hidden.
- Disable crossfade: stops transitions, restores the main player's volume,
  and closes the owned companion tab.

Fade length and panel visibility are remembered. Enable crossfading again
after a new browser session. To change source tabs, disable first, then
enable from the new tab.

HOW IT WORKS

The original tab keeps your playlist and determines the next song.
The companion loads the current song, stays silent, and prepares its ending.
Near the transition, it seeks to the original tab's position and continues
the outgoing song while the original tab starts the next song. The two
volumes fade in opposite directions. The companion then pauses silently.

The companion is not expected to show your full playlist. It does not
restart the outgoing song from its beginning during the handoff.

TROUBLESHOOTING AND LIMITATIONS

- If companion playback is blocked, open the companion and click Allow
  player, then return to the original tab. To retry the same song, disable
  and re-enable before the ending, or wait for another song.
- If players cannot synchronize or buffer in time, the fade is skipped or
  interrupted and ordinary playback continues. The actual overlap may be
  shorter than the selected duration or have an audible seam.
- Manual skips use ordinary playback. Pause, seek, mute, or changing tracks
  during a fade cancels it. Avoid changing volume during the transition.
- Repeat-one, live streams, very short songs, muted playback, nonstandard
  playback speed, and detected ads do not crossfade. Casting is unsupported.
- Keep the companion open. Closing it disables the session. If an old muted
  companion remains after an extension reload, close it before enabling again.
- YouTube site changes, autoplay rules, and other playback extensions can
  affect operation. Repeated unattended playback and audible smoothness
  still need testing beyond the observed successful live transitions.

UPDATING

After replacing or changing extension files, click Reload on the extension
in chrome://extensions, refresh YouTube Music, resume playback, and enable.

PRIVACY

Permissions: local extension storage and access to music.youtube.com.
No analytics, remote backend, audio recording, or credential handling.
The extension does not extract media URLs or bypass DRM. Both music tabs
make their normal requests to YouTube. The companion uses additional
bandwidth and memory and may affect playback history or recommendations.

DEVELOPMENT

With Node.js installed, run from the extension folder:

  npm test
  npm run check

No external dependencies are required. The automated tests use simulated
players; see VALIDATION.md for live-test evidence and remaining checks.
README.md contains the more detailed technical documentation.

Files under assets/ are required for branding and extension icons.
The .gitignore excludes local output, dependencies, logs, configuration
secrets, packaged CRX files, and extension signing keys.
