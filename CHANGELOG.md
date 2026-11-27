# Changelog

## 0.1.1

### Added

- Publishing falls back across storage providers. The selected Blossom server is
  tried first, then the remaining presets; transport/TLS failures, HTTP 5xx and
  a failed blob verification move to the next candidate, while a 4xx policy
  rejection is shown with the provider's own reason. Network requests are
  time-bounded.

### Fixed

- A storage provider with an untrusted or expired certificate no longer surfaces
  the raw `FileSystemUploadTask.start` rejected-promise text. The publish flow
  detects the TLS failure, skips that provider, and reports an actionable
  message if no provider can be trusted.
- Android release builds no longer crash on launch. R8 was stripping the
  reflective Room constructor used by WorkManager, so minified releases now
  keep `RoomDatabase` constructors through `expo-build-properties`.

## Unreleased

### Added

- Create → Record now opens the OS video-capture screen: a modal camera sheet on
  iOS and the installed camera app's capture screen on Android. Recording no
  longer stops at 25 MB; the 1080p/25 MB budget is enforced when publishing.
- Non-MP4 captures (iOS `.mov`/HEVC) are re-encoded to H.264 MP4 before
  encryption so Android recipients can play them.
- Android captures lost when the system destroys the activity during recording
  are recovered at startup and returned to Create with the clip attached.
- Publishing keeps the screen awake while a moment uploads, so a long encrypted
  upload is not interrupted by the display sleeping.

### Removed

- The in-app `expo-camera` recorder, its `/capture` route and the capture
  Zustand store. `expo-camera` remains for QR scanning.

## 0.1.2

### Added

- A dedicated Inbox for replies, comments on your moments, reactions to your
  moments and comments, circle invitations, and membership changes. The bell in
  the Updates header shows an unread badge; opening the Inbox marks activity read.
  Social rows open the moment with its conversation expanded.
- Local OS notifications for replies and reactions under a new Replies and
  reactions setting, grouped per moment so a burst of activity does not spam the
  notification tray.
- Publish stores an encrypted backup copy on a second Blossom provider by
  default. The copy is uploaded before the key is shared, listed in the
  `folio-key` payload, and used automatically when the primary download fails.
  The encrypted cover is backed up the same way. A Create → Advanced toggle can
  disable the extra upload.
- Received mirror URLs are validated before use: only public `https` origins
  are kept, bounded to four, loopback/LAN/link-local hosts are rejected, and the
  pinned ciphertext hash is still verified before decryption.

### Changed

- Replaced Manrope with Instrument Sans for functional UI text, keeping Cormorant
  Garamond for the wordmark and editorial titles.
- Per-circle mute is now a full mute: it suppresses moment, invitation,
  membership and social alerts for that circle and hides its Inbox activity while
  muted. The circle's content remains visible in Updates and Circles.

- The iOS app icon no longer uses the Expo Icon Composer bundle; the serif `f`
  launcher icon now applies on both platforms, and the Android adaptive icon
  uses a paper glyph on ink with a proper monochrome layer.
- Cinematic editorial redesign across every user-facing screen: large media
  covers, stronger serif hierarchy, readable secondary text, 48 dp controls,
  layout-matched loading states, contextual errors, and reduced-motion support.
- Simplified interface copy throughout: the Create action is icon-only, redundant
  subtitles and step narration are gone, empty/sync/error states are concise, and
  secondary explanations now appear only where privacy, recovery or failure
  meaning requires them.
- Hid scroll indicators, pinned Update filters and the circle-detail action bar,
  made Archive month headings sticky, improved the caught-up completion state,
  and normalized the Profile Advanced card spacing.
- Navigation now has four tabs (Updates, Circles, Archive, Profile) around a
  central full-screen Create action. Create and Capture no longer behave like
  tab destinations.
- Updates is a finite, paginated unread inbox with a clear caught-up state.
  Archive owns the identity's own published history with incremental loading,
  month groups, search, circle filters and a two-column memory grid.
- Vlog playback uses an always-dark cinema surface with player docking,
  sequential clip progress, and a draggable/keyboard/TalkBack-accessible lower
  layer for captions, reactions and threaded comments.
- Circles have media-led cards and paginated circle-specific feeds. Internal
  identifiers, membership versions and media hashes move behind Advanced or
  Technical details.
- Onboarding and Profile use accurate privacy/sync/storage copy. First-run
  recovery-key acknowledgment now survives process death, and imported
  identities expose restoration progress.
- Identity setup keeps the best-effort NIP-17 inbox-relay announcement after
  creation and import. Recovery keys remain only in SecureStore; the resumable
  checkpoint stores a non-secret local marker.

### Fixed

- Archive now lists only moments you posted and no longer stays empty until a
  filter is changed. It re-reads SQLite whenever the tab regains focus, and vlog
  lists refresh when the app returns to the foreground.

### Added

- Profile can show the active identity's Folio ID as a QR code and open a
  full-screen scanner. A scanned code is matched against circles the identity
  owns and reuses the existing private invitation flow; circles where the person
  already participates are hidden.
- GitHub Actions now builds the arm64-v8a release APK when a `v*` tag is pushed
  and attaches it, with its SHA-256, to the matching GitHub Release.
- A branded splash screen with the serif lowercase `folio` wordmark in light and
  dark variants, plus a short fade into the first screen.
- Device-local notifications for new moments, invitations and membership
  changes, with grouped per-circle copy, an unread tab badge, an icon badge after
  background checks, and deep links into the matching vlog, filtered Updates or
  Circles tab. Delivery is best-effort; there is no remote push service.
- Best-effort background inbox checks through `expo-background-task` at a
  minimum 15-minute interval. The worker skips until the foreground backfill is
  complete, uses the same `refreshInbox` path, and is serialized against
  foreground syncs with a TTL-based settings lock.
- Profile → Notifications with a device master switch, separate New moments,
  Invitations and Membership toggles, per-circle mute controls, honest
  background-delivery copy and a lock-screen privacy note.
- Private comments and reactions on vlogs and comments, delivered as encrypted
  NIP-17 control messages. Comments support one-level threads, author edits and
  author deletes; reactions support multiple distinct emoji from a picker plus a
  custom input. Social activity appears only on the vlog screen.
- The inbox now pages through initial gift-wrap history per relay, with independent
  cursors, EOSE-aware completion and a 3-day overlap for NIP-59's randomised
  timestamps. Offline or partial relay responses can no longer mark history
  complete, so a large restore survives a flaky first sync.
- Comment ids are author-scoped, and a create can replace a forged placeholder,
  so one member cannot hide another member's comment by reusing its id.
- Owner removals are delivered to the removed member and the remaining roster.
  Removed members cannot add new comments or reactions, queued social messages
  addressed to them are dropped, and other members update their local roster.
  Already received social history stays visible.
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

- The reply/edit composer in the moment viewer now stays above the keyboard;
  the conversation sheet lifts with the keyboard and scrolls the focused
  composer into view.
- Inbox results now expose relay reachability and completion. All-relays-offline
  or partial sync can no longer display a false "up to date" or "no invitations"
  success state; reconnect retries use NetInfo without a failure loop.
- Shared identity-aware query invalidation keeps Updates, Archive, circle feeds,
  read state, favourites, invitations and Create consistent after mutations.
  Repository offsets replace the old unreachable 60/100-row ceilings.
- Startup SecureStore failures have a retry state, deleting the final identity
  returns to Welcome, first-circle creation refreshes Create, and publishing
  replaces the editor instead of returning to it on Back.
- Recovery resume now comes only from the persisted checkpoint, not a URL
  parameter; failed restores stop masquerading as active. Identity import
  invalidates in-flight sync ownership, and a new recovery key is verified before
  the recovery screen. Publishing refreshes circle-card artwork, viewer read-state
  updates targeted caches, sheet docking lays out only after release, and identity
  refreshes keep the tab navigator mounted.
- Create/Capture retain entry state on failure, guard unsaved/in-flight removal,
  expose real progress, handle picker/recording/permission failures, and state
  the current duration/size and no-background-upload limits honestly.
- Query failures, unavailable media, zero clips, membership failures and social
  loading no longer masquerade as generic empty/not-found states. Reply/Edit now
  opens and focuses the composer in the expanded viewer layer.

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

### Validation

- `npm run typecheck`, `npm run typecheck:node` and `npm run lint` pass.
- `npm test` passes 63 tests, including new sync-presentation and recovery-
  checkpoint coverage. Device results are recorded below only when exercised.

### Verified on Android emulator

- Existing encrypted data loaded into the four-tab editorial shell. Updates
  rendered the large lead moment and circle filters; opening it downloaded,
  verified, decrypted and played the real clip.
- Viewer Back collapsed the expanded conversation layer before leaving; the
  opened item disappeared from Updates and remained present in Archive.
- Archive month grouping, search/filter controls and two-column cards rendered;
  Circles, circle detail/feed, Profile identity controls, theme choices and
  Create’s full-screen layout rendered with real data.
- Recording flow: camera and microphone prompts, granted-permission re-entry,
  live duration/size, stop/save handoff, and unsaved Create removal guard.
- Not exercised on-device in this pass: final publish of a newly recorded clip,
  new social delivery, fresh-install identity creation/recovery routing,
  TalkBack/font-scaling matrix, physical hardware, iOS, rotation/tablet, and
  offline/partial-relay transitions.

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
- Bundled Cormorant Garamond and Instrument Sans families (no runtime font download).
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
