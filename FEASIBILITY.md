# Phase 1 — Feasibility report

Date: 2026-11-25
Build: 0.1.0, Expo SDK 58.0.26, React Native 0.88.1, Android 16 x86_64 emulator

## Question

Can Folio share a private, end-to-end encrypted video between two independent
identities using only existing Nostr relays and existing Blossom servers, with
an Expo/React Native client, and without a developer-operated backend?

**Answer: yes, on the tested configuration.** The exit criterion was met, with
the caveat below that both identities ran on one emulator rather than two
physical devices.

## Method

1. Implemented identity generation, relay pool with NIP-42 AUTH, NIP-17/44/59
   messaging, a chunked AES-256-GCM container (FOLIO-FC1), BUD-11 auth, BUD-06
   preflight, BUD-02 upload and hash-verified download.
2. Probed nine candidate Blossom servers with real 64 KiB, 3 MiB and 25 MiB
   uploads, using fresh keys and real authorization tokens (`scripts/`).
3. Built a debug dev-client APK and a release APK, installed on the emulator.
4. Created identity A on the device, created a circle, added identity B (a
   separately generated key imported through the recovery flow), and published
   a 6-second H.264 clip from A.
5. Switched to B, synced the inbox, opened the post and played it.

## Evidence

| Check | Result |
| --- | --- |
| Identity A/B are independent | Distinct secp256k1 keys, distinct npubs |
| Relay publish | Gift wrap accepted by at least one public relay |
| Relay receive | B fetched the `kind: 1059` wrap and decrypted it |
| NIP-17 message | `kind: 15` rumor with `decryption-key`, `x`, `file-type`, `folio-key` |
| Plaintext is never uploaded | Uploaded blob starts with `FOLIOFC1`, has no `ftyp` box |
| Ciphertext hash | Downloaded blob SHA-256 equals the pinned hash |
| Authenticated encryption | Wrong key / bit flips / reordering / truncation rejected by 14 unit tests |
| Size overhead | 187,118 B plaintext → 187,166 B ciphertext (48 B framing for 1 chunk) |
| Download + decrypt | B produced a 187,118 B playable MP4 in its own cache |
| Playback | `expo-video` played the decrypted file |
| Per-identity isolation | DB rows keyed by `viewer_pubkey`; A's local copy not reused by B |
| Provider behaviour | 4 of 11 tested servers accepted opaque encrypted blobs |
| Build | Debug APK 89.5 MB; release APK 55.4 MB; both installed |

## Measurements

Working providers (opaque `application/octet-stream`):

- `nostr.download`: 25 MiB in 3.0 s, 25 MiB down in 2.7 s, preflight accepted
  500 MB.
- `blossom.yakihonne.com`: 25 MiB in 3.8 s, down in 3.5 s, hard limit
  209,715,200 B (200 MiB).
- `blossom.ditto.pub`, `blossom.data.haus`: 64 KiB round trips, preflight
  accepted 500 MB; 25 MiB not tested.

Rejected opaque blobs: primal (415), blossom.band (415/400), nostr.build (415),
nostrcheck (400), psbt.me (payment over 1 MiB), satellite.earth (paid account).

## Risks and limitations

1. **One device, two identities.** The protocol path is real (relays, HTTPS,
   encryption), but two physical devices were not available. Camera, thermal,
   battery, network switching and true cross-device delivery remain unverified.
2. **Custom container not reviewed.** FC1 is application-specific and has unit
   tests, not an external cryptographic review.
3. **Relay AUTH variance.** One relay rejected NIP-42 AUTH
   (`relay needs serviceUrl to be configured before AUTH can work`); delivery
   succeeded through other relays. Per-relay compatibility must be measured.
4. **Provider fragility.** Most Blossom servers sniff content and reject
   ciphertext. Four working servers are not a guarantee of retention. Mirroring
   is not implemented.
5. **Media key durability.** Keys live in SecureStore. Restoring an nsec on a new
   device does not restore old media keys; an encrypted key backup is required.
6. **No background delivery.** Uploads and inbox sync stop when the process dies.
   Push notifications are not implemented.
7. **Windows build friction.** Native builds require a short path and a CMake
   object-path override; see DEVELOPMENT.md. This affects the developer machine,
   not the product architecture.

## Decision

Proceed to Phase 2–5 work on this architecture. The risky assumptions —
encrypted blobs can be stored on third-party Blossom servers, keys can be
delivered with NIP-17, and `expo-video` can play a locally decrypted file — all
held.

Before a closed beta:

- validate on two physical Android devices, including camera recording;
- add an encrypted identity + media-key backup;
- add signed membership events shared between devices;
- implement job persistence and a native upload worker;
- test relay AUTH across at least five relays;
- mirror each blob to a second provider.
