import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Pressable, View } from 'react-native';
import { router, useFocusEffect, usePreventRemove } from 'expo-router';
import { Camera, CameraView } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '../components/ui/AppText';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { InlineNotice } from '../components/ui/Notice';
import { ErrorState, LoadingState } from '../components/ui/States';
import { MAX_VIDEO_BYTES } from '../constants/media';
import { useCaptureStore } from '../stores/capture';
import { ThemeScope, useTheme } from '../theme/ThemeProvider';
import { formatBytes, formatDuration } from '../utils/time';

export default function CaptureScreen() {
  return (
    <ThemeScope scheme="dark">
      <StatusBar style="light" />
      <CaptureContent />
    </ThemeScope>
  );
}

function CaptureContent() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, setPermission] = useState<Awaited<ReturnType<typeof Camera.getCameraPermissionsAsync>> | null>(null);
  const [microphonePermission, setMicrophonePermission] = useState<Awaited<ReturnType<typeof Camera.getMicrophonePermissionsAsync>> | null>(null);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [fileSize, setFileSize] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);
  const setCaptured = useCaptureStore((state) => state.setCaptured);

  const disableRemovalPrevention = usePreventRemove(recording || starting || stopping, () => {
    Alert.alert('Recording in progress', 'Stop and save the recording before leaving the camera.');
  });

  const refreshPermissions = useCallback(async () => {
    const [nextCamera, nextMicrophone] = await Promise.all([
      Camera.getCameraPermissionsAsync(),
      Camera.getMicrophonePermissionsAsync(),
    ]);
    setPermission(nextCamera);
    setMicrophonePermission(nextMicrophone);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshPermissions().catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not read camera permissions'));
    }, [refreshPermissions])
  );

  const requestPermissions = async () => {
    setError(null);
    try {
      if (!permission?.granted) await Camera.requestCameraPermissionsAsync();
      if (!microphonePermission?.granted) await Camera.requestMicrophonePermissionsAsync();
      await refreshPermissions();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not request camera and microphone access');
    }
  };

  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
    return () => clearInterval(interval);
  }, [recording]);

  const start = async () => {
    if (!cameraRef.current || recording || starting || stopping || !cameraReady) return;
    if (!permission?.granted || !microphonePermission?.granted) {
      setError('Camera and microphone access are both needed to record a video with sound.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      setRecording(true);
      startedAt.current = Date.now();
      setElapsed(0);
      setFileSize(0);
      AccessibilityInfo.announceForAccessibility('Recording started. Use the stop button when finished.');
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      const pending = cameraRef.current.recordAsync({
        maxDuration: 600,
        maxFileSize: MAX_VIDEO_BYTES,
        progressUpdateInterval: 0.5,
      });
      setStarting(false);
      const result = await pending;
      if (result?.uri) {
        setCaptured({
          uri: result.uri,
          durationMs: Date.now() - startedAt.current,
          mimeType: 'video/mp4',
        });
        AccessibilityInfo.announceForAccessibility('Recording saved. Returning to create.');
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        disableRemovalPrevention();
        router.back();
      } else {
        setError('No video was saved. Try recording for a little longer.');
      }
    } catch (recordingError) {
      setError(recordingError instanceof Error ? recordingError.message : 'Recording failed. Your previous clip was not changed; try again.');
    } finally {
      setRecording(false);
      setStarting(false);
      setStopping(false);
    }
  };

  const stop = () => {
    if (!recording || stopping) return;
    setStopping(true);
    AccessibilityInfo.announceForAccessibility('Finishing and saving the recording.');
    cameraRef.current?.stopRecording();
  };

  if ((!permission || !microphonePermission) && error) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', padding: theme.layout.screenMargin, justifyContent: 'center' }}>
        <ErrorState
          title="Camera permissions could not be read"
          message={error}
          onAction={() => {
            setError(null);
            refreshPermissions().catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not read camera permissions'));
          }}
        />
        <Button label="Back" variant="ghost" onPress={() => router.back()} style={{ marginTop: theme.spacing.lg }} />
      </View>
    );
  }

  if (!permission || !microphonePermission) {
    return <View style={{ flex: 1, backgroundColor: '#000000' }}><LoadingState label="Preparing the camera" /></View>;
  }

  if (!permission.granted || !microphonePermission.granted) {
    const canAskAgain = permission.canAskAgain && microphonePermission.canAskAgain;
    const cameraDenied = !permission.granted;
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', padding: theme.layout.screenMargin, justifyContent: 'center', gap: theme.spacing.lg }}>
        <AppText variant="meta" color="textSecondary">RECORD PRIVATELY</AppText>
        <AppText variant="title">{cameraDenied ? 'Camera access' : 'Microphone access'}</AppText>
        <AppText variant="body" color="textSecondary">
          {cameraDenied ? 'Camera and microphone access are needed to record.' : 'Microphone access is needed to record sound.'} Nothing uploads until you publish.
        </AppText>
        {canAskAgain ? (
          <Button
            label="Allow camera and microphone"
            size="lg"
            fullWidth
            onPress={() => void requestPermissions()}
          />
        ) : (
          <Button label="Open system Settings" size="lg" fullWidth onPress={() => void Linking.openSettings()} />
        )}
        <Button label="Not now" variant="ghost" fullWidth onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        mode="video"
        facing="back"
        videoQuality="1080p"
        onCameraReady={() => setCameraReady(true)}
        onMountError={(event) => setError(`Camera could not start · ${event.message}`)}
        onRecordingProgress={(event) => {
          setElapsed(event.duration * 1000);
          setFileSize(event.fileSize);
        }}
      />
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + theme.spacing.sm, paddingHorizontal: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <IconButton
            icon="x"
            label={recording ? 'Close unavailable while recording' : 'Close camera'}
            disabled={recording || starting || stopping}
            onPress={() => router.back()}
            style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
          />
          {recording ? (
            <View style={{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderRadius: theme.radius.pill, backgroundColor: 'rgba(0,0,0,0.68)' }}>
              <AppText variant="caption" style={{ color: '#FFFFFF' }}>
                {formatDuration(elapsed)}{fileSize > 0 ? ` · ${formatBytes(fileSize)}` : ''}
              </AppText>
            </View>
          ) : null}
        </View>
        {error ? <View style={{ marginTop: theme.spacing.md }}><InlineNotice message={error} tone="error" /></View> : null}
      </View>

      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: insets.bottom + theme.spacing.xxl, paddingHorizontal: theme.layout.screenMargin, alignItems: 'center', gap: theme.spacing.lg }}>
        {!recording || stopping ? (
          <AppText variant="caption" style={{ color: '#D0CBC3', textAlign: 'center' }}>
            {stopping ? 'Saving…' : cameraReady ? 'Up to 10:00 · 1080p · 25 MB' : 'Starting camera…'}
          </AppText>
        ) : null}
        <Pressable
          onPress={recording ? stop : () => void start()}
          disabled={starting || stopping || !cameraReady}
          accessibilityRole="button"
          accessibilityLabel={recording ? (stopping ? 'Saving recording' : 'Stop and save recording') : 'Start recording'}
          accessibilityState={{ disabled: starting || stopping || !cameraReady, busy: starting || stopping }}
          style={({ pressed }) => ({
            width: 84,
            height: 84,
            borderRadius: 42,
            borderWidth: 3,
            borderColor: 'rgba(255,255,255,0.88)',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: starting || stopping || !cameraReady ? 0.55 : pressed ? 0.82 : 1,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          <View style={{ width: recording ? 30 : 64, height: recording ? 30 : 64, borderRadius: recording ? 7 : 32, backgroundColor: '#C4453A' }} />
        </Pressable>
        <AppText variant="meta" style={{ color: '#AAA69F', textAlign: 'center' }}>Stays private until published.</AppText>
      </View>
    </View>
  );
}
