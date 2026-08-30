import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  findWikiLinkTrigger,
  insertWikiLink,
  rankTitles,
  toggleHeading,
  toggleInline,
  insertLink as insertLinkSnippet,
} from '@bigmind/markdown';

import { colors, spacing, typography } from '../theme';
import { MarkdownText } from './MarkdownText';

interface MarkdownEditViewProps {
  value: string;
  onChangeText: (text: string) => void;
  /** Titles of existing notes, used by the `[[` wiki-link suggestions. */
  noteTitles: { id: string; title: string }[];
  onOpenNote?: (noteId: string) => void;
  placeholder?: string;
  testID?: string;
}

type Mode = 'edit' | 'preview';

/**
 * Native Markdown editor (Option B): raw multiline `TextInput` + formatting
 * toolbar (pure string transforms from `@bigmind/markdown`) + `[[` wiki-link
 * suggestions from the shared ranking helper + live preview toggle.
 */
export function MarkdownEditView({
  value,
  onChangeText,
  noteTitles,
  onOpenNote,
  placeholder,
  testID,
}: MarkdownEditViewProps) {
  const [mode, setMode] = useState<Mode>('edit');
  const [selection, setSelection] = useState({
    start: value.length,
    end: value.length,
  });
  const [query, setQuery] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<{ start: number; end: number } | null>(
    null,
  );

  useEffect(() => {
    setSelection((current) => {
      if (current.end > value.length) {
        return { start: value.length, end: value.length };
      }
      return current;
    });
  }, [value]);

  const applyTransform = (
    transform: (
      text: string,
      start: number,
      end: number,
    ) => {
      text: string;
      start: number;
      end: number;
    },
  ) => {
    const { start, end } = selection;
    const result = transform(value, start, end);
    onChangeText(result.text);
    setSelection({ start: result.start, end: result.end });
  };

  const handleChangeText = (text: string) => {
    onChangeText(text);

    const found = findWikiLinkTrigger(text);
    if (found && found.query.length > 0) {
      setTrigger({ start: found.start, end: found.end });
      setQuery(found.query);
    } else {
      setTrigger(null);
      setQuery(null);
    }
  };

  const suggested = query ? rankTitles(noteTitles, query).slice(0, 5) : [];

  const pickWikiLink = (title: string) => {
    if (!trigger) return;
    const next = insertWikiLink(value, trigger, title);
    onChangeText(next);
    setTrigger(null);
    setQuery(null);
  };

  if (mode === 'preview') {
    return (
      <View>
        <PreviewBar onBack={() => setMode('edit')} />
        <MarkdownText markdown={value} testID={`${testID}-preview`} />
      </View>
    );
  }

  return (
    <View>
      <Toolbar
        onBold={() =>
          applyTransform((t, s, e) => toggleInline(t, s, e, 'bold'))
        }
        onItalic={() =>
          applyTransform((t, s, e) => toggleInline(t, s, e, 'italic'))
        }
        onCode={() =>
          applyTransform((t, s, e) => toggleInline(t, s, e, 'code'))
        }
        onHeading={() => applyTransform(toggleHeading)}
        onLink={() => applyTransform(insertLinkSnippet)}
        onPreview={() => setMode('preview')}
      />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={handleChangeText}
        onSelectionChange={(event) =>
          setSelection({
            start: event.nativeEvent.selection.start,
            end: event.nativeEvent.selection.end,
          })
        }
        selection={selection}
        multiline
        textAlignVertical="top"
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        testID={testID}
      />
      {trigger && suggested.length > 0 ? (
        <View style={styles.suggestions} testID="wiki-suggestions">
          <FlatList
            data={suggested}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                style={styles.suggestionRow}
                onPress={() => pickWikiLink(item.title)}
                testID={`wiki-suggestion-${item.title}`}
              >
                <Text style={styles.suggestionText} numberOfLines={1}>
                  {item.title}
                </Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}
    </View>
  );
}

function Toolbar({
  onBold,
  onItalic,
  onCode,
  onHeading,
  onLink,
  onPreview,
}: {
  onBold: () => void;
  onItalic: () => void;
  onCode: () => void;
  onHeading: () => void;
  onLink: () => void;
  onPreview: () => void;
}) {
  const buttons: { label: string; onPress: () => void; testID?: string }[] = [
    { label: 'B', onPress: onBold, testID: 'md-bold' },
    { label: 'I', onPress: onItalic, testID: 'md-italic' },
    { label: '</>', onPress: onCode, testID: 'md-code' },
    { label: 'H2', onPress: onHeading, testID: 'md-heading' },
    { label: '🔗', onPress: onLink, testID: 'md-link' },
    { label: '👁️', onPress: onPreview, testID: 'md-preview' },
  ];
  return (
    <View style={styles.toolbar}>
      {buttons.map((button) => (
        <Pressable
          key={button.label}
          style={styles.toolbarButton}
          onPress={button.onPress}
          testID={button.testID}
        >
          <Text style={styles.toolbarLabel}>{button.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function PreviewBar({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.previewBar}>
      <Pressable onPress={onBack} testID="md-edit">
        <Text style={styles.previewBarLabel}>✏️ Edit</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  toolbarButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  toolbarLabel: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  input: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 22,
    minHeight: 180,
  },
  suggestions: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  suggestionRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  suggestionText: {
    color: colors.text,
    fontSize: typography.body,
  },
  previewBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: spacing.sm,
  },
  previewBarLabel: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
