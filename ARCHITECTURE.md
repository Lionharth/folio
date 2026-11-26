# Architecture

Folio has no application server. The device is the client, the database, the
camera and the encryption boundary. Nostr relays distribute signed events;
Blossom servers store opaque ciphertext.

```
┌──────────────────────────── Expo app ────────────────────────────┐
│                                                                  │
│  src/app/ (Expo Router)     screens and navigation only           │
│        │                                                         │
│  src/services/              use-cases: publish, inbox, playback   │
│        │                                                         │
│  src/lib/                   protocol + storage adapters           │
│    crypto/   FC1, AES-GCM, random, file streaming adapters        │
│    nostr/    identity, relays, NIP-17/44/59                       │
│    blossom/  BUD-02 upload, BUD-06 preflight, BUD-11 auth         │
│    database/ SQLite schema, repositories, settings                │
│    security/ media keys in SecureStore                            │
│        │                                                         │
│  expo-crypto · expo-file-system · expo-sqlite · expo-secure-store │
└───────────────┬──────────────────────────────┬───────────────────┘
                │ wss (Nostr)                   │ https (Blossom)
        ┌───────▼────────┐              ┌──────▼─────────┐
        │ public relays  │              │ storage server │
        │ gift wraps     │              │ FC1 ciphertext │
        └────────────────┘              └────────────────┘
```

## Layer rules

- **Screens** never touch cryptography, relays or raw SQL. They call services,
  repositories and stores.
- **Services** orchestrate. `publishVlog` is the only place that turns a local
  video into a published vlog.
- **lib/** is provider-specific and replaceable: a different storage provider
  means a new `MediaProvider`, not a screen rewrite.
- **Pure modules** (`crypto/bytes`, `crypto/chunkedFile`) have no React Native
  imports and are tested under Node with a different AES backend.

## UI and navigation state

- JavaScript tabs contain Updates, Circles, Archive and Profile. The custom tab
  bar inserts a Create action; `/create`, `/capture` and `/vlog/[id]` are root
  Stack routes, so none leaves a tab bar underneath a full-screen flow.
- `/qr` and `/scan` are root Stack routes opened from Profile. The QR payload is
  the plain identity npub; scanning only feeds the existing owner-only
  `inviteMember` flow after filtering to circles the viewer owns.
- `/inbox` is a root Stack route opened by the bell in the Updates header. It
  lists replies, comments, reactions, invitations and membership changes. Tapping
  a social row opens `/vlog/[id]?comments=1` with the conversation expanded;
  circle rows open Circles.
- `src/lib/queryKeys.ts` owns identity-aware keys and invalidation. Updates,
  Archive, circle feeds and vlog detail share one vlog root. Publish, sync,
  read and favourite writes therefore cannot leave independent stale lists.
- Updates and Archive use `useInfiniteQuery` with repository `limit`/`offset`.
  Updates adds `unreadOnly`; Archive remains the complete history.
- `src/stores/inboxSync.ts` owns bootstrap/manual sync, reconnect retry and
  imported-identity restoration. `syncPresentation.ts` maps relay reachability
  to truthful UI copy.
- The viewer scopes the existing theme context to dark without changing the
  saved preference. React Native `Animated`/`PanResponder` drive player docking
  and the lower details layer; `useReducedMotion` supplies non-gesture access.

## State

- **Zustand** for session (active identity), capture hand-off, inbox sync and
  transient UI state. Session loading always settles and exposes a retryable
  startup error; the tabs redirect to Welcome when no identity remains.
- **TanStack Query** for reads from SQLite (circles, vlogs, archive). SQLite is
  the cache; queries invalidate after writes through the shared key helpers.
- **React context** for the theme, with a persisted `theme.preference` setting
  and scoped cinema override.
- `onboarding.recoveryPending` is a non-secret SQLite settings marker. It resumes
  the active identity's recovery-key acknowledgment after process death and is
  cleared only after acknowledgment. Secret keys remain exclusively in
  SecureStore.

## Identity

`expo-secure-store` holds:
- the registry of identities (`folio.identity.registry.v1`)
- each 32-byte secret key (`folio.identity.secret.v1.<id>`)
- each media key (`folio.mediakey.v1.<clipId>`)

Nothing secret is stored in SQLite. The public key is the protocol identity; the
UI only ever shows a display name and a shortened npub.

## Local schema (SQLite, `folio.db`)

`settings`, `relays`, `media_providers`, `circles`, `circle_members`, `vlogs`,
`clips`, `drafts`, `draft_clips`, `upload_jobs`, `favourites`, `circle_invites`,
`contact_profiles`, `circle_memberships`, `control_outbox`, `comments`,
`reactions`, `activity`, `inbox_sync_state`, `inbox_relay_state`.

Migrations use `PRAGMA user_version`; schema version 2 adds
`vlogs.viewer_pubkey`, version 3 adds `circle_invites`, version 4 adds
`contact_profiles` and the private name fields on invitations, version 6 scopes
invitations to a recipient and adds durable membership receipts plus the control
outbox, version 7 adds encrypted comments, reactions and the inbox cursor,
version 8 adds per-relay sync state and the remote-vlog lookup index, version 9
adds the unread-count index used by the Updates tab badge, and version 10 adds
the local `activity` table used by the Inbox.

Design choices:
- Every vlog row belongs to a viewer identity (`viewer_pubkey`). Local ids are
  prefixed with a short hash of the viewer so the sender and the recipient can
  both store the same remote vlog without colliding, and so a second identity on
  the same device never sees the first identity's local plaintext copy.
- `vlogs` is an inbox/archive table; `clips` belongs to a vlog with an explicit
  `position`, which is what makes sequential multi-clip playback possible.
- media keys are **not** columns. `clips` stores hashes and sizes only.
- favourites duplicate `vlogs.is_favourite` into a `favourites` table so future
  favourite ordering is independent of the feed.

## Publish flow (`src/services/publish.ts`)

1. Copy the selected video into private app storage (streamed, 4 MiB buffers).
2. SHA-256 the plaintext with the native file digest.
3. Generate a 32-byte media key from the platform CSPRNG.
4. Encrypt into FOLIO-FC1 in the cache directory.
5. Hash the ciphertext, then select a storage provider: the user's selection is
   tried first and the remaining presets follow. Each candidate gets a short
   `HEAD /` probe, a BUD-06 preflight (size/type policy) and a `PUT /upload`
   (BUD-02) with a BUD-11 token built for that origin. Transport/TLS failures,
   HTTP 5xx and a failed blob verification fall through to the next candidate;
   a 4xx is a policy answer and is surfaced without retrying elsewhere.
6. Verify the returned descriptor and `HEAD` the blob.
7. Persist the media key in SecureStore **before** distribution.
8. Build a NIP-17 `kind: 15` rumor carrying the file URL, ciphertext hash, and a
   `folio-key` payload; seal and gift-wrap it for each active member **and the
   sender**; publish each wrap to the recipient's kind-10050 inbox relays.
9. Write the vlog and clip to SQLite; delete the encrypted cache file.

The vlog never becomes visible to a recipient before its media blob exists and
has been hashed by the uploader.

## Circle invitations

An owner invites with `src/services/circles.ts`:
1. build the roster from the current local circle plus the invitee,
2. wrap a `circle-invite` control message (`kind: 14`) for the invitee,
3. publish it to their kind-10050 relays,
4. only then record them as `invited` — a failed delivery never claims they were
   invited.

The recipient's `refreshInbox` unwraps the control message, checks that the
sender is the claimed owner and that the recipient is in the roster, stores a
pending invitation, and shows it on the Circles tab. `listCirclesForViewer` only
returns circles where the active identity's membership is `active`, so an
invitation does not leak into that identity's circle pickers before acceptance.
Accepting creates the circle locally and sends a `circle-accept` back; the owner
marks the member `active` on its next sync. See PROTOCOLS.md.

Membership is durable across devices. Accepting, declining and being removed
store a `circle-membership` receipt in `circle_memberships` and publish it to
the identity's own inbox. On a new device the same sync applies the newest
receipt first: a `join` rebuilds the circle from its encrypted snapshot, a
`decline` keeps the invitation suppressed, and an owner-signed `removed` marks
the member removed. Invitations at or below the receipt's membership version
never show Accept again; a genuinely newer invitation still does. Before this
receipt existed, the first sync after upgrading seeds join receipts for circles
the identity already belongs to, so they become restorable too.

Owner removal is delivered as a `circle-membership` message to the removed
member through `control_outbox`; retries continue on later syncs. A member
recorded as `invited` or `active` on the owner's device keeps receiving post
keys until removal, so losing an acceptance cannot lock them out.

The inbox sync runs once in the background when the tabs mount, which is what
restores circles immediately after an identity import. A failed bootstrap retries
only when NetInfo reports a return to connectivity. Manual and automatic paths
share the same result state, so imported restoration, cached offline content and
partial history are presented distinctly.

## Display names

`contact_profiles` is a local cache of names learned from encrypted messages:
`authorName` on key messages, `ownerName`/`names` on invitations and
`memberName` on acceptances. The UI resolves a member or author through this
cache and falls back to a shortened npub when no name is known. No public
metadata event is read or published.

Invitations carry the owner's name plus the names the owner already knows for
the roster, so a new member sees people by name immediately. An existing member
learns a newly added member's name when that member accepts or posts.

## Social interactions (`src/services/social.ts`)

Comments and reactions are application control messages, not public Nostr
reactions or comments. A create/edit/delete operation is queued locally and in
`control_outbox` in one SQLite transaction, then wrapped once per current member
plus the sender and delivered to their inbox relays. Delivery runs in the
background; relay failure leaves the outbox row for the next sync.

The inbox applies social controls after membership evidence, invitations and
owner-signed roster updates. `comments` and `reactions` are scoped by
`viewer_pubkey`. Comment threads are one visual level: replies to replies resolve
to the nearest existing root. Edits and deletes use `(at, opId)`
last-writer-wins; a delete clears the body but keeps the row so replies stay
attached. Comment ids are author-scoped (`<author-prefix>-<uuid>`), so a member
cannot squat another author's id. A create fills metadata for a placeholder
created by an out-of-order edit or delete; if the placeholder came from a
different author, the signed create replaces it and clears forged state.

A viewer may react with up to 20 distinct emoji per target. Social controls from
a sender whose local membership is `removed` are ignored, and queued social rows
addressed to a removed member are dropped. Owner removal controls are delivered
to the removed member and every remaining member, so other devices update their
roster instead of trusting a stale `active` member. Already delivered history
remains. There is no backfill of old threads for newly joined members.

Inbox social validation uses a per-sync cache for circles, members, remote vlog
ids and comment targets. Names are learned in timestamp order after a sync, not
in the newest-first processing order, so a historical backfill cannot revert a
contact to an older name.

## Inbox activity

`src/lib/database/activity.ts` stores local, identity-scoped rows for replies,
comments on the viewer's moments, reactions to the viewer's moments/comments,
invitations and owner-driven membership changes. Rows are created while applying
received controls, not derived on read, so each row has a stable id and read
state.

- Social activity is new-only: it is recorded when a social control newly applies
  and `inbox_sync_state.last_sync_at` already exists. The initial backfill never
  floods the Inbox with historical comments or reactions.
- Deterministic ids (`comment:<id>`, `reaction:<target>:<emoji>:<actor>` and so
  on) make overlapping sync windows idempotent. Comment deletes and reaction
  removals delete their activity row; edits do not add a row.
- Self-authored controls never create activity because the sender is included in
  their own social fanout.
- `listActivity` joins the local vlog and circle, filters muted circles and hides
  activity from circles where the viewer is no longer active, except pending
  invitations and the removal row itself.
- Opening Inbox marks all unread rows read. The bell badge uses
  `countUnreadActivity`; the Updates tab badge remains the unread moment count.
- Each identity keeps at most 200 rows, pruned at the end of sync. The Inbox
  paginates 30 rows per page.
- Per-circle mute is now a full mute: it suppresses moment, invitation,
  membership and social alerts and hides activity from that circle while muted.
  Content remains visible in Updates and Circles.

## Receive flow (`src/services/inbox.ts`, `src/services/playback.ts`)

1. Query `kind: 1059` gift wraps addressed to the identity, with NIP-42 AUTH.
   Each relay is queried independently and paged with its own cursor. A relay is
   complete only after an EOSE-backed empty page; timeouts and connection
   failures never advance its cursor. Initial backfill and the incremental window
   keep separate cursors in `inbox_relay_state`; later syncs use a 3-day
   overlapping window. `InboxRefreshResult.anyRelaySucceeded` and
   `allRelaysComplete` expose these local completion facts to the UI; an
   unreachable or partial inbox is never presented as successfully up to date.
2. Unwrap each wrap (signature checks, rumor/seal pubkey match).
3. Accept `kind: 15` file messages with a well-formed `folio-key` payload and a
   32-byte key, and `kind: 14` control messages with a well-formed Folio payload.
4. Deduplicate by rumor id, then apply membership evidence, invitations,
   owner-signed roster updates, social controls and file messages. Learn display
   names in timestamp order.
5. For file messages, save the key to SecureStore and persist the vlog.
6. On open: download ciphertext, verify SHA-256 and size, decrypt with
   per-chunk authentication, verify the plaintext hash, then hand the local file
   to `expo-video`.

## Why chunked encryption

Video files can be hundreds of megabytes. Loading them into the JS heap is not
viable on low-end Android, and `expo-crypto`'s AES API is buffer-based. FC1
reads and writes 4 MiB chunks through `expo-file-system` `FileHandle`s, encrypts
each chunk natively, and authenticates ordering and framing. See
[PROTOCOLS.md](./PROTOCOLS.md#folio-fc1) and [SECURITY.md](./SECURITY.md).

## Background work

Inbox sync runs in a deferrable `expo-background-task` worker
(`folio-inbox-notifications`) while notifications are enabled, with a minimum
interval of 15 minutes. The worker reuses `refreshInbox`, skips until the
foreground backfill has completed, and yields to a foreground sync through the
`inbox.sync.lock` setting. Android WorkManager and iOS BGTaskScheduler decide
when it actually runs; force-stopping the app stops it.

Uploads still run only while the app is alive. There is no native upload worker
and no resumable upload state in `upload_jobs`.

## Notifications

Folio generates local OS notifications after an inbox sync applies a durable
transition. There is no remote push service, FCM/APNs credential, Expo push
token or notification-specific relay payload.

- Only the active identity is synced and notified. The background worker reads
  the active identity on every run.
- Device-level preferences live in `settings` under `notifications.*`: a master
  switch plus New moments, Replies and reactions, Invitations and Membership
  toggles. Effective notifications require both the master setting and OS
  permission.
- Social notification events come from activity rows created during the sync.
  A single event gets action-specific copy; multiple events on one moment are
  grouped as `N new responses` and route to the expanded conversation.
- Per-circle mute reuses `circles.muted`. It is a full mute: moment, invitation,
  membership and social notifications for that circle are suppressed, and its
  activity is hidden from the Inbox while muted.
- Events are derived from durable transitions, so repeated syncs do not
  re-notify. Self-authored moments and social controls are filtered defensively.
- The icon badge shows unread moments plus unread activity after a background
  check and is cleared when the app becomes active. The Updates tab badge reads
  the unread moment count directly; the bell badge reads unread activity. Neither
  depends on notification permission.
- Foreground syncs stay silent: the notification handler suppresses banners,
  list entries and sounds while Updates, the unread count and the tab badge still
  update.
- Background runs skip while the foreground holds the sync lock. The lock is a
  TTL-based JSON value in `settings`, so a killed process cannot deadlock the
  next launch.
- Notification content carries only a routing URL. Circle and author names are
  still visible on the lock screen and in notification history; comment bodies
  are never included, and reactions show only the emoji symbol. That trade-off is
  documented in SECURITY.md.
- On iOS, a locked keychain can prevent a background run from reading the secret
  key. The run skips and catches up later.

## Build mirror (Windows)

Gradle/CMake embed absolute `node_modules` paths. This repository lives inside
OneDrive, whose path is long enough to break the native build. Local native
builds are therefore produced from a mirror at `C:\folio`
(`scripts/sync-build.ps1`), while the OneDrive directory remains the source of
truth. See [DEVELOPMENT.md](./DEVELOPMENT.md#windows-and-onedrive).
