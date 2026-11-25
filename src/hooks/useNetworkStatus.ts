import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export function useNetworkStatus(): { offline: boolean; known: boolean } {
  const [state, setState] = useState<{ offline: boolean; known: boolean }>({ offline: false, known: false });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((next) => {
      const offline = next.isConnected === false || next.isInternetReachable === false;
      setState({ offline, known: next.isConnected !== null });
    });
    return unsubscribe;
  }, []);

  return state;
}
