import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  parseMarkdown,
  type InlineToken,
  type MarkdownBlock,
} from '@bigmind/markdown';

import { colors, spacing, typography } from '../theme';

interface MarkdownTextProps {
  markdown: string;
  /** Called when a `[[wiki]]` link is tapped (default: no-op). */
  onWikiPress?: (title: string) => void;
  /** Called when an external link is tapped (default: no-op). */
  onLinkPress?: (url: string) => void;
  testID?: string;
}

/**
 * Native Markdown preview — renders the SHARED `@bigmind/markdown` tokenizer
 * output into RN components (Android-first). Display-only: the stored text
 * stays the source of truth.
 */
export function MarkdownText({
  markdown,
  onWikiPress,
  onLinkPress,
  testID,
}: MarkdownTextProps) {
  const blocks = parseMarkdown(markdown);

  return (
    <View style={styles.container} testID={testID}>
      {blocks.map((block, index) => (
        <Block
          key={index}
          block={block}
          onWikiPress={onWikiPress}
          onLinkPress={onLinkPress}
        />
      ))}
      {blocks.length === 0 ? (
        <Text style={styles.empty}>Empty note</Text>
      ) : null}
    </View>
  );
}

function Block({
  block,
  onWikiPress,
  onLinkPress,
}: {
  block: MarkdownBlock;
  onWikiPress?: (title: string) => void;
  onLinkPress?: (url: string) => void;
}) {
  const inline = (tokens: InlineToken[]) => (
    <Inline
      tokens={tokens}
      onWikiPress={onWikiPress}
      onLinkPress={onLinkPress}
    />
  );

  switch (block.type) {
    case 'heading':
      return (
        <Text
          style={[
            styles.heading,
            block.level === 1 && styles.heading1,
            block.level === 2 && styles.heading2,
            block.level >= 3 && styles.heading3,
          ]}
        >
          {inline(block.content)}
        </Text>
      );
    case 'paragraph':
      return <Text style={styles.paragraph}>{inline(block.content)}</Text>;
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, index) => (
            <View key={index} style={styles.listRow}>
              <Text style={styles.listBullet}>
                {block.ordered ? `${index + 1}.` : '•'}
              </Text>
              <Text style={styles.paragraph}>{inline(item)}</Text>
            </View>
          ))}
        </View>
      );
    case 'code':
      return (
        <View style={styles.codeBox}>
          <Text style={styles.code}>{block.content}</Text>
        </View>
      );
    case 'blockquote':
      return (
        <View style={styles.quoteBox}>
          <Text style={styles.quote}>{inline(block.content)}</Text>
        </View>
      );
    case 'hr':
      return <View style={styles.hr} />;
    case 'table':
      return (
        <View>
          <View style={styles.tableRow}>
            {block.header.map((cell, index) => (
              <Text key={index} style={[styles.cell, styles.tableHeader]}>
                {cell}
              </Text>
            ))}
          </View>
          {block.rows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.tableRow}>
              {row.map((cell, colIndex) => (
                <Text key={colIndex} style={styles.cell}>
                  {cell}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    default:
      return null;
  }
}

function Inline({
  tokens,
  onWikiPress,
  onLinkPress,
}: {
  tokens: InlineToken[];
  onWikiPress?: (title: string) => void;
  onLinkPress?: (url: string) => void;
}): ReactNode {
  return tokens.map((token, index) => {
    switch (token.type) {
      case 'text':
        return <Text key={index}>{token.value}</Text>;
      case 'bold':
        return (
          <Text key={index} style={styles.bold}>
            <Inline
              tokens={token.content}
              onWikiPress={onWikiPress}
              onLinkPress={onLinkPress}
            />
          </Text>
        );
      case 'italic':
        return (
          <Text key={index} style={styles.italic}>
            <Inline
              tokens={token.content}
              onWikiPress={onWikiPress}
              onLinkPress={onLinkPress}
            />
          </Text>
        );
      case 'code':
        return (
          <Text key={index} style={styles.inlineCode}>
            {token.value}
          </Text>
        );
      case 'link':
        return (
          <Text
            key={index}
            style={styles.link}
            onPress={onLinkPress ? () => onLinkPress(token.url) : undefined}
          >
            <Inline
              tokens={token.content}
              onWikiPress={onWikiPress}
              onLinkPress={onLinkPress}
            />
          </Text>
        );
      case 'wiki':
        return (
          <Text
            key={index}
            style={styles.wiki}
            onPress={onWikiPress ? () => onWikiPress(token.title) : undefined}
          >
            {`[[${token.label ?? token.title}]]`}
          </Text>
        );
    }
  });
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  empty: {
    color: colors.textMuted,
    fontSize: typography.body,
  },
  paragraph: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 22,
  },
  heading: {
    color: colors.text,
    fontWeight: '700',
  },
  heading1: { fontSize: 26 },
  heading2: { fontSize: 22 },
  heading3: { fontSize: 18 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  inlineCode: {
    fontFamily: 'monospace',
    color: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  link: { color: colors.primary },
  wiki: { color: colors.accent },
  list: { gap: spacing.xs },
  listRow: { flexDirection: 'row', gap: spacing.sm },
  listBullet: { color: colors.textMuted, width: 20 },
  codeBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.sm,
  },
  code: { fontFamily: 'monospace', color: colors.text, fontSize: 13 },
  quoteBox: {
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    paddingLeft: spacing.md,
  },
  quote: {
    color: colors.textMuted,
    fontSize: typography.body,
    fontStyle: 'italic',
  },
  hr: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  tableRow: { flexDirection: 'row', gap: spacing.sm },
  cell: { flex: 1, color: colors.text, fontSize: typography.caption },
  tableHeader: { fontWeight: '700', color: colors.textMuted },
});
