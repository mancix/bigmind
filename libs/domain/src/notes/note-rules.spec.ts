import { describe, expect, it } from 'vitest';

import type { Note } from './note.js';
import { TEMPLATE_TYPES } from './note.js';
import {
  createNotePreview,
  isNoteDeleted,
  normalizeNoteTitle,
  updateNoteContent,
} from './note-rules.js';

const note: Note = {
  id: 'note-1',
  title: 'Original title',
  content: 'Original content',
  categoryId: null,
  templateType: 'MARKDOWN',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
};

describe('note rules', () => {
  it('uses the default title when the value is empty', () => {
    expect(normalizeNoteTitle('   ')).toBe('Untitled note');
  });

  it('trims surrounding title whitespace', () => {
    expect(normalizeNoteTitle('  Project notes  ')).toBe('Project notes');
  });

  it('creates a plain-text preview from common Markdown', () => {
    expect(
      createNotePreview('# **Hello** [BigMind](https://example.com) `code`'),
    ).toBe('Hello BigMind code');
  });

  it('strips HTML tags like <br> from previews', () => {
    expect(createNotePreview('Hello<br>World')).toBe('Hello World');
    expect(createNotePreview('<br>')).toBe('Empty note');
    expect(createNotePreview('<p>Hello <strong>World</strong></p>')).toBe('Hello World');
  });

  it('truncates previews within the requested maximum length', () => {
    const preview = createNotePreview('A long preview for this note', 12);

    expect(preview).toBe('A long prev…');
    expect(preview).toHaveLength(12);
  });

  it('detects deleted notes', () => {
    expect(isNoteDeleted(note)).toBe(false);
    expect(
      isNoteDeleted({ ...note, deletedAt: '2026-01-02T00:00:00.000Z' }),
    ).toBe(true);
  });

  it('defines MARKDOWN and TODO_LIST template types', () => {
    expect(TEMPLATE_TYPES).toEqual(['MARKDOWN', 'TODO_LIST']);
  });

  it('defaults new notes to MARKDOWN template', () => {
    expect(note.templateType).toBe('MARKDOWN');
  });

  it('updates immutably and uses the supplied timestamp', () => {
    const updated = updateNoteContent(
      note,
      { title: '  Updated title  ', content: 'Updated content' },
      '2026-01-02T00:00:00.000Z',
    );

    expect(updated).not.toBe(note);
    expect(updated).toMatchObject({
      title: 'Updated title',
      content: 'Updated content',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(note).toMatchObject({
      title: 'Original title',
      content: 'Original content',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
