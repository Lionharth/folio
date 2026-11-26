# Development

## Environment used

| Tool | Version |
| --- | --- |
| Node | 22.23.4 |
| npm | 10.9.9 |
| Java | OpenJDK 17.0.12 |
| Android SDK | platforms 35/36/37, build-tools 37.0.0 |
| NDK | 27.1.12297006 |
| CMake | 3.22.1 |
| Emulator | `Medium_Phone_API_36` (x86_64, Android 16) |
| Expo SDK | 58.0.26 |
| React Native | 0.88.1 |
| React | 19.3.0 |

No physical Android device was attached during this milestone. Everything below
that says "verified" was verified on the emulator above. Camera recording,
background behaviour and battery use still require real hardware.

## Commands

```bash
npm install
npm run typecheck       # tsc --noEmit (app)
npm run typecheck:node  # tsc -p tsconfig.node.json (tests + scripts)
npm run lint            # expo lint
npm test                # tsx --test tests/*.test.ts
npx expo start          # Metro
npx expo run:android    # dev build + install
npx expo prebuild --clean --platform android
npx expo-doctor

# release APK with embedded JS and R8 minification, from C:\folio
gradlew -p C:\folio\android app:assembleRelease -x lint -x test -PreactNativeArchitectures=arm64-v8a
```

Always use `npx expo install <pkg>` for native packages so versions match SDK 58.
`ios/` and `android/` are generated; do not hand-edit them.

Launcher icon and splash changes require `npm run brand:assets`, a fresh
prebuild, and a standalone/preview build to verify; Expo Go and the development
client show their own splash screens.

## Windows and OneDrive

This repository's primary path is inside OneDrive:

```
C:\Users\Leonf\OneDrive\Dokument\code\folio
```

Gradle + CMake embed absolute `node_modules` paths. At that length, Ninja fails
with `Filename longer than 260 characters` in
`react-native-gesture-handler` codegen (and earlier in `react-native-worklets`).
The build cannot be produced from the OneDrive path on this machine.

Working arrangement:

- **Source of truth:** the OneDrive directory (this one).
- **Native build mirror:** `C:\folio`, created by
  `scripts/sync-build.ps1`.
- `node_modules` physically lives at `C:\folio\node_modules`; the workspace
  `node_modules` is a directory junction to it so `tsc`, ESLint and tests work
  from the workspace without duplicating ~1.5 GB.
- `expo prebuild` hangs when run against the junctioned workspace, so prebuild
  and native builds are always run in `C:\folio`.
- Metro may be run from either path; the JS bundle is served to the dev client.

Typical loop:

```powershell
# after changing app.json, native config, or adding a native dependency
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sync-build.ps1
cd C:\folio
npx expo prebuild --clean --platform android
npx expo run:android --device emulator-5554

# day-to-day JS-only changes
npx expo start --dev-client   # from the workspace is fine
```

`scripts/sync-build.ps1` (also `npm run build:sync`) mirrors source and assets,
excludes `node_modules`, `android`, `.git` and `.expo`, and never deletes the
mirror's native directory.

**Metro must run from `C:\folio`, not the OneDrive path.** With `node_modules`
junctioned back into OneDrive, static imports bundle, but dynamic
`import('nostr-tools/nip19')` resolves to a bogus path
(`./folio/node_modules/...`). Running `npx expo start` from the real short path
fixes it.

### CMake object path length

Expo/AGP configures `CMAKE_OBJECT_PATH_MAX=1024`, which disables CMake's
automatic object-name shortening. At `C:\folio` the gesture-handler codegen
object path is still over 260 characters and Ninja fails. The build mirror's
`android/app/build.gradle` is patched with
`arguments "-DCMAKE_OBJECT_PATH_MAX=120"` in `defaultConfig.externalNativeBuild`.
This lives in the generated `android/` directory, so **reapply it after
`expo prebuild --clean`**, or move the change into a config plugin before the
next prebuild. The patch was applied manually for the verified build.

Consequences to be aware of:
- `npm install` run in the workspace writes through the junction into
  `C:\folio\node_modules`; that is intentional, but running `npm ci` may replace
  the junction. Recreate it if that happens:
  `cmd /c mklink /J node_modules C:\folio\node_modules`.
- OneDrive syncs source files, not `node_modules` or build output.
- EAS cloud builds are unaffected by this Windows-only issue.

`react-native-reanimated` and `react-native-worklets` are excluded from
autolinking in `package.json` (`expo.autolinking.exclude`). They arrive
transitively from Expo Router but Folio does not use animation worklets, and
their native build was the first path-length failure. If a future feature needs
Reanimated, remove the exclusion and build at the short path.

## Dependency choices

| Need | Package | Reason |
| --- | --- | --- |
| Navigation | `expo-router` | SDK-supported, file-based, Android back handling |
| Video playback | `expo-video` | SDK 58 module, native controls, local file playback |
| Camera | `expo-camera` | `CameraView` video recording |
| Library import | `expo-image-picker` | System picker, video metadata |
| AES-GCM / CSPRNG | `expo-crypto` | Native AES-256-GCM with AAD and nonce control |
| File streaming | `expo-file-system` (`File`, `FileHandle`) | Chunked reads/writes without loading full files |
| Local DB | `expo-sqlite` | Structured local data and migrations |
| Secrets | `expo-secure-store` | Keystore-backed storage for identity and media keys |
| Nostr | `nostr-tools` 2.26.1 | Pure JS, Hermes-compatible, NIP-17/44/59 helpers |
| State | `zustand` | Small session/capture stores |
| Server-cache reads | `@tanstack/react-query` | SQLite-backed queries with invalidation |
| Hashing | native `File.digest('SHA-256')` | Streams large files without JS heap pressure |

`nostr-tools` needs `globalThis.crypto.getRandomValues`. `src/lib/crypto/polyfill.ts`
installs `expo-crypto`'s native CSPRNG before any Nostr code runs.

## Tests

`tests/fc1.test.ts` (14 tests) runs the FC1 container against Node's OpenSSL
AES-GCM: round trips, empty file, partial reads, monotonic progress, unique
nonces, wrong key, ciphertext tamper, header tamper, reordered chunks, dropped
chunk, trailing data, truncation, invalid magic/version, default 4 MiB framing.

`tests/nostr.test.ts` (8 tests): two identities exchange a NIP-17 key message,
all wraps share one rumor id, a third party cannot unwrap, tampering is
detected, an impersonating seal is rejected, payload parsing rejects bad keys,
and thumbnail payloads are validated.

`tests/control.test.ts` (11 tests) covers invitation, membership and social
control round trips, recipient fan-out, and validation. `tests/membership.test.ts`
(6 tests) covers restore/decline ordering. `tests/social.test.ts` (7 tests)
covers participation status, comment-id ownership, operation ordering, body and
emoji validation, one-level threads and reaction summaries.
`tests/syncPresentation.test.ts` (5 tests) covers unreachable, partial, empty and
non-empty inbox presentation. `tests/notifications.test.ts` (8 tests) covers
moment grouping, singular/plural copy, mute filtering, self-author exclusion,
preference gating, invitation/membership copy, deep-link generation and shared
route parsing.
`tests/recoveryCheckpoint.test.ts` (3 tests) covers crash-safe and per-identity
recovery routing. These are pure Node tests, not React Native rendering or
device-navigation tests.

```bash
npm test
# tests 71
# pass 71
# fail 0
```

Protocol/provider probes are manual and hit the network:

```bash
npx tsx scripts/provider-probe.ts --servers https://nostr.download --size 26214400
npx tsx scripts/limits-probe.ts
```

## Notification background checks

Local notifications use `expo-notifications` without remote push, and the
periodic inbox check is registered with `expo-background-task`. Both require a
rebuilt dev client because the notification plugin config changed.

1. Mirror the source with `npm run build:sync`, then rebuild the dev client from
   the short-path mirror at `C:\folio` (`npx expo run:android`, or the Gradle
   command in the Windows section).
2. Open Profile → Notifications, enable the master switch, and grant the Android
   13 permission prompt.
3. In Profile → Advanced → Protocol lab → Notifications:
   - "Send test notification" schedules a local notification with a `/updates`
     URL. Background the app to see the banner; tapping should open Updates.
   - "Run background check now" calls
     `BackgroundTask.triggerTaskWorkerForTestingAsync()` and refreshes the shown
     status/registration. Inspect the scheduled job with
     `adb shell dumpsys jobscheduler | grep -A 40 -m 1 life.folio.app`.
   - "Clear badge" calls `setBadgeCountAsync(0)`.
4. A foreground sync or refresh must not show a banner.
5. Mute a circle, then repeat a post check: post notifications stay silent while
   invitations and membership changes still notify.

The test trigger only works in debug builds. iOS background execution is
unavailable without a macOS host.

## Not yet verified

- Physical Android device (camera, thermal, battery, real network switching).
- Comment/reaction delivery, edits, deletes and paginated social restore on
  physical devices; only unit-level validation is complete.
- Local notification display, tap routing, icon badge behavior and background
  task execution on a physical device.
- Remote push (not implemented).
- Background upload after process death (not implemented).
- Android Auto Backup and cross-device recovery of media keys (recovery key
  export is implemented; media-key backup is not).
- iOS build (no macOS host available).
- Rotation/tablet layouts (portrait only).
