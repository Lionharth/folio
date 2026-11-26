import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NO_TRUSTED_PROVIDER,
  classifyBlossomError,
  describeBlossomError,
  extractBlossomDetail,
} from '../src/lib/blossom/errors';
import { buildMirrorCandidates, buildProviderCandidates } from '../src/lib/blossom/selection';

const ANDROID_TLS =
  "Call to function 'FileSystemUploadTask.start' has been rejected. " +
  'Caused by: Unable to upload a file: java.security.cert.CertPathValidatorException: ' +
  'Trust anchor for certification path not found.';

test('provider candidates try the selected server first and keep preset order', () => {
  const candidates = buildProviderCandidates('https://blossom.ditto.pub', [
    'https://nostr.download',
    'https://blossom.yakihonne.com',
    'https://blossom.ditto.pub',
    'https://blossom.data.haus',
  ]);
  assert.deepEqual(candidates, [
    'https://blossom.ditto.pub',
    'https://nostr.download',
    'https://blossom.yakihonne.com',
    'https://blossom.data.haus',
  ]);
});

test('provider candidates dedupe trailing slashes and keep an unknown selection', () => {
  const candidates = buildProviderCandidates('https://cdn.example.test///', [
    'https://cdn.example.test',
    'https://nostr.download/',
    'https://nostr.download',
  ]);
  assert.deepEqual(candidates, ['https://cdn.example.test', 'https://nostr.download']);
});

test('mirror candidates exclude the provider that stored the primary copy', () => {
  const presets = [
    'https://nostr.download',
    'https://blossom.yakihonne.com',
    'https://blossom.ditto.pub',
  ];
  assert.deepEqual(
    buildMirrorCandidates('https://blossom.ditto.pub', 'https://blossom.ditto.pub', presets, 1),
    ['https://nostr.download']
  );
  assert.deepEqual(
    buildMirrorCandidates('https://blossom.ditto.pub', 'https://blossom.ditto.pub', presets, 2),
    ['https://nostr.download', 'https://blossom.yakihonne.com']
  );
});

test('mirror candidates follow preset order after a fallback and dedupe by origin', () => {
  const presets = [
    'https://nostr.download/',
    'https://blossom.yakihonne.com',
    'https://blossom.yakihonne.com/',
    'https://blossom.data.haus',
  ];
  assert.deepEqual(
    buildMirrorCandidates('https://blossom.yakihonne.com', 'https://blossom.data.haus', presets, 3),
    ['https://blossom.data.haus', 'https://nostr.download']
  );
});

test('mirror candidates handle zero or unusable primaries', () => {
  const presets = ['https://nostr.download', 'https://blossom.ditto.pub'];
  assert.deepEqual(buildMirrorCandidates('https://nostr.download', 'https://nostr.download', presets, 0), []);
  assert.deepEqual(buildMirrorCandidates('not a url', 'https://nostr.download', presets, 1), []);
  assert.deepEqual(buildMirrorCandidates('https://nostr.download', 'https://nostr.download', [
    'https://nostr.download',
  ]), []);
});

test('Android trust-anchor failures classify as tls', () => {
  assert.equal(classifyBlossomError(new Error(ANDROID_TLS)), 'tls');
  assert.equal(classifyBlossomError(new Error('javax.net.ssl.SSLHandshakeException: Handshake failed')), 'tls');
  assert.equal(classifyBlossomError(new Error('Hostname blossom.example.test not verified')), 'tls');
  assert.equal(classifyBlossomError(new Error('self-signed certificate in certificate chain')), 'tls');
  assert.equal(classifyBlossomError(new Error('java.security.cert.CertPathValidatorException: timestamp check failed')), 'tls');
});

test('DNS and connection failures classify as transport', () => {
  assert.equal(classifyBlossomError(new Error('java.net.UnknownHostException: nostr.download')), 'transport');
  assert.equal(classifyBlossomError(new Error('java.net.SocketTimeoutException: timeout')), 'transport');
  assert.equal(classifyBlossomError(new Error('TypeError: Network request failed')), 'transport');
  assert.equal(classifyBlossomError(new Error('AbortError: Aborted')), 'transport');
});

test('unrelated failures stay unknown', () => {
  assert.equal(classifyBlossomError(new Error('Upload rejected (HTTP 413)')), 'unknown');
  assert.equal(classifyBlossomError(''), 'unknown');
});

test('describeBlossomError returns short copy without java frames', () => {
  const tls = describeBlossomError(new Error(ANDROID_TLS), 'nostr.download');
  assert.equal(tls, 'nostr.download is not trusted by this phone.');
  assert.doesNotMatch(tls, /CertPathValidatorException|FileSystemUploadTask/);

  assert.equal(describeBlossomError(new Error('UnknownHostException'), 'nostr.download'), 'Could not reach nostr.download.');
  assert.equal(NO_TRUSTED_PROVIDER.startsWith('No storage provider is trusted'), true);
});

test('extractBlossomDetail keeps the raw cause for diagnostics and is bounded', () => {
  const detail = extractBlossomDetail(new Error(ANDROID_TLS));
  assert.match(detail, /CertPathValidatorException/);
  assert.equal(extractBlossomDetail(new Error('x'.repeat(400))).length, 240);
});
