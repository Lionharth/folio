# Providers

Folio does not run media storage. These measurements come from
`scripts/provider-probe.ts`, `scripts/limits-probe.ts` and
`scripts/mirror-probe.ts`, executed on 2026-11-24 (mirror probe 2026-11-27)
from a Windows host in Central Europe against fresh random blobs (opaque bytes
with no media structure). Results are a snapshot, not a promise.

## Why this matters

Blossom servers are built for media. Several of them sniff the bytes and reject
anything that does not look like an allowed image/video type. An encrypted blob
looks like random noise, so a provider that "supports Blossom" may still refuse
Folio's ciphertext.

## Working providers (accepted opaque ciphertext)

| Server | BUD-02 upload | BUD-06 preflight | 64 KiB round trip | 25 MiB round trip | Observed size policy |
| --- | --- | --- | --- | --- | --- |
| `https://nostr.download` | 201 | 200 | 335 ms up / 229 ms down | 3.0 s up / 2.7 s down | preflight accepted 500 MB |
| `https://blossom.yakihonne.com` | 201 | 200 | 1.43 s up / 1.08 s down | 3.8 s up / 3.5 s down | `413` above 209,715,200 bytes (200 MiB) |
| `https://blossom.ditto.pub` | 201 | 200 | 703 ms up / 1.09 s down | not tested | preflight accepted 500 MB |
| `https://blossom.data.haus` | 201 | 200 | 111 ms up / 183 ms down | not tested | preflight accepted 500 MB |

All four returned a descriptor whose `sha256` and `size` matched the uploaded
bytes, served the blob back with the same hash, and accepted `DELETE`.
`nostr.download` and `ditto` return a file extension on the URL; Yakihonne and
data.haus return hash-only URLs.

Default provider in the app: `https://nostr.download`. Yakihonne is the
recommended fallback because it advertises a concrete 200 MiB limit.

## Providers that rejected opaque ciphertext

| Server | Behaviour |
| --- | --- |
| `https://blossom.primal.net` | `415 unsupported media type application/octet-stream` on `PUT`; preflight returns `200` for every size, so preflight is not trustworthy here |
| `https://blossom.band` | `415 File type not allowed` for opaque bytes; also `400 Content-Type does not match the file content` when claiming `video/mp4`; `413` above 100 MiB |
| `https://blossom.nostr.build` | `415 File type not allowed`; `413` above 100 MiB |
| `https://cdn.nostrcheck.me` | `400 file type not detected or not allowed` |
| `https://blossom.psbt.me` | Accepts opaque bytes but `402 Payment required for files over 1 MiB`; `413` above the paid ceiling. Good candidate if a user pays. |
| `https://cdn.satellite.earth` | `401 Permission denied: blossom.upload required`; preflight `404`; one request took 151 s |
| `https://blossom.hzrd149.com` | `405` on `/upload` |
| `https://blossom.oxtr.dev` | Preflight `401 Invalid base64 encoding`; upload `500` |
| `https://blossom.utxo.one` | `502` |

Servers that failed DNS/TLS from this host: `files.v0l.io`,
`media.nostr.band`, `blossom.sovbit.host`, `blossom.nostr.moe`,
`blossom.coracle.social`, `blossom.stemstr.app`, `cdn.sovbit.host`,
`blossom.bitcoiner.social`, `blossom.nostrcheck.me`. They may work elsewhere;
they are not shipped as defaults.

## Size limits

`HEAD /upload` (BUD-06) is cheap and returns policy decisions without a body:

| Server | 1 MB | 10 MB | 50 MB | 100 MB | 500 MB |
| --- | --- | --- | --- | --- | --- |
| nostr.download | 200 | 200 | 200 | 200 | 200 |
| blossom.yakihonne.com | 200 | 200 | 200 | 200 | 413 "Maximum allowed size is 209715200 bytes" |
| blossom.psbt.me | 200 | 402 | 402 | 402 | 413 |
| blossom.ditto.pub | 200 | 200 | 200 | 200 | 200 |
| blossom.data.haus | 200 | 200 | 200 | 200 | 200 |
| blossom.primal.net | 200 | 200 | 200 | 200 | 200 (but uploads of opaque bytes fail) |
| blossom.band | 415 | 415 | 415 | 415 | 413 "maximum allowed size of 100 MiB" |

Preflight is advisory: primal answers `200` and then rejects the actual upload.
Folio always treats the `PUT` response as authoritative and verifies the stored
blob afterwards.

## Authentication

All working providers accepted BUD-11 `kind: 24242` tokens with `t=upload`,
`expiration` and `server` tags; none required payment for the tested sizes on
nostr.download, Yakihonne, Ditto or data.haus. psbt.me requires payment above
1 MiB. No provider required an account in these tests.

## Server-side mirroring (BUD-04 / BUD-13)

Probed on 2026-11-27 with `scripts/mirror-probe.ts`: one throwaway identity
uploads a 4 KiB random blob to `nostr.download`, then a **different** identity
asks each other server to mirror it. This is the recipient-assisted case, where
the mirror signer is not the uploader.

| Server | `OPTIONS /mirror` | `OPTIONS /<sha256>` | Mirror with non-uploader token |
| --- | --- | --- | --- |
| `nostr.download` | 200 `PUT` | 200 `GET,HEAD,PUT,DELETE,OPTIONS` (no POST) | **201** via BUD-04 |
| `blossom.yakihonne.com` | 403 | 204 `GET,HEAD,PUT,DELETE,OPTIONS` (no POST) | unsupported |
| `blossom.ditto.pub` | 204 `GET,HEAD,PUT,DELETE` | 204 `GET,HEAD,PUT,DELETE` (no POST) | **201** via BUD-04 |
| `blossom.data.haus` | 204 `GET,HEAD,PUT,DELETE,OPTIONS` | 204 `GET,HEAD,PUT,DELETE,OPTIONS` | **200** via BUD-04 |

Yakihonne does not advertise mirroring, so Folio skips it. The other three
accept a `PUT /mirror` signed by a key that did not upload the blob and return a
verified descriptor. No tested server required the original uploader's key.
`nostr.download` was probed as a destination from a `data.haus` origin, which is
the school-Wi-Fi case (only one provider reachable for the upload).

## Retention and reliability

- None of the tested providers documents a guarantee of permanence. yakihonne's
  limit is explicit; retention policy is not.
- `Sunset` headers were not observed on downloads. Absence is not a guarantee.
- Uploads are not resumable with BUD-02; a dropped upload restarts. The app
  retries at the job level in a future milestone.
- Folio asks every other preset to mirror the ciphertext server-side by default:
  after the primary verifies, each destination pulls the blob via BUD-04 (or
  BUD-13 when advertised). The copy is best-effort, encrypted with the same key,
  and listed in the key payload so recipients can fall back. It can be turned
  off per device in Create → Advanced. When the author's network blocks a
  provider, a recipient who can reach it can ask for the copy when opening the
  moment (`media.recipientMirror`, on by default).

## TLS trust (Android)

Android validates the certificate chain exactly as the server sends it and does
not fetch missing intermediates. A Windows or browser probe can therefore pass
via AIA while the Android client fails with
`CertPathValidatorException: Trust anchor for certification path not found`.
That is a provider-side chain problem, not an upload bug.

As of 2026-11-26 the newest `nostr.download` leaf in CT logs (issuer Let's
Encrypt `CN=YR2`) expired 2026-11-23, no newer issuance was indexed, and the
host did not answer an IPv6 TLS check. The measurements above predate that, and
the app now falls back to another preset when it happens. Verify a preset from
Android before trusting it:

```bash
openssl s_client -connect nostr.download:443 -servername nostr.download -showcerts
```

Check the leaf `notAfter` and confirm the issuing intermediate is included in the
output. Provider probes should be re-run from an Android device or emulator, not
only from a Windows host.

## Reproducing

```bash
npx tsx scripts/provider-probe.ts --servers https://nostr.download,https://blossom.yakihonne.com --size 26214400
npx tsx scripts/limits-probe.ts
npx tsx scripts/mirror-probe.ts
```

Both scripts generate a throwaway Nostr key, sign real BUD-11 tokens, upload
real random bytes, verify the returned hash by downloading, and attempt
`DELETE`. They do not touch Folio user data.
