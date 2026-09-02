import { describe, expect, it } from 'vitest';

import { createSearchDocument, prepareForIndexing } from './search.js';
import {
  extractPlainText,
  normalizeToken,
  tokenize,
  uniqueTokens,
} from './text.js';

describe('extractPlainText', () => {
  it('removes formatting while preserving readability', () => {
    expect(
      extractPlainText(
        '# Title\n\nSome **bold**, *italic*, `code` and a [link](https://x.test) with an ![alt](img.png).',
      ),
    ).toBe('Title Some bold , italic , code and a link with an alt.');
  });

  it('keeps wiki links as their authored text', () => {
    expect(extractPlainText('See [[My Note]] and [[Another|label]]')).toBe(
      'See My Note and Another label',
    );
  });

  it('strips HTML but keeps its text content', () => {
    expect(extractPlainText('Hello<br>World <strong>x</strong>')).toBe(
      'Hello World x',
    );
  });

  it('handles markdown-heavy input and empty result', () => {
    expect(
      extractPlainText('<!-- comment -->\n\n| a | b |\n|---|---|\n| 1 | 2 |'),
    ).toBe('a b 1 2');
    expect(extractPlainText('###')).toBe('');
  });
});

describe('tokenize', () => {
  it('splits into lowercase word tokens', () => {
    expect(tokenize('Hello, [[My Note]]! snakE_CASE kebab-case 42')).toEqual([
      'hello',
      'my',
      'note',
      'snake_case',
      'kebab-case',
      '42',
    ]);
  });

  it('is deterministic and empty-safe', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('!!! ???')).toEqual([]);
    expect(tokenize('A a A')).toEqual(['a', 'a', 'a']);
  });

  it('supports non-Latin scripts', () => {
    expect(tokenize('Привет мир café')).toEqual(['привет', 'мир', 'café']);
  });
});

describe('normalizeToken / uniqueTokens', () => {
  it('case-folds tokens', () => {
    expect(normalizeToken('Project')).toBe('project');
  });

  it('keeps first-appearance order', () => {
    expect(uniqueTokens('b a b c a')).toEqual(['b', 'a', 'c']);
  });
});

describe('prepareForIndexing', () => {
  it('produces plain text and a token stream', () => {
    const prepared = prepareForIndexing('# Rust\n\n[[Ownership]] and `code`');
    expect(prepared.plainText).toBe('Rust Ownership and code');
    expect(prepared.tokens).toEqual(['rust', 'ownership', 'and', 'code']);
    expect(prepared.uniqueTokens).toEqual(['rust', 'ownership', 'and', 'code']);
    expect(prepared.tokenCount).toBe(4);
    expect(prepared.uniqueTokenCount).toBe(4);
  });

  it('can skip the token stream', () => {
    const prepared = prepareForIndexing('**only text**', false);
    expect(prepared.plainText).toBe('only text');
    expect(prepared.tokens).toEqual([]);
    expect(prepared.tokenCount).toBe(0);
  });
});

describe('createSearchDocument', () => {
  it('replaces markdown content with plain text', () => {
    const doc = createSearchDocument({
      id: 'n1',
      title: 'Rust',
      content: '# Title\n\n**bold** `code` [[Link]]',
    });
    expect(doc).toEqual({
      id: 'n1',
      title: 'Rust',
      content: 'Title bold code Link',
    });
  });
});
