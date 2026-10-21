# Research-based playback hardening — 2026-10

## Repository and patch-note review

- Jellyfin Web release notes: https://github.com/jellyfin/jellyfin-web/releases
  - v12.1 listed a playback-stop listener leak fix (#8282) and a Now Playing player-switch consistency fix (#8284).
- Feishin releases: https://github.com/jeffvli/feishin/releases
  - Recent notes describe stale/duplicate playback updates and queue-end stopping problems in the web player.
- Spotube changelog: https://github.com/team-spotube/spotube/blob/master/CHANGELOG.md
  - Its playback fixes include incorrect Play Next behavior, unplayable-source handling, and playback recovery across platforms.
- Media Session API reference: https://developer.mozilla.org/en-US/docs/Web/API/MediaSession/setPositionState
  - Calling `setPositionState()` without an argument clears the existing system-facing position/progress state.

These reports are not treated as patches to copy verbatim. The applicable pattern is to invalidate stale playback state on every source transition and keep cleanup defensive when browser APIs are missing or throw.

## Applied in Ritmo

- Added `clearMediaSessionPositionState()`, safe when the API is missing or rejects cleanup.
- Clearing system media metadata now also clears the old position/seek bar.
- `updateMediaSession()` only publishes finite, non-negative positions for a positive finite duration. It clamps the position to the current duration, normalizes an invalid playback rate to 1, and clears the previous position state when the new source has not provided valid timing yet.
- Added regression checks for cleanup, unsupported API behavior, invalid timing, and system progress cleanup during track/source transitions.
- Bumped the offline app-shell cache to `ritmo-shell-v50` so installed PWA clients fetch the updated playback modules.

## Validation

The automated validation suite is the release gate. Browser and OS Media Session support varies; the defensive cleanup must not interrupt playback when position-state support is absent.
