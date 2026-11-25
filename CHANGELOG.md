# Changelog

## Unreleased

### Added

- Seamless circle restore: accepting, declining or being removed publishes a
  private `circle-membership` receipt to the identity's own inbox. Restoring an
  identity on a new phone or after a reinstall re-applies the newest receipts,
  so previously joined circles come back without tapping Accept again. Existing
  memberships are backfilled on the first sync after upgrading.
- The inbox syncs once in the background when the tabs open, so an imported
  identity restores its circles immediately.
- Owner removal now travels to the removed member as a private control message,
  retried from `control_outbox`, so a stale join receipt cannot resurrect the
  circle after a restore.
- Pending invitations are scoped to the recipient identity, so multiple
  identities on one device no longer see each other's invitations.
- Private display names: the owner's name travels with invitations, the
  invitee's name with acceptance, and every post carries its author's name.
  Names are cached in `contact_profiles` (schema v4) and shown in circles, the
  feed, the archive and the player instead of long npubs, with npub fallback
  when a name is not known.

### Fixed

- The tab bar now respects the Android navigation-bar inset, so it is not
  hidden under 3-button or gesture navigation. Full-screen screens also include
  the bottom safe area.
- Circles now reach invited members: the owner sends a private NIP-17
  `circle-invite` control message, the invitee sees a pending invitation on the
  Circles tab, and accepting adds the circle locally and notifies the owner.
  Members are recorded as `invited` until acceptance; post keys are delivered to
  invited members too, so a lost acceptance cannot lock them out.
- An invitation for a circle the identity already belongs to refreshes the
  local name and roster instead of asking the member to accept again.
- Invitations are only trusted when the claimed owner signed them and the
  recipient is in the roster.
- The previous "add member" flow only changed the owner's local database; it
  now explains that delivery failed instead of silently pretending success.

### Added

- `circle_invites` table (schema v3), invitation UI with accept/decline, resend,
  and owner-side acceptance handling.
- 5 more tests for control-message wrapping and validation (25 total).

### Verified on device

- Private names verified on device: A invited B; B's invitation said "From
  Leon" and B joined; A then saw "Sam" instead of an npub, and B's feed showed
  "Leon · Weekend" as the author. Schema v4 migrated in place.
- 3-button Android navigation: tab bar renders above the system bar.
- Identity A created "Weekend" and invited identity B. B's Circles tab showed
  "1 invitation found"; the circle was hidden until B accepted. After accepting,
  B saw the circle. A's next sync reported "Membership updated" and B became
  `member · active`.

## 0.1.0 — Phase 0/1 feasibility build

### Added

- Expo SDK 58 / React Native 0.88 / TypeScript app with Expo Router, Android
  dev build, and EAS-ready configuration.
- Design system: colour/typography/spacing/radius tokens, light and dark
  palettes, `AppText`, `Button`, `TextField`, `Card`, `Screen`, `Avatar`,
  `ListRow`, `PageHeader`, empty/loading/error states.
- Bundled Cormorant Garamond and Manrope families (no runtime font download).
- Five-tab shell: Updates, Circles, Create, Archive, Profile.
- Onboarding: create identity, reveal/copy recovery key, import `nsec`.
- Identities and media keys in `expo-secure-store`; no secrets in SQLite.
- SQLite schema v1 with migrations and repositories for circles, members,
  vlogs, clips, drafts, drafts clips, upload jobs, relays, providers, settings,
  favourites.
- FOLIO-FC1 chunked AES-256-GCM container with authenticated header, per-chunk
  nonce/index/final-flag AAD, whole-file hash pinning.
- Native AES-GCM/CSPRNG adapters via `expo-crypto`; file streaming adapters via
  `expo-file-system` `FileHandle`.
- Nostr identity, relay pool with NIP-42 AUTH, reconnect and dedupe; NIP-17
  `kind: 15` file messages sealed/gift-wrapped per recipient plus sender.
- Blossom client: BUD-06 preflight, BUD-02 upload with BUD-11 authorization,
  descriptor validation, `HEAD` verification, hash-verified download,
  multi-source mirror fallback.
- Publish pipeline (local copy → hash → encrypt → preflight → upload → verify →
  distribute keys → persist) and inbox/playback pipelines.
- Create screen with library import and camera capture, circle/provider picker,
  staged progress; vlog player with sequential multi-clip navigation.
- Updates feed with pull-to-refresh, circle filter and unread markers; archive
  with search, circle filter and favourites.
- Profile with identity switching, appearance (system/light/dark), recovery key
  reveal, provider and relay info.
- Protocol lab: on-device AES round trip, NIP-11 relay health, Blossom health
  and feature discovery.
- Provider probe and size-limit probe scripts with measured results in
  PROVIDERS.md.
- 20 unit tests (14 crypto/framing, 6 NIP-17 protocol), Node AES backend.

### Verified

- `npm test`: 20/20 pass.
- `npm run typecheck`: clean.
- `npm run typecheck:node`: clean.
- `npm run lint` (ESLint over `src`): clean after the relocation; configuration load is very slow in this environment (~2 min), the run itself completes.
- Android debug build: `BUILD SUCCESSFUL in 12m 31s`, APK 89,460,656 bytes,
  installed on `Medium_Phone_API_36` (Android 16, x86_64).
- Android release build with embedded JS: `BUILD SUCCESSFUL`, APK 55,393,745
  bytes, installed and launched without Metro; light and dark themes verified on
  device.
- Fixed per-identity data scoping (`viewer_pubkey`), SecureStore-safe local ids,
  and truncated button labels found during device testing.
- Two-identity publish/receive on one emulator: 187,118-byte clip encrypted to
  a 187,166-byte FC1 blob, uploaded to nostr.download, key delivered by NIP-17,
  recipient downloaded, verified both hashes, decrypted and played the video.
  The uploaded blob starts with `FOLIOFC1` and contains no `ftyp` box.
- Real uploads/downloads with hash verification against nostr.download,
  blossom.yakihonne.com, blossom.ditto.pub and blossom.data.haus (see
  PROVIDERS.md for timings and limits).
- One relay rejected NIP-42 AUTH with `relay needs serviceUrl to be configured
  before AUTH can work`; delivery still succeeded through other relays. AUTH
  compatibility needs per-relay testing.

### Known gaps

- No reactions or comments.
- No push notifications and no background upload after process death.
- No signed cross-device membership events.
- Recovery restores the identity but not previously received media keys.
- No automatic mirroring, no paid provider support, no resumable uploads.
- Only the emulator was used for the UI; real-device camera, network switching
  and battery behaviour remain untested.

### Environment notes

- `node_modules` moved to `C:\folio\node_modules` with a junction from the
  OneDrive workspace; native builds run from `C:\folio` because Ninja cannot
  handle the OneDrive path length. See DEVELOPMENT.md.
- Reanimated/Worklets excluded from autolinking (unused) after their native
  build failed on the long path.
