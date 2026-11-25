# Providers

Folio does not run media storage. These measurements come from
`scripts/provider-probe.ts` and `scripts/limits-probe.ts`, executed on
2026-11-24 from a Windows host in Central Europe against fresh random blobs
(opaque bytes with no media structure). Results are a snapshot, not a promise.

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

## Retention and reliability

- None of the tested providers documents a guarantee of permanence. yakihonne's
  limit is explicit; retention policy is not.
- `Sunset` headers were not observed on downloads. Absence is not a guarantee.
- Uploads are not resumable with BUD-02; a dropped upload restarts. The app
  retries at the job level in a future milestone.
- Folio should mirror ciphertext when it can: the `clips.mirrors` column exists,
  but automatic mirroring is not implemented.

## Reproducing

```bash
npx tsx scripts/provider-probe.ts --servers https://nostr.download,https://blossom.yakihonne.com --size 26214400
npx tsx scripts/limits-probe.ts
```

Both scripts generate a throwaway Nostr key, sign real BUD-11 tokens, upload
real random bytes, verify the returned hash by downloading, and attempt
`DELETE`. They do not touch Folio user data.
