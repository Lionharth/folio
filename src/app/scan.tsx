import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, Linking, Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';

import { AppText } from '../components/ui/AppText';
import { Button } from '../components/ui/Button';
import { Card, Divider } from '../components/ui/Card';
import { IconButton } from '../components/ui/IconButton';
import { InlineNotice } from '../components/ui/Notice';
import { ErrorState, LoadingState } from '../components/ui/States';
import { listContactNames } from '../lib/database/contacts';
import { listCircleMembers, listCirclesForViewer } from '../lib/database/vlogs';
import { pubkeyFromQrPayload, shortNpub } from '../lib/nostr/format';
import { readSecretKey } from '../lib/nostr/identity';
import { invalidateCircles, queryKeys } from '../lib/queryKeys';
import { isParticipatingStatus } from '../lib/social/rules';
import { inviteMember } from '../services/circles';
import { useSession } from '../stores/session';
import { ThemeScope, useTheme } from '../theme/ThemeProvider';

export default function ScanScreen() {
  return (
    <ThemeScope scheme="dark">
      <StatusBar style="light" />
      <ScanContent />
    </ThemeScope>
  );
}

function ScanContent() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(true);
  const [target, setTarget] = useState<string | null>(null);
  const [ownCode, setOwnCode] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [lastCircleId, setLastCircleId] = useState<string | null>(null);
  const [busyCircleId, setBusyCircleId] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const targetRef = useRef<string | null>(null);

  const refreshPermission = useCallback(async () => {
    setPermissionError(null);
    try {
      await getPermission();
    } catch (reason) {
      setPermissionError(reason instanceof Error ? reason.message : 'Could not read camera permissions');
    }
  }, [getPermission]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission();
    });
    return () => subscription.remove();
  }, [refreshPermission]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void refreshPermission();
      if (identity) {
        void queryClient.invalidateQueries({ queryKey: ['scan-owned-circles', identity.pubkey] });
      }
      return () => setFocused(false);
    }, [refreshPermission, identity, queryClient])
  );

  const contactsQuery = useQuery({ queryKey: queryKeys.contacts, queryFn: listContactNames });

  const circlesQuery = useQuery({
    queryKey: ['scan-owned-circles', identity?.pubkey, target],
    queryFn: async () => {
      if (!identity || !target) return { ownedCount: 0, available: [] };
      const circles = await listCirclesForViewer(identity.pubkey);
      const owned = circles.filter((circle) => circle.ownerPubkey === identity.pubkey);
      const withMembers = await Promise.all(
        owned.map(async (circle) => ({ circle, members: await listCircleMembers(circle.id) }))
      );
      const available = withMembers.filter(
        ({ members }) =>
          !members.some((member) => member.pubkey === target && isParticipatingStatus(member.status))
      );
      return { ownedCount: owned.length, available };
    },
    enabled: Boolean(identity && target),
  });

  const nameFor = (pubkey: string) =>
    pubkey === identity?.pubkey ? (identity?.label ?? 'You') : (contactsQuery.data?.[pubkey] ?? shortNpub(pubkey));

  const scanAgain = () => {
    targetRef.current = null;
    setTarget(null);
    setOwnCode(false);
    setSent(false);
    setPickerError(null);
    setLastCircleId(null);
    setCameraError(null);
    if (identity) {
      void queryClient.invalidateQueries({ queryKey: ['scan-owned-circles', identity.pubkey] });
    }
  };

  const handleScan = ({ data }: BarcodeScanningResult) => {
    if (targetRef.current) return;
    const pubkey = pubkeyFromQrPayload(data);
    if (!pubkey) return;
    targetRef.current = pubkey;
    if (pubkey === identity?.pubkey) {
      setOwnCode(true);
      AccessibilityInfo.announceForAccessibility('That is your own Folio ID. Scan another code.');
      return;
    }
    setTarget(pubkey);
    AccessibilityInfo.announceForAccessibility('Folio ID scanned. Choose a circle.');
  };

  const sendInvite = async (circleId: string) => {
    if (!identity || !target || busyCircleId) return;
    setBusyCircleId(circleId);
    setLastCircleId(circleId);
    setPickerError(null);
    try {
      const secretKey = await readSecretKey(identity.id);
      await inviteMember({ secretKey, circleId, memberPubkey: target, ownerName: identity.label });
      await Promise.all([
        invalidateCircles(queryClient, identity.pubkey),
        queryClient.invalidateQueries({ queryKey: ['scan-owned-circles', identity.pubkey] }),
      ]);
      setSent(true);
      AccessibilityInfo.announceForAccessibility(`Invitation sent to ${nameFor(target)}.`);
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : 'Could not send the invitation');
    } finally {
      setBusyCircleId(null);
    }
  };

  if (!identity) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000' }}>
        <LoadingState label="Opening scanner" />
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', padding: theme.layout.screenMargin, justifyContent: 'center' }}>
        {permissionError ? (
          <ErrorState title="Camera permissions could not be read" message={permissionError} onAction={() => void refreshPermission()} />
        ) : (
          <LoadingState label="Preparing the camera" />
        )}
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', padding: theme.layout.screenMargin, paddingTop: insets.top + theme.spacing.lg, justifyContent: 'center', gap: theme.spacing.lg }}>
        <AppText variant="meta" color="textSecondary">SCAN A FOLIO ID</AppText>
        <AppText variant="title">Camera access</AppText>
        <AppText variant="body" color="textSecondary">Camera access is needed to scan a Folio ID.</AppText>
        {permissionError ? <InlineNotice message={permissionError} tone="error" /> : null}
        {permission.canAskAgain ? (
          <Button
            label="Allow camera"
            size="lg"
            fullWidth
            onPress={() => {
              setPermissionError(null);
              requestPermission().catch((reason) =>
                setPermissionError(reason instanceof Error ? reason.message : 'Could not request camera access')
              );
            }}
          />
        ) : (
          <Button label="Open system Settings" size="lg" fullWidth onPress={() => void Linking.openSettings()} />
        )}
        <Button label="Not now" variant="ghost" fullWidth onPress={() => router.back()} />
      </View>
    );
  }

  if (target) {
    const data = circlesQuery.data;
    const circles = data?.available ?? [];
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }}>
          <IconButton icon="x" label="Close scanner" onPress={() => router.back()} style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} />
          <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>Invite to circle</AppText>
        </View>

        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: theme.spacing.xl,
              paddingBottom: insets.bottom + theme.spacing.xl,
              maxHeight: '88%',
              gap: theme.spacing.lg,
            }}
          >
            {sent ? (
              <View style={{ gap: theme.spacing.lg }}>
                <AppText variant="headline">Invitation sent to {nameFor(target)}</AppText>
                <AppText variant="caption" color="textSecondary">They will see it after their next sync.</AppText>
                <Button label="Done" fullWidth onPress={() => router.back()} />
                <Button label="Scan another" variant="ghost" fullWidth onPress={scanAgain} />
              </View>
            ) : (
              <View style={{ gap: theme.spacing.md }}>
                <View style={{ gap: theme.spacing.xs }}>
                  <AppText variant="headline">Invite {nameFor(target)}</AppText>
                  <AppText variant="mono" color="textTertiary" numberOfLines={1}>{shortNpub(target)}</AppText>
                </View>

                {pickerError ? (
                  <View style={{ gap: theme.spacing.sm }}>
                    <InlineNotice message={pickerError} tone="error" />
                    {lastCircleId ? (
                      <Button
                        label="Try again"
                        variant="secondary"
                        fullWidth
                        disabled={Boolean(busyCircleId)}
                        loading={busyCircleId === lastCircleId}
                        onPress={() => void sendInvite(lastCircleId)}
                      />
                    ) : null}
                  </View>
                ) : null}

                {circlesQuery.isLoading ? (
                  <LoadingState label="Looking up your circles" />
                ) : circlesQuery.isError ? (
                  <ErrorState title="Couldn’t open your circles" onAction={() => circlesQuery.refetch()} />
                ) : data && data.ownedCount === 0 ? (
                  <View style={{ gap: theme.spacing.md }}>
                    <AppText variant="body" color="textSecondary">Create a circle first.</AppText>
                    <Button label="Create circle" variant="secondary" fullWidth onPress={() => router.push('/circle/new')} />
                    <Button label="Scan another" variant="ghost" fullWidth onPress={scanAgain} />
                  </View>
                ) : circles.length === 0 ? (
                  <View style={{ gap: theme.spacing.md }}>
                    <AppText variant="body" color="textSecondary">Already in all your circles.</AppText>
                    <Button label="Scan another" variant="secondary" fullWidth onPress={scanAgain} />
                  </View>
                ) : (
                  <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                    {circles.map(({ circle, members }, index) => (
                      <View key={circle.id}>
                        <Pressable
                          onPress={() => void sendInvite(circle.id)}
                          disabled={Boolean(busyCircleId)}
                          accessibilityRole="button"
                          accessibilityLabel={`Invite ${nameFor(target)} to ${circle.name}. ${members.length} ${members.length === 1 ? 'member' : 'members'}`}
                          accessibilityState={{ disabled: Boolean(busyCircleId), busy: busyCircleId === circle.id }}
                          style={({ pressed }) => ({
                            minHeight: theme.layout.minTouchTarget,
                            paddingVertical: theme.spacing.sm,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: theme.spacing.md,
                            opacity: busyCircleId && busyCircleId !== circle.id ? 0.45 : pressed ? 0.82 : 1,
                          })}
                        >
                          <View style={{ flex: 1, gap: 2 }}>
                            <AppText variant="bodyStrong">{circle.name}</AppText>
                            <AppText variant="caption" color="textSecondary">
                              {members.length} {members.length === 1 ? 'member' : 'members'}
                            </AppText>
                          </View>
                          {busyCircleId === circle.id ? (
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                          ) : (
                            <Feather name="chevron-right" size={18} color={theme.colors.textTertiary} />
                          )}
                        </Pressable>
                        {index < circles.length - 1 ? <Divider /> : null}
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>
            )}
          </View>
        </View>
      </View>
    );
  }

  const canScan = !ownCode && !cameraError;

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      {focused && !cameraError ? (
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={canScan ? handleScan : undefined}
          onMountError={(event) => setCameraError(`Camera could not start · ${event.message}`)}
        />
      ) : null}

      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + theme.spacing.sm, paddingHorizontal: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <IconButton icon="x" label="Close scanner" onPress={() => router.back()} style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} />
        </View>
        {cameraError ? <View style={{ marginTop: theme.spacing.md }}><InlineNotice message={cameraError} tone="error" /></View> : null}
      </View>

      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: insets.bottom + theme.spacing.xxl, paddingHorizontal: theme.layout.screenMargin, alignItems: 'center', gap: theme.spacing.md }}>
        {cameraError ? (
          <Button label="Close" variant="secondary" fullWidth onPress={() => router.back()} />
        ) : ownCode ? (
          <Card style={{ width: '100%', gap: theme.spacing.md }}>
            <AppText variant="headline">That’s your Folio ID</AppText>
            <Button label="Scan again" variant="secondary" fullWidth onPress={scanAgain} />
          </Card>
        ) : (
          <>
            <AppText variant="caption" style={{ color: '#D0CBC3', textAlign: 'center' }}>Point at a Folio ID QR code</AppText>
            <AppText variant="meta" style={{ color: '#AAA69F', textAlign: 'center' }}>Only Folio ID codes work.</AppText>
          </>
        )}
      </View>
    </View>
  );
}
