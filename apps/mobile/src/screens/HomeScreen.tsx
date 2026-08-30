import { useCallback, useState } from 'react';
import { Button, Platform, StyleSheet, Text, View } from 'react-native';
import { SYNC_ENTITY_TYPES } from '@bigmind/domain/sync';
import { TEMPLATE_TYPES, createNotePreview } from '@bigmind/domain/notes';
import { noteDataSchema } from '@bigmind/contracts';

import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { storage } from '../storage';
import { colors, spacing, typography } from '../theme';
import type { NoteRecord } from '@bigmind/storage';

/** Hermes does not expose crypto.randomUUID; this is enough for local ids. */
function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeSampleNote(): NoteRecord {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    title: 'Welcome to BigMind',
    content: 'Your local-first knowledge base, now on Android.',
    categoryId: null,
    templateType: 'MARKDOWN',
    createdAt: now,
    updatedAt: now,
    version: 0,
    syncStatus: 'pending',
  };
}

/**
 * Home screen. Besides orienting the user, it exercises the shared layers at
 * runtime: domain rules, zod-validated contracts, and the storage abstraction.
 */
export function HomeScreen() {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [validatedTitle, setValidatedTitle] = useState<string | null>(null);

  const addSampleNote = useCallback(async () => {
    const note = makeSampleNote();
    await storage.transaction(async () => {
      await storage.notes.add(note);
      await storage.outbox.add({
        id: makeId(),
        entityId: note.id,
        entityType: 'note',
        operation: 'create',
        baseVersion: 0,
        payload: note,
        createdAt: note.createdAt,
        retryCount: 0,
        status: 'pending',
      });
    });
    setNotes(await storage.notes.toArray());

    const parsed = noteDataSchema.parse({
      ...note,
      deletedAt: undefined,
    });
    setValidatedTitle(parsed.title);
  }, []);

  return (
    <Screen title="BigMind" subtitle="Local-first knowledge base · Android">
      <Card title="Shared domain">
        <Text style={styles.label}>Synchronized entities</Text>
        <Text style={styles.value}>{SYNC_ENTITY_TYPES.join(', ')}</Text>
        <Text style={styles.label}>Note template types</Text>
        <Text style={styles.value}>{TEMPLATE_TYPES.join(', ')}</Text>
        <Text style={styles.label}>Markdown preview (domain rule)</Text>
        <Text style={styles.value}>
          {createNotePreview('Hello **world** from @bigmind/domain')}
        </Text>
      </Card>

      <Card title="Shared contracts">
        <Text style={styles.value}>
          {validatedTitle
            ? `noteDataSchema validated: "${validatedTitle}" ✓`
            : 'Press below to validate a note through @bigmind/contracts (zod).'}
        </Text>
      </Card>

      <Card title="Storage abstraction">
        <Text style={styles.value}>
          Engine: in-memory placeholder (@bigmind/storage) until expo-sqlite
          lands. Platform: {Platform.OS}.
        </Text>
        <Text style={styles.label}>Local notes</Text>
        <Text style={styles.value}>
          {notes.length === 0 ? 'none' : notes.map((n) => n.title).join(', ')}
        </Text>
        <View style={styles.buttonRow}>
          <Button title="Add sample note" onPress={addSampleNote} />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {
    color: colors.textMuted,
    fontSize: typography.caption,
    marginTop: spacing.sm,
  },
  value: {
    color: colors.text,
    fontSize: typography.body,
    marginTop: 2,
  },
  buttonRow: {
    marginTop: spacing.md,
  },
});
