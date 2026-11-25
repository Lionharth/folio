import React, { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';

import { AppText } from '../../components/ui/AppText';
import { EmptyState } from '../../components/ui/States';
import { PageHeader } from '../../components/ui/Layout';
import { Screen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { VlogRow } from '../../components/vlog/VlogRow';
import { listCirclesForViewer, listVlogs } from '../../lib/database/vlogs';
import { listContactNames } from '../../lib/database/contacts';
import { shortNpub } from '../../lib/nostr/format';
import { useTheme } from '../../theme/ThemeProvider';
import { useSession } from '../../stores/session';

export default function ArchiveScreen() {
  const theme = useTheme();
  const identity = useSession((state) => state.identity);
  const [search, setSearch] = useState('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [circleId, setCircleId] = useState<string | null>(null);

  const contactsQuery = useQuery({ queryKey: ['contact-names'], queryFn: listContactNames });
  const circlesQuery = useQuery({
    queryKey: ['circles', identity?.pubkey],
    queryFn: () => listCirclesForViewer(identity!.pubkey),
    enabled: Boolean(identity),
  });
  const vlogsQuery = useQuery({
    queryKey: ['archive', identity?.pubkey, search, favouritesOnly, circleId],
    queryFn: () => listVlogs(identity!.pubkey, { search, favouritesOnly, circleId, limit: 100 }),
    enabled: Boolean(identity),
  });

  const vlogs = vlogsQuery.data ?? [];
  const nameFor = (pubkey: string) =>
    pubkey === identity?.pubkey ? (identity?.label ?? 'You') : (contactsQuery.data?.[pubkey] ?? shortNpub(pubkey));

  return (
    <Screen padded={false} edges={['top', 'left', 'right']}>
      <FlatList
        data={vlogs}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ paddingHorizontal: theme.layout.screenMargin }}>
            <PageHeader title="Archive" subtitle="Everything you kept, in order" />
            <TextField
              placeholder="Search titles and captions"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              returnKeyType="search"
              suffix={<Feather name="search" size={16} color={theme.colors.textTertiary} />}
            />
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.md, flexWrap: 'wrap' }}>
              <FilterChip label="All" active={!favouritesOnly && !circleId} onPress={() => { setFavouritesOnly(false); setCircleId(null); }} />
              <FilterChip label="Favourites" active={favouritesOnly} onPress={() => setFavouritesOnly((value) => !value)} />
              {(circlesQuery.data ?? []).map((circle) => (
                <FilterChip
                  key={circle.id}
                  label={circle.name}
                  active={circleId === circle.id}
                  onPress={() => setCircleId((current) => (current === circle.id ? null : circle.id))}
                />
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: theme.layout.screenMargin }}>
            <VlogRow vlog={item} authorLabel={nameFor(item.authorPubkey)} />
          </View>
        )}
        ListEmptyComponent={
          <View style={{ paddingHorizontal: theme.layout.screenMargin }}>
            <EmptyState
              title={search || favouritesOnly || circleId ? 'Nothing matches yet' : 'Your archive is empty'}
              description={
                search || favouritesOnly || circleId
                  ? 'Try a different search or filter.'
                  : 'Published vlogs stay here permanently, in the order they happened.'
              }
            />
          </View>
        }
        contentContainerStyle={{ paddingBottom: theme.spacing.huge }}
      />
    </Screen>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: theme.spacing.lg,
        minHeight: 34,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: active ? theme.colors.ink : theme.colors.border,
        backgroundColor: active ? theme.colors.ink : 'transparent',
        justifyContent: 'center',
      }}
    >
      <AppText variant="label" color={active ? 'onInk' : 'textSecondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}
