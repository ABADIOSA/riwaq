# Riwaq 0.8 — signed in-app updates

Built on 0.7 main commit `643fbb2131e14d059bf1fb734ccf861f227eadc0`, retaining appearance, subtitles, catalog loading, backups, tracking and playback features.

- Per-user Windows NSIS installer. Existing portable users install it once; the Riwaq data directory is preserved.
- Dedicated Arabic update room: versions, plain-text release notes, download progress/size, cancel/retry, stable/beta channels, background download and install-on-exit controls.
- Automatic checks/downloads and ordinary-exit installation enabled by default. Installation never interrupts playback; explicit restart saves progress first. Windows session end defers installation.
- Pinned Ed25519 metadata authenticates each package. SHA-512 and size are checked after download and before execution. No downgrade, unsigned package or renderer executable path is permitted.
- Ready packages survive restarts. Update preferences are installation-wide. Single-instance handling focuses the existing app window.
- Release workflow signs metadata, uploads all artifacts to a draft, then publishes. Requires the matching `RIWAQ_UPDATE_PRIVATE_KEY` Actions secret.

Windows Authenticode remains unconfigured. Portable/source copies only check; use the installer for automatic updates. A real isolated NSIS fixture upgrade preserved DPAPI-encrypted data. See [update maintenance](UPDATES.md) and [verification](../VERIFICATION.md).
