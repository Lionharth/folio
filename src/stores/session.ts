import { create } from 'zustand';

import {
  deleteIdentity,
  getActiveIdentity,
  listIdentities,
  setActiveIdentity,
  type StoredIdentity,
} from '../lib/nostr/identity';

interface SessionState {
  identity: StoredIdentity | null;
  identities: StoredIdentity[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  switchTo: (id: string) => Promise<void>;
  forget: (id: string) => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  identity: null,
  identities: [],
  loading: true,
  error: null,
  async refresh() {
    set({ loading: true, error: null });
    try {
      const [identity, identities] = await Promise.all([getActiveIdentity(), listIdentities()]);
      set({ identity, identities });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Folio could not open this device’s secure storage';
      set({ error: message });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
  async switchTo(id) {
    await setActiveIdentity(id);
    await get().refresh();
  },
  async forget(id) {
    await deleteIdentity(id);
    await get().refresh();
  },
}));
