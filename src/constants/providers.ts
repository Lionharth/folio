export interface ProviderPreset {
  url: string;
  name: string;
  note: string;
  /** Highest size observed as accepted during the Phase 1 probe. */
  observedMaxBytes?: number;
  verified: boolean;
}

/**
 * Providers are not hardcoded into the upload pipeline: this list seeds the
 * provider picker and is editable in Profile. Only servers that accepted
 * encrypted blobs (application/octet-stream) during the Phase 1 probe are
 * listed as verified. See PROVIDERS.md for the raw measurements.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    url: 'https://nostr.download',
    name: 'nostr.download',
    note: 'Accepted encrypted blobs up to 25 MiB in testing',
    verified: true,
  },
  {
    url: 'https://blossom.yakihonne.com',
    name: 'Yakihonne',
    note: 'Accepted encrypted blobs; 200 MiB limit advertised',
    observedMaxBytes: 209_715_200,
    verified: true,
  },
  {
    url: 'https://blossom.ditto.pub',
    name: 'Ditto',
    note: 'Accepted encrypted blobs',
    verified: true,
  },
  {
    url: 'https://blossom.data.haus',
    name: 'data.haus',
    note: 'Accepted encrypted blobs',
    verified: true,
  },
];

export const DEFAULT_PROVIDER_URL = PROVIDER_PRESETS[0].url;

export const DEFAULT_RELAY_LIST = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
