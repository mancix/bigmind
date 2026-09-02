import { describe, expect, it } from 'vitest';

import {
  createMarkdownPreview,
  createNotePreview,
  EMPTY_NOTE_PREVIEW,
} from './preview.js';

describe('createMarkdownPreview', () => {
  it('returns the full plain text when no length is given', () => {
    expect(
      createMarkdownPreview(
        '# **Hello** [BigMind](https://example.com) `code`',
      ),
    ).toBe('Hello BigMind code');
  });

  it('truncates at maxLength with an ellipsis', () => {
    const preview = createMarkdownPreview('A long preview for this note', 12);
    expect(preview).toBe('A long prev…');
    expect(preview.length).toBe(12);
  });

  it('handles edge lengths', () => {
    expect(createMarkdownPreview('abc', 0)).toBe('');
    expect(createMarkdownPreview('abc', 1)).toBe('…');
  });

  it('returns the empty-note fallback for content without text', () => {
    expect(createMarkdownPreview('<br>')).toBe(EMPTY_NOTE_PREVIEW);
    expect(createMarkdownPreview('###')).toBe(EMPTY_NOTE_PREVIEW);
  });

  it('keeps wiki-link titles readable', () => {
    expect(createMarkdownPreview('See [[My Note]]')).toBe('See My Note');
  });
});

describe('createNotePreview (deprecated alias)', () => {
  it('behaves identically to createMarkdownPreview', () => {
    expect(createNotePreview('# hello', 4)).toBe('hel…');
    expect(createNotePreview('').length).toBeGreaterThan(0);
  });
});
