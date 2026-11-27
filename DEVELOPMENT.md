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
object paths are still over 260 characters, and Ninja fails with
`mkdir(...): No such file or directory` or `Filename longer than 260
characters`.

The working local workaround is to move the app's CMake staging directory to a
short root. After `expo prebuild --clean`, add this to `android/app/build.gradle`
inside the `android { ... }` block:

```groovy
android {
    externalNativeBuild {
        cmake {
            buildStagingDirectory "C:/cxx"
        }
    }
}
```

Then stop the Gradle daemons, put the SDK CMake bin first in `PATH`
(`%LOCALAPPDATA%\Android\Sdk\cmake\3.22.1\bin`), and rebuild. This lives in the
generated `android/` directory, so reapply it after every clean prebuild. Do not
use `CMAKE_OBJECT_PATH_MAX=120`; current CMake rejects values below 128 and the
128 value still leaves the path too long.

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
| Camera | `expo-camera` | QR scanning (`CameraView`) |
| OS capture + library | `expo-image-picker` | System camera capture screen, library import, video metadata |
| AES-GCM / CSPRNG | `expo-crypto` | Native AES-256-GCM with AAD and nonce control |
| File streaming | `expo-file-system` (`File`, `FileHandle`) | Chunked reads/writes without loading full files |
| Local DB | `expo-sqlite` | Structured local data and migrations |
| Secrets | `expo-secure-store` | Keystore-backed storage for identity and media keys |
| Nostr | `nostr-tools` 2.26.1 | Pure JS, Hermes-compatible, NIP-17/44/59 helpers |
| State | `zustand` | Small session and sync stores |
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

`tests/control.test.ts` (13 tests) covers invitation, membership, social and
push-token control round trips, recipient fan-out, and validation. `tests/membership.test.ts`
(6 tests) covers restore/decline ordering. `tests/social.test.ts` (7 tests)
covers participation status, comment-id ownership, operation ordering, body and
emoji validation, one-level threads and reaction summaries.
`tests/syncPresentation.test.ts` (5 tests) covers unreachable, partial, empty and
non-empty inbox presentation. `tests/notifications.test.ts` (14 tests) covers
moment grouping, singular/plural copy, mute filtering, self-author exclusion,
remote-push dedupe, preference gating, invitation/membership copy, deep-link
generation and shared route parsing. `tests/push.test.ts` (9 tests) covers Expo
token validation, batching, generic remote copy, invitations, `/open` routing and
DeviceNotRegistered cleanup. `tests/serialQueue.test.ts` (2 tests) covers ordered
execution and recovery after a rejected task.
`tests/recoveryCheckpoint.test.ts` (3 tests) covers crash-safe and per-identity
recovery routing. These are pure Node tests, not React Native rendering or
device-navigation tests.

```bash
npm test
# tests 125
# pass 125
# fail 0
```

Protocol/provider probes are manual and hit the network:

```bash
npx tsx scripts/provider-probe.ts --servers https://nostr.download --size 26214400
npx tsx scripts/limits-probe.ts
```

## Notifications and remote push

Local notifications use `expo-notifications`; the periodic inbox check is
registered with `expo-background-task`. Peer-to-peer remote push uses the same
library plus Expo Push Service. All of this requires a rebuilt dev client because
the notification plugin config changed.

### Foreground live refresh

While the app is active, `useInboxLiveSubscription` keeps one `kind: 1059`
subscription per active identity on the default inbox relays. New wraps trigger a
debounced fast sync, so invitations, moments and social activity appear without
pull-to-refresh. The subscription closes on background or offline and reconnects
with backoff. A fast sync skips backfill and outbox flushes, uses a 2.5-second
per-relay timeout and a 4-second total budget, and is also used by pull-to-refresh
and the check buttons. Bootstrap and background sync keep the full budget.

### Instant invite limits

An invitation push is only possible when the inviter already has a device token
from another shared circle. It reuses that token for a generic "New invitation"
push that routes to Circles. A cold invite from someone with no shared circle has
no token, so it still appears on open or the next background check. Instant cold
invites require a push gateway, which is not part of the client-only design.

### Expo push setup

The app is linked to `@theshadymooncat/folio`
(`60648524-595c-42f2-bdd1-b83d174072db`), and that UUID is committed in
`app.json` at `expo.extra.eas.projectId`. The project dashboard is
https://expo.dev/accounts/theshadymooncat/projects/folio. `eas.json` defines
development, preview and production profiles for optional EAS builds; the GitHub
Actions release workflow still builds the APK locally with Gradle.

Firebase Cloud Messaging (Android) is the remaining setup:

1. In the Firebase console, create or select a project.
2. Add an Android app whose package name is exactly `life.folio.app`.
3. Download `google-services.json` and put it at the repository root. It is
   gitignored. `app.config.js` adds `android.googleServicesFile` only when that
   file exists, so builds without it still work but cannot obtain push tokens.
4. In Firebase, open Project settings → Service accounts → Generate new private
   key. Keep that JSON secret.
5. Upload the service account key to Expo:
   `npx eas-cli@latest credentials -p android`, choose the `production` profile,
   then Google Service Account, and upload the JSON. Alternatively use the
   credentials page at
   https://expo.dev/accounts/theshadymooncat/projects/folio/credentials.
   Expo Push Service uses this key to deliver through FCM V1.
6. In GitHub, open Settings → Secrets and variables → Actions and add a repository
   secret named `GOOGLE_SERVICES_JSON` whose value is the complete contents of
   `google-services.json`. The release workflow writes it before
   `expo prebuild`, validates the package name, and fails with a clear error when
   the secret is missing.

The GitHub Actions build does not need `EXPO_TOKEN` or EAS Build; EAS only stores
the project link and the FCM service account. iOS additionally needs a paid Apple
Developer account and an APNs key uploaded through
`npx eas-cli@latest credentials -p ios`.

### Test on a device

1. Mirror the source with `npm run build:sync`, then rebuild the dev client from
   the short-path mirror at `C:\folio` (`npx expo run:android`, or the Gradle
   command in the Windows section).
2. Open Profile → Notifications, enable the master switch, and grant the Android
   13 permission prompt. The screen shows a warning when the EAS project id is
   missing or Expo registration fails.
3. Release builds: Profile → Notifications has a “Test notifications” card with
   permission/background/remote status and buttons for a local test notification,
   an inbox check and a remote test push. The local test is allowed in the
   foreground, so it does not require backgrounding the app.
4. Development builds: Profile → Advanced → Protocol lab → Notifications:
   - Check the "Remote push" line and the displayed Expo token.
   - "Send remote test push" calls `https://exp.host/--/api/v2/push/send` for this
     device. Background the app to see the banner; tapping should open Updates.
   - "Send test notification" schedules a local notification with a `/updates`
     URL.
   - "Run background check now" calls
     `BackgroundTask.triggerTaskWorkerForTestingAsync()` and refreshes the shown
     status/registration. Inspect the scheduled job with
     `adb shell dumpsys jobscheduler | grep -A 40 -m 1 life.folio.app`.
   - "Clear badge" calls `setBadgeCountAsync(0)`.
5. A foreground sync or refresh must not show a real-event banner. Test
   notifications are the exception.
6. With two identities/devices in one circle, enable notifications on both, let
   one inbox sync complete so tokens exchange, then publish a moment and
   background the other device. Tapping the remote push should sync and open the
   moment through `/open`.
7. Mute a circle, then repeat a post check: local notifications stay silent while
   invitations and membership changes still notify. The mute announcement should
   stop remote pushes too once the sender receives it; a change may lag until the
   next token announcement.
8. With the recipient app open on Updates or Circles, have the other device
   invite or publish. The new item should appear within a few seconds, without
   pull-to-refresh, through the live relay subscription.
9. Invite a contact whose token was already learned from another shared circle.
   The background device should receive a generic “New invitation” push that
   opens Circles. A cold invitation from someone with no shared circle should not
   push; it should appear on open or the next background check.
10. Pull to refresh while one relay is slow. The spinner should end within about
    four seconds and existing rows should remain visible.

The background-test trigger only works in debug builds; the release “Run inbox
check now” button calls the same task body directly. iOS background execution is
unavailable without a macOS host. Remote push dedupe is best-effort: the marker
is written when JS receives the push, so a push delivered while the process is
killed can still be followed by a duplicate local background notification.
Live subscriptions stop when the app is backgrounded or killed.

### Emulator status

On the Android 36 Play Store x86_64 emulator:

- Permission granted, background task registered, Expo push token ready.
- “Send test notification” posts a visible `Folio test notification` on the
  `moments` channel.
- A forced WorkManager job runs without the backfill gate blocking it.
- After uploading the Firebase service account key to Expo FCM V1 credentials,
  “Send remote test push” reports `Expo accepted and delivered the test push.`
  and the emulator posts `Folio test push` on the `moments` channel.
- The remote test now waits three seconds and checks the Expo receipt, so a
  delivery failure is shown instead of only the ticket acceptance.

## Not yet verified

- Physical Android device (camera, thermal, battery, real network switching).
- Comment/reaction delivery, edits, deletes and paginated social restore on
  physical devices; only unit-level validation is complete.
- Local notification display, tap routing, icon badge behavior and background
  task execution on a physical device.
- Remote push end-to-end on physical devices with real FCM/APNs credentials,
  including token exchange between two devices, `/open` resolution and the
  existing-contact invite push.
- Foreground live relay subscriptions and the 4-second fast refresh budget on a
  real device with slow or non-EOSE relays.
- Background upload after process death (not implemented).
- Android Auto Backup and cross-device recovery of media keys (recovery key
  export is implemented; media-key backup is not).
- iOS build (no macOS host available).
- Rotation/tablet layouts (portrait only).
