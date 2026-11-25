import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Feather from '@expo/vector-icons/Feather';

import { AppText } from '../components/ui/AppText';
import { Button } from '../components/ui/Button';
import { MAX_VIDEO_BYTES } from '../constants/media';
import { useCaptureStore } from '../stores/capture';
import { useTheme } from '../theme/ThemeProvider';
import { formatDuration } from '../utils/time';

export default function CaptureScreen() {
  const theme = useTheme();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  const setCaptured = useCaptureStore((state) => state.setCaptured);

  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
    return () => clearInterval(interval);
  }, [recording]);

  const start = async () => {
    if (!cameraRef.current || recording || starting) return;
    setStarting(true);
    try {
      setRecording(true);
      startedAt.current = Date.now();
      setElapsed(0);
      const result = await cameraRef.current.recordAsync({
        maxDuration: 600,
        maxFileSize: MAX_VIDEO_BYTES,
      });
      if (result?.uri) {
        setCaptured({
          uri: result.uri,
          durationMs: Date.now() - startedAt.current,
          mimeType: 'video/mp4',
        });
        router.back();
      }
    } catch {
      // A failed recording simply returns to the create screen.
    } finally {
      setRecording(false);
      setStarting(false);
    }
  };

  const stop = () => {
    cameraRef.current?.stopRecording();
  };

  if (!permission) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.layout.screenMargin, justifyContent: 'center', gap: theme.spacing.lg }}>
        <AppText variant="title">Camera access</AppText>
        <AppText variant="body" color="textSecondary">
          Folio needs the camera and microphone to record a clip. Recordings are encrypted on this device before they
          are uploaded.
        </AppText>
        <Button label="Allow camera" onPress={requestPermission} />
        <Button label="Not now" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} mode="video" facing="back" videoQuality="1080p" />
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          paddingTop: 56,
          paddingHorizontal: theme.layout.screenMargin,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={() => (recording ? undefined : router.back())}
          accessibilityLabel="Close camera"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Feather name="x" size={26} color="#fff" />
        </Pressable>
        {recording ? (
          <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)' }}>
            <AppText variant="caption" style={{ color: '#fff' }}>
              {formatDuration(elapsed)}
            </AppText>
          </View>
        ) : null}
      </View>

      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          paddingBottom: 48,
          alignItems: 'center',
          gap: theme.spacing.md,
        }}
      >
        <Pressable
          onPress={recording ? stop : start}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
          style={{
            width: 76,
            height: 76,
            borderRadius: 38,
            borderWidth: 4,
            borderColor: 'rgba(255,255,255,0.85)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: recording ? 28 : 60,
              height: recording ? 28 : 60,
              borderRadius: recording ? 6 : 30,
              backgroundColor: '#C4453A',
            }}
          />
        </Pressable>
        <AppText variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>
          {recording ? 'Tap to finish · stops at 25 MB' : 'Tap to record · 1080p · 25 MB max'}
        </AppText>
      </View>
    </View>
  );
}
