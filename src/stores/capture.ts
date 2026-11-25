import { create } from 'zustand';

export interface CapturedVideo {
  uri: string;
  durationMs: number;
  width?: number;
  height?: number;
  mimeType: string;
}

interface CaptureState {
  captured: CapturedVideo | null;
  setCaptured: (video: CapturedVideo | null) => void;
}

export const useCaptureStore = create<CaptureState>((set) => ({
  captured: null,
  setCaptured: (video) => set({ captured: video }),
}));
