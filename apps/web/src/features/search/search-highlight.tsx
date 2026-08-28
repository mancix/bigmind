import { Fragment } from 'react';

interface HighlightProps {
  text: string;
  query: string;
}

export function Highlight({ text, query }: HighlightProps) {
  if (!query.trim()) {
    return text;
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, i) =>
        pattern.test(part)
          ? <mark key={i} className="rounded-sm bg-yellow-200">{part}</mark>
          : <Fragment key={i}>{part}</Fragment>
      )}
    </>
  );
}
