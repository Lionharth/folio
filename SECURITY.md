# Security

This document describes what Folio does, what it does not do, and where the
sharp edges are. Nothing here is a claim of production-grade review.

## Threat model

Assets:
- Identity secret keys (Nostr signing keys).
- Per-clip media keys.
- Plaintext video, titles, captions and circle membership.
- The social graph: who shares with whom.

Adversaries considered:
- **Relay operators** — can read event envelopes, timestamps, connection
  metadata, and may keep anything published. They must not learn message
  contents, media keys, titles or circle membership.
- **Storage providers** — receive ciphertext blobs. They must not be able to
  decrypt or view video content. They can observe file sizes, upload times, IP
  addresses, and the hash-addressed URL.
- **A removed circle member** — must not receive keys for future posts. Cannot
  be prevented from keeping what they already downloaded.
- **A network attacker** — TLS plus authenticated encryption. Gift wraps and
  Blossom calls use HTTPS/WSS. Certificate pinning is not implemented.
- **A thief with the unlocked device** — out of scope; app-level biometric lock
  is not implemented. Android's own device encryption applies.

Out of scope: a compromised OS, a malicious keyboard, screenshots, an attacker
who obtains the user's recovery key, and global traffic correlation.

## Cryptographic choices

| Purpose | Primitive | Implementation |
| --- | --- | --- |
| Identity signatures | secp256k1 Schnorr | `nostr-tools/pure` (@noble/curves) |
| Message encryption | NIP-44 v2 (ChaCha20 + HMAC-SHA256) | `nostr-tools/nip44` |
| Key wrapping | NIP-59 seal + gift wrap | `nostr-tools/nip59` |
| Media encryption | AES-256-GCM, 16-byte tag | `expo-crypto` native AES |
| Media randomness | CSPRNG | `expo-crypto` `getRandomBytes` |
| File hashing | SHA-256 | native `File.digest` |

AES keys are created with the platform backend (Android Conscrypt/JCE). Keys
are handed to the module as bytes, used, and not retained globally in JS.

## FOLIO-FC1

A chunked container for large files. Full layout in
[PROTOCOLS.md](./PROTOCOLS.md#folio-fc1). Security properties:

- 28-byte header: magic, version, flags, chunk size, chunk count, 8-byte random
  nonce base. The header is additional authenticated data for every chunk.
- Nonce per chunk = `nonceBase (8) || u32be chunkIndex`. Unique per key as long
  as a file has fewer than 2^32 chunks and the nonce base comes from a CSPRNG.
- Per-chunk AAD includes the header, chunk index, final-chunk flag and plaintext
  length. Reordering, omission, duplication, truncation and trailing data all
  fail authentication.
- The complete ciphertext is SHA-256 hashed and that hash is pinned in the key
  message. Recipients verify it before decryption; the plaintext hash is
  verified after decryption.

**Honesty:** FC1 is an application-specific format implemented for Folio. It has
not been externally reviewed or fuzzed beyond the unit tests in `tests/fc1.test.ts`.
It is not a NIP and is not interoperable with generic NIP-17 file clients.

## Key lifecycle

1. Secret key generated on device at onboarding, stored in SecureStore
   (Android Keystore-backed encryption).
2. Media key generated per clip, stored in SecureStore under the clip id.
3. Media key delivered to each active member and the sender inside a NIP-59
   gift wrap; the rumor is NIP-44 encrypted, so the key is never plaintext on a
   relay.
4. Removal from a circle increments `membership_version`; future keys are not
   sent to the removed member. **No re-encryption of history is performed.**
5. There is no forward secrecy and no post-compromise security for media keys.
   A leaked media key decrypts every chunk of that clip, forever.
6. Deleting an identity removes its SecureStore entries; it does not revoke
   anything already published.

Key rotation for a circle (shared circle key) is not implemented. Each clip has
its own key and is distributed individually, which is simpler and avoids a
shared group secret, at the cost of one message per member per clip.

## Metadata exposure

Even with correct encryption, the following leaks:

- Gift wrap `p` tags reveal which recipient has a message waiting (NIP-59
  randomizes authorship and timestamps, but the envelope must name a recipient).
- Relays see connection times, IPs, subscription filters and event sizes.
- Blossom servers see blob sizes, upload/download times, IPs, and the SHA-256 of
  the ciphertext. Identical plaintext encrypted with different keys produces
  different ciphertext.
- Key messages include a URL and hashes inside the encrypted payload; the relay
  cannot read them, but the storage provider can correlate a download with an
  IP.
- Circle names, titles and display names are only ever inside encrypted payloads
  or local SQLite, never in public events. Folio does not fetch names from
  public kind-0 metadata; names are learned from encrypted control messages and
  key messages and cached in `contact_profiles`.
- A name is self-asserted by the sender inside an authenticated gift wrap. It
  proves which key claims the name, not that the human is who the name suggests.
  Circle membership is the trust signal.
- Comment and reaction text is encrypted inside NIP-17 gift wraps. Relays still
  see how often a member posts, the approximate size of each control, which
  recipient keys have messages, and the timing of the fan-out.
- Every social operation creates one gift wrap per current member plus the
  sender, so circle size and activity volume are observable to relays.
- No anonymity claims are made.

## Membership authorization

The circle model is application-level, not relay-level. NIP-29 is not used.
Membership is local state in `circle_members` with roles and status, plus a
monotonic `membership_version`. The owner's device is authoritative for that
record. Invitations are delivered as encrypted NIP-17 control messages, which
gives the invited device a signed statement from the owner; there is still no
signed membership event that a second owner device can independently verify, so
multi-owner history remains a known gap.

Invitation rules:
- the invitation is dropped unless its `circle.ownerPubkey` equals the gift-wrap
  seal author (verified by `nostr-tools/nip59`), and the recipient is listed in
  `circle.members`;
- the invited member must explicitly accept in the UI before the circle appears
  in their list;
- removal increments `membership_version`, stops future keys, and never claims
  to erase downloaded media.

Social controls are accepted only when the local circle exists, the viewing
identity and the sender are `active` or `invited`, and, when the target is known
locally, it belongs to the same circle. Comment ids are author-scoped so a member
cannot create or suppress another author's comment by reusing its id.

Owner removal controls are delivered to the removed member and every remaining
member. A remaining member applies the owner-signed roster update, so a removed
member cannot keep posting to devices that have processed the removal. A removed
member cannot add new comments or reactions, and queued social rows addressed to
that member are dropped. Content already delivered stays on recipients' devices
and cannot be revoked.

Inbox pagination marks a relay complete only after an EOSE-backed empty page.
Relay timeouts and partial responses do not advance a cursor or mark history
complete, preventing a flaky first sync from permanently skipping old messages.

A member can only decrypt a clip if they receive its media key. Post keys are
sent to `active` and `invited` members: the owner already authorized the invite,
and this prevents a lost acceptance message from denying the invitee future
posts. Recipients verify the sender's signature on the seal and the rumor, so a
relay cannot forge a key message from another member.

## Storage provider risks

- Providers can reject, expire, rate-limit or silently drop blobs. Blossom does
  not promise permanence. Folio keeps the archive entry even if the blob is
  gone and surfaces playback failure.
- Some providers MIME-sniff and reject opaque ciphertext. See
  [PROVIDERS.md](./PROVIDERS.md); the app preflights and reports the provider's
  reason.
- Mirrors are supported at the data-model level (`clips.mirrors`) but no
  automatic mirroring is implemented.
- Uploaded blobs are not deleted if publishing fails after upload. This can
  leave orphaned ciphertext on a provider (unreadable without the key).

## Recovery

- The recovery key (nsec) can be revealed and copied from Profile. It is the
  only backup.
- No encrypted cloud backup, no recovery phrase, no social recovery. Android
  Auto Backup is **not** relied upon and was not verified.
- If the device is lost and the recovery key is lost, the identity and all media
  keys are unrecoverable. Folio cannot reset anything.
- Restoring an nsec on a new device restores the ability to receive new keys and
  to read gift wraps still stored on relays. It does **not** restore media keys
  for clips that were only stored on the old device, because media keys live in
  SecureStore and are not part of the nsec. This is a significant limitation
  that the future encrypted backup must fix by including media keys.

## Logging and errors

- Secret keys, media keys and decrypted payloads are never logged.
- Payload parsing rejects malformed values instead of coercing.
- Upload responses are treated as untrusted: the returned hash, size and URL
  are validated, and the blob is re-checked with `HEAD`.
- Downloads are hashed before decryption; a mismatch deletes the file.

## Known limitations

- Custom container format, not externally reviewed.
- No forward secrecy, no key rotation for existing clips.
- Media keys are device-bound; identity recovery alone cannot restore old media.
- No signed membership events shared across devices.
- No background upload after the app is killed.
- No remote push notifications and no push tokens. Notifications are local,
  generated on this device after an inbox sync; delivery is best-effort and
  depends on the OS running the background worker.
- Local notifications can expose circle names, author names, member names and
  reaction emoji on a locked screen and in notification history. Comment bodies
  are not included in notification copy. Notification payloads contain only a
  routing URL, never keys, media keys or plaintext content.
- No certificate pinning.
- No biometric lock.
- No fuzzing; unit tests cover framing/tamper cases but not the native AES
  backend.

Cryptographic designs must be reviewed before Folio is described as
production-ready.
