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

## State

- **Zustand** for session (active identity), capture hand-off and transient UI
  state.
- **TanStack Query** for reads from SQLite (circles, vlogs, archive). SQLite is
  the cache; queries invalidate after writes.
- **React context** for the theme, with a persisted `theme.preference` setting.

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
`contact_profiles`, `circle_memberships`, `control_outbox`.

Migrations use `PRAGMA user_version`; schema version 2 adds
`vlogs.viewer_pubkey`, version 3 adds `circle_invites`, version 4 adds `contact_profiles` and the
private name fields on invitations, version 6 scopes invitations to a recipient
and adds durable membership receipts plus the control outbox.

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
5. Hash the ciphertext, run a BUD-06 preflight (size/type policy).
6. `PUT /upload` (BUD-02) with a BUD-11 `kind: 24242` authorization token.
7. Verify the returned descriptor and `HEAD` the blob.
8. Persist the media key in SecureStore **before** distribution.
9. Build a NIP-17 `kind: 15` rumor carrying the file URL, ciphertext hash, and a
   `folio-key` payload; seal and gift-wrap it for each active member **and the
   sender**; publish each wrap to the recipient's kind-10050 inbox relays.
10. Write the vlog and clip to SQLite; delete the encrypted cache file.

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
restores circles immediately after an identity import. Manual pull-to-refresh
still exposes relay errors.

## Display names

`contact_profiles` is a local cache of names learned from encrypted messages:
`authorName` on key messages, `ownerName`/`names` on invitations and
`memberName` on acceptances. The UI resolves a member or author through this
cache and falls back to a shortened npub when no name is known. No public
metadata event is read or published.

Invitations carry the owner's name plus the names the owner already knows for
the roster, so a new member sees people by name immediately. An existing member
learns a newly added member's name when that member accepts or posts.

## Receive flow (`src/services/inbox.ts`, `src/services/playback.ts`)

1. Query `kind: 1059` gift wraps addressed to the identity, with NIP-42 AUTH.
2. Unwrap each wrap (signature checks, rumor/seal pubkey match).
3. Accept only `kind: 15` rumors with a well-formed `folio-key` payload and a
   32-byte key.
4. Deduplicate by rumor id, save the key to SecureStore, persist the vlog.
5. On open: download ciphertext, verify SHA-256 and size, decrypt with
   per-chunk authentication, verify the plaintext hash, then hand the local file
   to `expo-video`.

## Why chunked encryption

Video files can be hundreds of megabytes. Loading them into the JS heap is not
viable on low-end Android, and `expo-crypto`'s AES API is buffer-based. FC1
reads and writes 4 MiB chunks through `expo-file-system` `FileHandle`s, encrypts
each chunk natively, and authenticates ordering and framing. See
[PROTOCOLS.md](./PROTOCOLS.md#folio-fc1) and [SECURITY.md](./SECURITY.md).

## Background work

Not implemented in this build. Uploads run while the app is alive. Expo's
`expo-background-task` is installed but no task is registered; JavaScript
execution after Android kills the app is not assumed anywhere. A future build
must use a native upload worker (Expo Module) and persist resumable state in
`upload_jobs`.

## Build mirror (Windows)

Gradle/CMake embed absolute `node_modules` paths. This repository lives inside
OneDrive, whose path is long enough to break the native build. Local native
builds are therefore produced from a mirror at `C:\folio`
(`scripts/sync-build.ps1`), while the OneDrive directory remains the source of
truth. See [DEVELOPMENT.md](./DEVELOPMENT.md#windows-and-onedrive).
