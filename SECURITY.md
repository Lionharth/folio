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
- Circle names and titles are only ever inside encrypted payloads or local
  SQLite, never in public events.
- No anonymity claims are made.

## Membership authorization

The circle model is application-level, not relay-level. NIP-29 is not used.
Membership is local state in `circle_members` with roles and status, plus a
monotonic `membership_version`. Today the owner's device is authoritative for
that local record. There is no signed membership event shared between devices
yet, so a second owner device cannot verify membership history. This is a
known gap, listed in the Phase 3/7 work.

A member can only decrypt a clip if they receive its media key. Recipients also
verify the sender's signature on the seal and the rumor, so a relay cannot
forge a key message from another member.

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
- No push notifications; relay subscriptions only work while the app runs.
- No certificate pinning.
- No biometric lock.
- No fuzzing; unit tests cover framing/tamper cases but not the native AES
  backend.

Cryptographic designs must be reviewed before Folio is described as
production-ready.
