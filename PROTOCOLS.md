# Protocols

Folio speaks Nostr for events and Blossom for blobs. This file records exactly
what is implemented, what is extended, and what is intentionally not used.

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
  "mirrors": ["optional urls"]
}
```

Compatibility: a generic NIP-17 client can see a file message, but cannot
decrypt FC1 because the key decrypts chunks, not the whole container. Folio does
not pretend otherwise.

## Circle control messages

Circle state is application-level. Invitations and acceptances travel as
NIP-17 `kind: 14` rumors with a `folio-control` tag, so relays only see gift
wraps. They are never public events.

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
- invitations are deduplicated by (circle, owner, membership version).

On acceptance the member creates the circle locally and sends an acceptance to
the owner. Acceptance delivery is best-effort, but the owner already authorized
the invite, and post keys are delivered to both `invited` and `active` members,
so a lost acceptance cannot lock the invitee out of future posts. Previously
published media is not redistributed.

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

## Relay policy

Bootstrap relays are in `src/lib/nostr/relays.ts`. They are ordinary public
relays; availability is not guaranteed and NIP-42 AUTH support varies. Folio
authenticates when challenged, publishes to every configured read/write relay,
and reports success only if at least one relay accepts an event.

Relay subscriptions only live while the app is running. No claim is made about
delivery after Android kills the process.
