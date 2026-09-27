# Signed Windows updates

Riwaq 0.8 adds an NSIS installer and updates inside the installed application. Source builds and portable executables check releases but cannot replace themselves. Users coming from an older portable install `Riwaq-Setup-0.8.0-win-x64.exe` once. The existing `%APPDATA%/Riwaq` data is preserved.

## User experience

- Settings → التحديثات shows versions, text release notes, download progress, retry/cancel and restart-to-install.
- Checks run 12 seconds after startup and every four hours, with a persisted limit. Manual checks bypass the limit. Disabling checks suppresses automatic downloads and installation on exit; manual operations remain available.
- Background download and installation on ordinary app exit are enabled by default. No update closes an active viewing. Explicit restart stops MPV, saves progress and lets pending tracker writes settle first.
- A Windows session-end/shutdown event suppresses installation. Ready updates remain cached for the next session. Viewer data lives outside the installation directory.
- Beta is the default while Riwaq is experimental. Stable excludes GitHub prereleases and prerelease tags. Switching channels clears the staged package before checking again.

## Trust and boundaries

Only `assets/update-public-key.pem` ships. The maintainer holds its private Ed25519 key. Each release includes `riwaq-update.json`, an envelope with base64 `payload` and `signature`. The signature covers the exact payload bytes: schema, repository, version, platform, channel, filename, size, SHA-512, publication date and notes.

The app verifies the signature before trusting metadata, downloads a canonical installer filename from this repository's HTTPS release path, follows redirects only to GitHub asset hosts, bounds metadata/package sizes, streams to a `.part` file, then verifies size and digest. React cannot provide a command, URL or executable path. Release notes render as text. Cached metadata and the full installer are checked again before execution; versions must be newer than the running app. Missing metadata keeps the legacy release-page fallback; invalid signatures fail closed. NSIS runs per-user with fixed arguments, no shell and no requested elevation.

**Ed25519 package authentication is not Windows Authenticode signing.** The installer remains an unsigned Windows publisher until a trusted certificate is configured, so SmartScreen may still appear. Keep an offline backup of the private release key: losing it prevents publishing updates trusted by existing installations.

## Publish an update

1. Store the matching PEM private key as the Actions secret `RIWAQ_UPDATE_PRIVATE_KEY`. Never regenerate the public key per release. `scripts/create-update-key.mjs` is bootstrap-only and refuses to overwrite either key.
2. Update `package.json`, `package-lock.json` and `.github/release-notes.md`, run the checks and merge the release change.
3. Push a matching tag such as `v0.8.1` for beta, or dispatch **Release Windows build** with a matching tag and select stable/beta. Stable versions must not have a prerelease suffix.
4. The workflow builds/tests on Windows, signs installer metadata, records checksums, uploads every file to a draft, then publishes. A missing or mismatched key fails before publication. Dispatch without a tag produces build artifacts only.

Assets: `Riwaq-Setup-<version>-win-x64.exe`, `Riwaq-<version>-win-x64.exe`, `riwaq-update.json`, `SHA256SUMS.txt`. Only the installer is an automatic update target.

For local signing, set `RIWAQ_UPDATE_KEY_FILE` to the private PEM path and run `node scripts/sign-release.mjs release`. Never put the key under assets, in source archives or release artifacts. The script validates the key against the embedded public key and checks an explicit tag against package.json.

## Verification

`node --test tests/update-package.test.mjs` covers signature/key substitution, fields, digest/size mismatches, redirected hosts, cache tampering, downgrade prevention, cancellation/retry, settings gates, channel changes, shutdown deferral and installer spawn failure.

`node scripts/test-upgrade.mjs` builds two uniquely named NSIS fixture apps with the production updater, installs the first inside the workspace, serves the second through a local fixture transport, performs a signed download and real NSIS replacement, relaunches and checks that DPAPI-encrypted library/settings/progress survived. It uses a separate app ID, product name and data directory, then uninstalls the fixture. It never installs/removes the user's Riwaq. Run on a Windows desktop outside a restrictive DPAPI/GPU sandbox.

The source smoke exercises the Arabic update UI at 1440×960 and 980×680 with a signed fixture and disabled installer hook. See [VERIFICATION.md](../VERIFICATION.md). First production delivery still requires the Actions signing secret and a published signed release; a local fixture is not a production publication.

## References

Harbor informed the check/download/ready panel states and channel choice; Nuvio Desktop informed the in-app download/install flow. This implementation is original, using Node's Ed25519 verification and electron-builder's [NSIS installer](https://www.electron.build/nsis/) with Riwaq's existing release selector. No GPL updater implementation was copied.
