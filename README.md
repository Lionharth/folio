# Folio

**Life, as it happens.**

A private video diary for friends. Folio is an Expo/React Native app that keeps
everyday video clips inside small, private circles — encrypted on the device,
stored on third-party Blossom servers, with keys delivered over Nostr.

No developer-operated backend. No follower counts. No algorithmic feed.

---

## Status

| Phase | State |
| --- | --- |
| 0 — Repository inspection and feasibility research | Done (see the docs below) |
| 1 — Encrypted video sharing proof of concept | **Passed on the emulator** with two identities, real relays and a real Blossom provider |
| 2 — Application foundation (design system, onboarding, DB, identity) | Implemented |
| 3 — Circles | Creation, private encrypted invitations, acceptance, invited/active states, roles stored, mute, membership version, removal; no signed multi-owner membership history |
| 4 — Video creation and sharing | Single-clip publish works end to end; multi-clip data model and sequential player exist; camera UI implemented but not exercised |
| 5 — Feed and archive | Chronological feed, circle filter, unread, archive search/favourites |
| 6 — Reactions and comments | Implemented: encrypted vlog/comment reactions, one-level threads, author edit/delete, per-relay social restore, owner removal propagation; local best-effort notifications, no remote push |
| 7 — Reliability, notifications, recovery | Partial: recovery key export/import, provider preflight, local best-effort notifications with periodic background inbox checks; no remote push, no background upload |

The README is deliberately blunt: this is an early build. See
[DEVELOPMENT.md](./DEVELOPMENT.md) for what has and has not been executed on a
device.

## What works end to end

1. Create an identity (Nostr keypair) without knowing what Nostr is.
2. Create a private circle, invite a member by npub, and let it appear on their device after they accept.
3. Record a clip or import one from the library.
4. Encrypt it locally into the FOLIO-FC1 container (AES-256-GCM, chunked).
5. Upload the ciphertext to a Blossom provider with BUD-11 authorization.
6. Gift-wrap the media key to each member with NIP-17/NIP-44/NIP-59.
7. Receive, verify, decrypt and play the clip on the recipient identity.
8. Browse a strictly chronological updates feed and a searchable archive.
9. See friends by name, learned privately from encrypted messages, with an npub fallback.

### Verified in this build

A 187,118-byte H.264 clip published from identity A to a circle containing
identity B:

- uploaded blob: 187,166 bytes, begins `FOLIOFC1`, one 4 MiB chunk, SHA-256
  `2f5d63711664394865e20a52ea8954376c6e9120210a96f782d0a35b6bd5683d`
  (matches the pinned hash), no `ftyp` box — i.e. ciphertext, not an MP4;
- provider: `https://nostr.download`;
- identity B received the NIP-17 message, downloaded the blob, verified both
  hashes, decrypted it and played the video;
- B's decrypted copy is a separate file in its own cache, and the database rows
  are scoped per identity (`viewer_pubkey`), so A's local copy was not reused.

Comments and reactions now work end to end in the unit and data layers; their
device-to-device sync still needs physical-device validation. Local best-effort
notifications and periodic background inbox checks are implemented; remote push,
resumable background uploads, and encrypted cloud backups are not.

## Quick start

```bash
npm install
npm run typecheck
npm run lint
npm test
npx expo run:android
```

Local Android builds on Windows must live at a short path; see
[DEVELOPMENT.md](./DEVELOPMENT.md#windows-and-onedrive).

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — layers, data flow, local schema
- [SECURITY.md](./SECURITY.md) — threat model, encryption, key lifecycle, limits
- [PROTOCOLS.md](./PROTOCOLS.md) — Nostr/Blossom usage and the FOLIO-FC1 format
- [PROVIDERS.md](./PROVIDERS.md) — measured Blossom behaviour
- [DEVELOPMENT.md](./DEVELOPMENT.md) — environment, commands, build notes
- [FEASIBILITY.md](./FEASIBILITY.md) — Phase 1 experiments, evidence and go/no-go
- [CHANGELOG.md](./CHANGELOG.md) — what changed, with test results

## Design

Cinematic editorial: Cormorant Garamond for the wordmark and editorial titles;
Manrope for functional UI. Large media covers, strong scale contrast and quiet
metadata replace generic feed rows. Updates is a finite unread inbox; Archive is
the complete chronological history. Four tabs (Updates, Circles, Archive,
Profile) surround a central full-screen Create action.

The launcher icon is the serif "f" (`assets/images/icon.png`); the Android
adaptive foreground and monochrome layers are derived from it. The splash screen
shows the serif lowercase `folio` wordmark in light and dark variants
(`assets/images/splash-wordmark*.png`). Regenerate these assets with
`npm run brand:assets`. Warm paper, ink-black primary, no decorative accent
colours, 24 dp margins and a 4 dp spacing scale. Light and dark themes are
designed separately, while the layered video viewer deliberately uses an
always-dark cinema surface in both. Player/sheet motion has reduced-motion
alternatives. All visual and motion tokens live in `src/theme/tokens.ts`.

## Licence

Code is unlicensed pending a decision. Bundled fonts: Cormorant Garamond and
Manrope under the SIL Open Font License 1.1.
