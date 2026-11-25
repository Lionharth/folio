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
  refresh: () => Promise<void>;
  switchTo: (id: string) => Promise<void>;
  forget: (id: string) => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  identity: null,
  identities: [],
  loading: true,
  async refresh() {
    const [identity, identities] = await Promise.all([getActiveIdentity(), listIdentities()]);
    set({ identity, identities, loading: false });
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
