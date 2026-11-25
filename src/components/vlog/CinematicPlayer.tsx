import React from 'react';
import { View } from 'react-native';
import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';

import { useTheme } from '../../theme/ThemeProvider';
import { ErrorState } from '../ui/States';
import { IconButton } from '../ui/IconButton';

export function CinematicPlayer({
  uri,
  onEnded,
  onRetry,
}: {
  uri: string;
  onEnded: () => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.play();
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEventListener(player, 'playToEnd', () => onEnded());

  if (status === 'error') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl }}>
        <ErrorState
          title="This video cannot play on this device"
          message="The file was opened locally, but the device decoder rejected it. Retry or choose another clip."
          onAction={onRetry}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <VideoView
        player={player}
        style={{ flex: 1 }}
        contentFit="contain"
        nativeControls
        fullscreenOptions={{ enable: true }}
      />
      <IconButton
        icon={isPlaying ? 'pause' : 'play'}
        label={isPlaying ? 'Pause video' : 'Play video'}
        onPress={() => (isPlaying ? player.pause() : player.play())}
        style={{
          position: 'absolute',
          right: theme.spacing.sm,
          bottom: theme.spacing.sm,
          backgroundColor: 'rgba(0,0,0,0.68)',
        }}
      />
    </View>
  );
}
