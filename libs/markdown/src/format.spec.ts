import { describe, expect, it } from 'vitest';

import {
  insertWikiLinkSnippet,
  toggleBulletList,
  toggleChecklist,
  toggleCodeBlock,
  toggleOrderedList,
  toggleQuote,
} from './format.js';

describe('toggleBulletList', () => {
  it('prepends `- ` to the caret line and keeps the cursor anchored', () => {
    const result = toggleBulletList('alpha\nbeta', 6, 6); // caret on "beta"
    expect(result.text).toBe('alpha\n- beta');
    expect(result.start).toBe(8);
    expect(result.end).toBe(8);
  });

  it('removes `- ` (and `* `) markers from selected lines', () => {
    expect(toggleBulletList('- one\n- two\n- three', 0, 13)).toEqual({
      text: 'one\ntwo\nthree',
      start: 0,
      end: 8, // the caret sat inside the last line's marker → clamps to content start
    });
  });

  it('toggles mixed selections per line and preserves offsets', () => {
    const result = toggleBulletList('para\n* item', 0, 10);
    expect(result.text).toBe('- para\nitem');
    // caret anchored to the same characters: start follows the inserted
    // marker, end stays between the `e`/`m` of `item`.
    expect(result.start).toBe(2);
    expect(result.end).toBe(10);
  });
});

describe('toggleOrderedList', () => {
  it('prepends `1. ` and can strip any numbering', () => {
    const added = toggleOrderedList('first\nsecond', 0, 5);
    expect(added.text).toBe('1. first\nsecond');
    const stripped = toggleOrderedList('3. first\n2. second', 0, 18);
    expect(stripped.text).toBe('first\nsecond');
  });
});

describe('toggleChecklist', () => {
  it('adds `- [ ] ` and strips checked/unchecked markers', () => {
    expect(toggleChecklist('plan', 0, 4).text).toBe('- [ ] plan');
    expect(toggleChecklist('- [x] done', 0, 10).text).toBe('done');
    expect(toggleChecklist('- [ ] todo', 0, 10).text).toBe('todo');
  });
});

describe('toggleQuote', () => {
  it('prepends `> ` and strips it back', () => {
    expect(toggleQuote('said', 0, 4).text).toBe('> said');
    expect(toggleQuote('> said', 0, 6).text).toBe('said');
  });
});

describe('toggleCodeBlock', () => {
  it('wraps the caret line in fences and keeps the cursor inside', () => {
    const result = toggleCodeBlock('const a = 1;', 6, 6);
    expect(result.text).toBe('```\nconst a = 1;\n```');
    expect(result.start).toBe(10);
    expect(result.end).toBe(10);
  });

  it('wraps a multi-line selection', () => {
    const result = toggleCodeBlock('line one\nline two', 0, 16);
    expect(result.text).toBe('```\nline one\nline two\n```');
    expect(result.start).toBe(4);
    expect(result.end).toBe(20);
  });

  it('removes the fences when the selection covers the block', () => {
    const input = '```ts\nconst a = 1;\n```';
    const result = toggleCodeBlock(input, 0, input.length);
    expect(result.text).toBe('const a = 1;');
  });

  it('removes the enclosing block when the caret is inside it', () => {
    const input = 'before\n```\nsecret\n```\nafter';
    const caret = input.indexOf('secret') + 1;
    const result = toggleCodeBlock(input, caret, caret);
    expect(result.text).toBe('before\nsecret\nafter');
  });
});

describe('insertWikiLinkSnippet', () => {
  it('inserts an empty `[[]]` with the caret inside the brackets', () => {
    const result = insertWikiLinkSnippet('see ', 4, 4);
    expect(result.text).toBe('see [[]]');
    expect(result.start).toBe(6);
    expect(result.end).toBe(6);
  });

  it('wraps the selection and keeps the label selected inside', () => {
    const result = insertWikiLinkSnippet('see My Note!', 4, 11);
    expect(result.text).toBe('see [[My Note]]!');
    expect(result.start).toBe(6);
    expect(result.end).toBe(13);
  });
});
