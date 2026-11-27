import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NO_TRUSTED_PROVIDER,
  classifyBlossomError,
  describeBlossomError,
  extractBlossomDetail,
} from '../src/lib/blossom/errors';
import { BlobDescriptorError, parseBlobDescriptor } from '../src/lib/blossom/mirror';
import {
  buildMirrorCandidates,
  buildProviderCandidates,
  buildRecipientMirrorTargets,
  mergeMirrorUrls,
} from '../src/lib/blossom/selection';

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

test('mirror candidates can target every other provider', () => {
  const presets = [
    'https://nostr.download',
    'https://blossom.yakihonne.com',
    'https://blossom.ditto.pub',
    'https://blossom.data.haus',
  ];
  assert.deepEqual(
    buildMirrorCandidates(
      'https://blossom.data.haus',
      'https://nostr.download',
      presets,
      Number.POSITIVE_INFINITY
    ),
    ['https://nostr.download', 'https://blossom.yakihonne.com', 'https://blossom.ditto.pub']
  );
});

test('recipient mirror targets skip the primary and known copy origins', () => {
  const providers = [
    'https://nostr.download',
    'https://blossom.yakihonne.com',
    'https://blossom.ditto.pub',
    'https://blossom.data.haus',
  ];
  assert.deepEqual(
    buildRecipientMirrorTargets('https://blossom.data.haus/blob.fc1', [], providers),
    ['https://nostr.download', 'https://blossom.yakihonne.com', 'https://blossom.ditto.pub']
  );
  assert.deepEqual(
    buildRecipientMirrorTargets(
      'https://blossom.data.haus/blob.fc1',
      ['https://blossom.yakihonne.com/blob.fc1', 'https://blossom.ditto.pub/blob.fc1'],
      providers
    ),
    ['https://nostr.download']
  );
  assert.deepEqual(
    buildRecipientMirrorTargets(
      'https://blossom.data.haus/blob.fc1',
      [],
      ['https://blossom.data.haus', 'https://blossom.data.haus/', 'https://nostr.download']
    ),
    ['https://nostr.download']
  );
});

test('recipient mirror targets reject unusable primaries', () => {
  const providers = ['https://nostr.download', 'https://blossom.ditto.pub'];
  assert.deepEqual(buildRecipientMirrorTargets('not a url', [], providers), []);
  assert.deepEqual(buildRecipientMirrorTargets('http://nostr.download/blob', [], providers), []);
  assert.deepEqual(buildRecipientMirrorTargets('https://127.0.0.1/blob', [], providers), []);
});

test('merge mirror urls keeps existing copies first and dedupes by origin', () => {
  assert.deepEqual(
    mergeMirrorUrls(
      ['https://nostr.download/blob.fc1'],
      ['https://blossom.ditto.pub/blob.fc1', 'https://nostr.download/other.fc1']
    ),
    ['https://nostr.download/blob.fc1', 'https://blossom.ditto.pub/blob.fc1']
  );
  assert.deepEqual(
    mergeMirrorUrls([], [
      'https://nostr.download/a',
      'https://blossom.ditto.pub/b',
      'https://blossom.data.haus/c',
      'https://blossom.yakihonne.com/d',
      'https://blossom.hyperbolic.xyz/e',
    ]),
    ['https://nostr.download/a', 'https://blossom.ditto.pub/b', 'https://blossom.data.haus/c', 'https://blossom.yakihonne.com/d']
  );
});

test('merge mirror urls drops non-public and non-https entries', () => {
  assert.deepEqual(
    mergeMirrorUrls([], ['http://nostr.download/a', 'https://127.0.0.1/b', 'https://localhost/c', 'not a url', '']),
    []
  );
});

test('blob descriptor parser validates hash, size and URL', () => {
  const sha256 = 'a'.repeat(64);
  const valid = JSON.stringify({ url: 'https://blossom.data.haus/blob.fc1', sha256, size: 42, type: 'application/octet-stream' });
  assert.deepEqual(parseBlobDescriptor(valid, { sha256, size: 42 }), {
    url: 'https://blossom.data.haus/blob.fc1',
    sha256,
    size: 42,
    type: 'application/octet-stream',
  });

  assert.throws(
    () => parseBlobDescriptor(JSON.stringify({ url: 'https://x.test/a', sha256: 'b'.repeat(64), size: 42 }), { sha256 }),
    BlobDescriptorError
  );
  assert.throws(
    () => parseBlobDescriptor(JSON.stringify({ url: 'https://x.test/a', sha256, size: 41 }), { sha256, size: 42 }),
    BlobDescriptorError
  );
  assert.throws(
    () => parseBlobDescriptor(JSON.stringify({ url: 'javascript:alert(1)', sha256, size: 42 }), { sha256 }),
    BlobDescriptorError
  );
  assert.throws(
    () => parseBlobDescriptor(JSON.stringify({ url: 'http://nostr.download/a', sha256, size: 42 }), { sha256 }),
    BlobDescriptorError
  );
  assert.throws(
    () => parseBlobDescriptor(JSON.stringify({ url: 'https://127.0.0.1/a', sha256, size: 42 }), { sha256 }),
    BlobDescriptorError
  );
  assert.throws(
    () => parseBlobDescriptor(JSON.stringify({ url: 'https://localhost/a', sha256, size: 42 }), { sha256 }),
    BlobDescriptorError
  );
  assert.throws(() => parseBlobDescriptor('not json', { sha256 }), BlobDescriptorError);
});

test('blob descriptor parser falls back to the expected size', () => {
  const sha256 = 'c'.repeat(64);
  assert.equal(
    parseBlobDescriptor(JSON.stringify({ url: 'https://x.test/a', sha256 }), { sha256, size: 7 }).size,
    7
  );
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
