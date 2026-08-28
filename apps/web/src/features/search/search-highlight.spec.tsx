import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Highlight } from './search-highlight';

describe('Highlight', () => {
  it('renders plain text when query is empty', () => {
    render(<Highlight text="Hello world" query="" />);
    expect(screen.getByText('Hello world')).toBeDefined();
  });

  it('wraps matching term in <mark>', () => {
    render(<Highlight text="Hello world" query="world" />);
    const el = screen.getByText('world');
    expect(el.tagName).toBe('MARK');
  });

  it('is case-insensitive', () => {
    render(<Highlight text="Hello World" query="world" />);
    const el = screen.getByText('World');
    expect(el.tagName).toBe('MARK');
  });

  it('highlights multiple occurrences', () => {
    render(<Highlight text="foo bar foo" query="foo" />);
    const marks = screen.getAllByText('foo');
    expect(marks).toHaveLength(2);
    marks.forEach((m) => expect(m.tagName).toBe('MARK'));
  });

  it('does not highlight when no match', () => {
    render(<Highlight text="Hello world" query="xyz" />);
    expect(screen.getByText('Hello world')).toBeDefined();
    expect(screen.queryByText('xyz')).toBeNull();
  });

  it('escapes regex special characters in query', () => {
    render(<Highlight text="price is $10.00" query="$10" />);
    const el = screen.getByText('$10');
    expect(el.tagName).toBe('MARK');
  });

  it('renders empty text without crash', () => {
    render(<Highlight text="" query="foo" />);
    expect(screen.queryByText('foo')).toBeNull();
  });
});
