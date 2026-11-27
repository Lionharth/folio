# Protocols

Folio speaks Nostr for events and Blossom for blobs. This file records exactly
what is implemented, what is extended, and what is intentionally not used.

The cinematic editorial UI redesign does not change any event, payload,
container, key-delivery or storage format. `InboxRefreshResult` additionally
exposes `anyRelaySucceeded`, `allRelaysComplete` and `completedAt` for local UI
status. These are derived completion facts, not wire-protocol fields.

## Implemented

| Spec | Use | Notes |
| --- | --- | --- |
| NIP-01 | Events, signing, verification | `nostr-tools/pure`, Schnorr secp256k1 |
| NIP-19 | `npub`/`nsec` display and import | `nostr-tools/nip19` |
| NIP-42 | Relay AUTH for gift-wrap subscriptions | `automaticallyAuth` in the pool |
| NIP-44 v2 | Rumor/seal payload encryption | `nostr-tools/nip44` via NIP-59 |
| NIP-59 | Seals (`kind: 13`) and gift wraps (`kind: 1059`) | `nostr-tools/nip59` |
| NIP-17 | Private file messages (`kind: 15`) and inbox relays (`kind: 10050`) | See extension below |
| BUD-01 | Blob retrieval, `HEAD`, feature discovery | `src/lib/blossom/client.ts` |
| BUD-02 | `PUT /upload` | Ciphertext only |
| BUD-06 | `HEAD /upload` preflight | Used to surface provider limits |
| BUD-11 | `kind: 24242` authorization token | `Nostr <base64url>` header |
| BUD-12 | `DELETE /<sha256>` | Probe/cleanup script only; app does not delete |

## Not used (and why)

- **NIP-29 relay groups** — relay membership is not application membership, and
  it is not an encrypted group. Circles are an application-level model.
- **NIP-71 video events** — designed for public video posts with `imeta` URLs.
  Folio's video metadata is private and encrypted; publishing a public kind 21
  would leak titles, URLs and authors. A manifest event may be added later,
  encrypted to the circle.
- **NIP-25 reactions / NIP-22 comments** — planned. They will be gift-wrapped,
  not public.
- **NIP-96** — not used; Blossom is the storage protocol.
- **NIP-46 remote signer / NIP-07** — not used. Keys are local.

## NIP-17 file message extension

Folio wraps a `kind: 15` rumor per recipient. Envelope rules follow NIP-17:

- one random wrapper key per wrap, `created_at` randomized within two days,
- seal is `kind: 13`, signed by the sender, no tags,
- rumor is unsigned, `pubkey` must equal the seal's pubkey (verified by the
  library),
- all copies of one message share a single rumor id so recipients can
  deduplicate redelivery from multiple relays,
- the sender also receives a copy (archive portability),
- each wrap is published only to the recipient's `kind: 10050` relays when one
  is advertised, otherwise to the bootstrap relay set.

Tag set:

```json
{
  "kind": 15,
  "tags": [
    ["p", "<recipient pubkey>"],
    ["file-type", "video/mp4"],
    ["encryption-algorithm", "aes-256-gcm"],
    ["decryption-key", "<base64 32-byte key>"],
    ["x", "<sha256 of ciphertext>"],
    ["size", "<ciphertext bytes>"],
    ["folio-format", "FOLIOFC1"],
    ["folio-key", "{...payload...}"],
    ["alt", "Private video: <title>"]
  ],
  "content": "https://blossom.example/<sha256>.bin"
}
```

`decryption-key` and `x` are the NIP-17 fields. NIP-17 assumes a single GCM
nonce, which conflicts with chunked encryption, so Folio omits
`decryption-nonce` and declares the container in `folio-format`.
`folio-key` carries:

```json
{
  "v": 1,
  "vlogId": "uuid",
  "clipId": "uuid",
  "circleId": "uuid",
  "title": "optional",
  "description": "optional",
  "format": "FOLIOFC1",
  "keyB64": "32-byte key",
  "encryptedSha256": "hex",
  "plaintextSha256": "hex",
  "encryptedSize": 123,
  "plaintextSize": 100,
  "durationMs": 4200,
  "mimeType": "video/mp4",
  "width": 1080,
  "height": 1920,
  "createdAt": 1700000000,
  "mirrors": ["https://backup.example/<sha256>.bin"]
}
```

`mirrors` lists verified extra copies of the same ciphertext. It is optional and
bounded: receivers keep at most four unique public `https` origins, reject
loopback/LAN/link-local hosts, and drop anything else. `thumbnail` may carry its
own `mirrors` array for the encrypted cover. The primary URL remains the rumor
`content`.

Compatibility: a generic NIP-17 client can see a file message, but cannot
decrypt FC1 because the key decrypts chunks, not the whole container. Folio does
not pretend otherwise.

## Circle control messages

Circle state is application-level. Invitations and acceptances travel as
NIP-17 `kind: 14` rumors with a `folio-control` tag, so relays only see gift
wraps. They are never public events.

Sharing a Folio ID as a QR code carries only the plain NIP-19 `npub`; scanning
it pre-fills the existing owner invite flow and changes no control event, table
or payload. The private `circle-invite` below is still what reaches the invitee.

Invitation:

```json
{
  "v": 1,
  "type": "circle-invite",
  "circle": {
    "id": "uuid",
    "name": "Close friends",
    "description": "optional",
    "ownerPubkey": "<hex>",
    "ownerName": "Leon",
    "membershipVersion": 2,
    "members": ["<owner>", "<member>", "..."],
    "names": { "<owner>": "Leon", "<member>": "Sam" }
  },
  "invitedAt": 1700000000
}
```

`ownerName` and `names` are optional and only ever exist inside the encrypted
rumor. Names are capped at 40 characters and `names` may only contain keys that
appear in `members`.

Acceptance:

```json
{ "v": 1, "type": "circle-accept", "circleId": "uuid", "memberPubkey": "<hex>", "memberName": "Sam", "at": 1700000100 }
```

Durable membership receipt (accepted, declined and removed circles):

```json
{
  "v": 1,
  "type": "circle-membership",
  "action": "join",
  "circleId": "uuid",
  "ownerPubkey": "<hex>",
  "memberPubkey": "<hex>",
  "membershipVersion": 2,
  "at": 1700000100,
  "circle": {
    "id": "uuid",
    "name": "Close friends",
    "description": "optional",
    "ownerPubkey": "<hex>",
    "ownerName": "Leon",
    "membershipVersion": 2,
    "members": ["<owner>", "<member>"],
    "names": { "<owner>": "Leon", "<member>": "Sam" }
  }
}
```

`action` is `join`, `decline` or `removed`. A `join` receipt always carries
the `circle` snapshot so a new device can rebuild the circle without the
original invitation. The snapshot is optional for other actions. Receipts are
gift-wrapped to the member's own inbox; an owner sends `removed` to the member
being removed.

Rules enforced in `src/lib/nostr/circleControl.ts` and `src/services/inbox.ts`:

- `circle.ownerPubkey` must equal the rumor author, otherwise the invite is
  dropped (no relay can forge an owner).
- display names are learned from these control messages and from the
  `authorName` field of key messages; Folio never reads public kind-0 metadata.
- the recipient must appear in `circle.members`, otherwise it is dropped.
- members are hex public keys, deduplicated, capped at 100.
- names are optional, whitespace-normalised, 1–40 characters; a names map with
  a key outside the roster, a non-hex key or an invalid name is rejected.
- an acceptance is only applied when its `memberPubkey` equals the sender and
  the local circle is owned by the receiver.
- invitations are deduplicated by (recipient, circle, owner, membership
  version).
- a membership receipt is only applied when its `memberPubkey` equals the local
  public key. Self-authored receipts need sender = member; a `removed` receipt
  needs sender = `ownerPubkey`.
- membership evidence is ordered by `(membershipVersion, at)`; newer evidence
  replaces older evidence for the same `(recipient, circle, owner)`.
- a receipt with a `circle` snapshot must match the top-level `circleId`,
  `ownerPubkey` and `membershipVersion`. For `join`, the member must be in the
  snapshot roster; for `removed`, the member is expected to be absent.

On acceptance the member creates the circle locally, publishes a `join`
receipt to their own inbox, and sends an acceptance to the owner. Receipt
delivery is retried on later syncs; acceptance delivery is best-effort. The
owner already authorized the invite, and post keys are delivered to both
`invited` and `active` members, so a lost acceptance cannot lock the invitee out
of future posts. Previously published media is not redistributed.

On restore (new device, fresh install, or recovery-key import), the inbox sync
applies the newest receipt per circle. A `join` rebuilds the circle silently; a
`decline` or owner `removed` keeps the circle away. Invitations at or below the
receipt's version are never shown as pending. A newer invitation is a genuine
re-invite and asks again. Removal notices are queued in `control_outbox` on the
owner's device until a relay accepts them.

## Social control messages

Reactions and comments use the same encrypted `kind: 14` control rumor and
`folio-control` tag. They are never public events.

Comment operation:

```json
{
  "v": 1,
  "type": "circle-comment",
  "opId": "uuid",
  "action": "create",
  "commentId": "uuid",
  "circleId": "uuid",
  "vlogId": "remote-vlog-uuid",
  "body": "plain text",
  "replyToId": "optional-comment-uuid",
  "authorName": "Sam",
  "at": 1700000200000
}
```

`action` is `create`, `edit` or `delete`. A delete carries no body, reply or
name. `body` is 1–1000 characters and is stored and rendered as plain text.
`commentId` is stable across edits and deletes and must be author-scoped:
`<first-10-hex-of-sender-pubkey>-<uuid>`. `at` is milliseconds. The sender is
the rumor author; no author key is trusted from the payload. A create whose id
prefix does not match its sender is rejected, so one member cannot squat another
author's comment id.

Reaction operation:

```json
{
  "v": 1,
  "type": "circle-reaction",
  "opId": "uuid",
  "targetType": "vlog",
  "targetId": "remote-vlog-uuid",
  "vlogId": "remote-vlog-uuid",
  "circleId": "uuid",
  "emoji": "one emoji",
  "active": true,
  "authorName": "Sam",
  "at": 1700000200000
}
```

`targetType` is `vlog` or `comment`. A vlog target requires `targetId` to equal
`vlogId`; a comment target uses the comment id but still carries the vlog id.
`active: false` removes that sender's reaction. A sender may hold up to 20
distinct emoji on one target; repeating an existing emoji is idempotent.
Emoji are NFC-normalised, 1–16 code points, at most 64 UTF-16 units, contain no
whitespace, ASCII letters or digits, and must contain a known pictographic or
symbol range.

Transport and ordering:

- A fresh send creates one control rumor per operation with one `p` tag per
  current member and the sender. It is sealed and gift-wrapped separately for
  each recipient and published to their kind-10050 inbox relays.
- The outbox holds one retry row per recipient and may rewrap a row for that
  recipient. Rows addressed to a member who is now removed are dropped for social
  payloads; membership removal notices are never dropped this way.
- Comment edits/deletes and reaction state use last-writer-wins ordering by
  `(at, opId)`. A create never overwrites a newer edit or delete. An edit or
  delete that arrives before its create is stored as a hidden placeholder until
  the create fills the missing metadata.
- A deleted comment keeps its author, timestamps and replies; the body is
  cleared. Reactions on deleted comments are hidden.
- When the target vlog or comment is already known, it must belong to the
  payload's circle and vlog. Unknown targets are stored until they arrive.
- Owner removal controls are delivered to the removed member and every remaining
  member. A remaining member applies the owner-signed snapshot as a roster
  update when its version is newer; the removed member receives the normal
  self-removal receipt.
- A create that arrives for a placeholder created by a different author replaces
  that placeholder and clears its forged edit/delete state.
- Inbound social controls are accepted only when the local circle exists, the
  viewing identity is `active` or `invited`, and the sender is `active` or
  `invited`. Prior content from a later-removed member stays visible; new
  controls from that member are ignored.
- New members do not receive old thread history. Only interactions created while
  they are current members are delivered.
- Unknown control types are still ignored by `parseControlPayload`, so older
  clients simply do not show social activity.

## Inbox history and pagination

The inbox still queries `kind: 1059` gift wraps addressed to the identity. Each
relay is queried separately with a limit of 500 and its own `until` cursor, so a
relay that returns a different range cannot cause another relay's events to be
skipped. A relay is complete only when it returns an empty page (or reaches the
`since` bound). Timeouts and connection failures mark it incomplete for the sync
and do not advance its cursor; successful pages advance the cursor until empty.

Backfill and incremental windows keep separate per-relay cursors and completion
flags in `inbox_relay_state`. Initial backfill pages backwards with a 15-second
budget; later syncs fetch a 3-day overlapping incremental window because NIP-59
randomises gift-wrap timestamps by up to two days. A relay that needs more than
the page budget resumes on the next sync. `inbox_sync_state.last_sync_at` only
advances when the incremental pass completes for every relay, independently of
backfill progress. Fetched wraps are deduplicated globally by rumor id before
names, membership, invitation, roster, social and file processing.

## Notifications

Notifications are entirely device-local. Folio does not publish a notification
event, does not add a relay payload, and does not exchange push tokens. The same
`kind: 1059` inbox sync that applies moments, invitations, membership transitions
and social controls produces local notification copy after those transitions are
durable. No new protocol message is introduced.

Social activity is also materialized locally in the `activity` table for the
in-app Inbox. Activity is new-only: it is recorded when a received comment or
reaction newly applies after the initial backfill. Notification routing for a
reply, comment or reaction uses `/vlog/<local-id>?comments=1` so the conversation
opens expanded. Comment bodies are not copied into notification text. Per-circle
mute suppresses every notification family for that circle and hides its Inbox
activity while muted; the circle's moments remain visible in Updates.

## FOLIO-FC1

```
Header (28 bytes)
 0..7    magic  "FOLIOFC1"
 8       version = 1
 9       flags = 0
 10..11  reserved = 0
 12..15  chunkSize (u32be)        16 KiB .. 16 MiB, default 4 MiB
 16..19  chunkCount (u32be)
 20..27  nonceBase (8 random bytes)

Chunk, repeated chunkCount times
  u32be plaintextLength
  ciphertext (plaintextLength bytes)
  16-byte GCM tag

Empty file: 28-byte header, chunkCount = 0, no chunks.
```

- nonce = `nonceBase || u32be chunkIndex` (12 bytes)
- AAD = `header || u64be chunkIndex || finalFlag(1) || u32be plaintextLength`
  (37 bytes)
- final chunk is the last chunk index, even if it is full-sized.
- trailing bytes after the last chunk are an error.
- every chunk is exactly `chunkSize` bytes except the last.
- the ciphertext is hashed as a whole (SHA-256) and the hash is pinned.

Implemented in `src/lib/crypto/chunkedFile.ts`; tested in
`tests/fc1.test.ts` (round trip, empty file, partial reads, nonce uniqueness,
wrong key, bit flips, header tamper, reordering, dropped chunk, trailing data,
truncation).

## Blossom usage

Upload authorization token (`kind: 24242`):

```json
{
  "kind": 24242,
  "tags": [
    ["t", "upload"],
    ["expiration", "<now + 900>"],
    ["server", "blossom.example.com"],
    ["x", "<sha256 of ciphertext>"]
  ],
  "content": "Upload Blob"
}
```

Header: `Authorization: Nostr <base64url(JSON(event))>`.

Upload request:
`PUT /upload` with `Content-Type: application/octet-stream`, `X-SHA-256`,
`Content-Length`. The returned descriptor is validated: `sha256` must equal the
local hash, `size` must match, URL must be http(s), then `HEAD` confirms the
blob exists with the expected length.

Preflight (`HEAD /upload`) sends `X-SHA-256`, `X-Content-Length`,
`X-Content-Type`; a `402`/`413` is shown to the user as the provider's own
`X-Reason`.

Provider selection: the chosen server is tried first, then the remaining presets
in `src/constants/providers.ts`. Uploads fall back on transport/TLS failures,
HTTP `5xx` and a failed blob verification. Each candidate gets its own BUD-11
token because the `server` tag is origin-bound. An HTTP `4xx` is returned to the
user and is not retried against a different provider.

Mirroring: after the primary copy verifies, every other preset is asked to copy
the ciphertext server-side. Two equivalent endpoints are supported:

- BUD-04: `PUT /mirror` with `{ "url": "<primary blob url>" }`.
- BUD-13: `POST /<sha256>` with the primary URL as plain text.

Both use a BUD-11 `upload` token with the ciphertext in an `x` tag and the
destination host in a `server` tag; the destination pulls the blob and stores
the exact bytes. The phone never re-uploads the blob. Mirror failures
(transport, TLS, unsupported endpoint, policy, verification) are ignored, and
only verified copies are included in `mirrors`. Publish → Advanced exposes an
on/off toggle, persisted as `media.mirrorCopies`, and mirroring to all servers
is on by default.

Recipient-assisted mirroring: when a recipient opens a moment and the
`media.recipientMirror` setting is on, the recipient's device sends the same
mirror requests to every reachable provider that does not already have the
clip. The request is signed with the recipient's identity, so the copy belongs
to the recipient and may count against their provider quota. Successful URLs
are merged into `clips.mirrors` on that device; other recipients are not
notified.

## Relay policy

Bootstrap relays are in `src/lib/nostr/relays.ts`. They are ordinary public
relays; availability is not guaranteed and NIP-42 AUTH support varies. Folio
authenticates when challenged, publishes to every configured read/write relay,
and reports success only if at least one relay accepts an event.

Relay subscriptions only live while the app is running. No claim is made about
delivery after Android kills the process.
