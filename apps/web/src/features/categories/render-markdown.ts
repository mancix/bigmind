export function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html.push(`<pre><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    if (line.trim() === '') {
      html.push('</p><p>');
      continue;
    }

    let processed = line;

    if (processed.startsWith('### ')) {
      processed = `<h3>${escapeHtml(processed.slice(4))}</h3>`;
    } else if (processed.startsWith('## ')) {
      processed = `<h2>${escapeHtml(processed.slice(3))}</h2>`;
    } else if (processed.startsWith('# ')) {
      processed = `<h1>${escapeHtml(processed.slice(2))}</h1>`;
    } else if (processed.startsWith('- ') || processed.startsWith('* ')) {
      processed = `<li>${escapeHtml(processed.slice(2))}</li>`;
    } else if (/^\d+\.\s/.test(processed)) {
      processed = `<li>${escapeHtml(processed.replace(/^\d+\.\s/, ''))}</li>`;
    } else if (processed.startsWith('|')) {
      processed = renderTableRow(processed);
    } else {
      processed = escapeHtml(processed);
    }

    processed = renderInline(processed);
    html.push(processed);
  }

  if (inCodeBlock) {
    html.push(`<pre><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
  }

  let result = html.join('\n');
  result = result.replace(/<\/p><p>/g, '</p>\n<p>');
  result = `<p>${result}</p>`;
  result = result.replace(/<p><\/p>/g, '<p>\u00A0</p>');

  result = wrapLists(result);

  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderInline(text: string): string {
  text = text.replace(/\[\[([^\]]+)\]\]/g, (_m, title) => {
    return `<a href="#" class="wiki-link" data-note-title="${escapeHtml(title)}">[[${escapeHtml(title)}]]</a>`;
  });

  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    return `<a href="${escapeHtml(url)}" class="external-link">${escapeHtml(label)}</a>`;
  });

  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  return text;
}

function renderTableRow(line: string): string {
  const cells = line.split('|').filter(Boolean).map((c) => c.trim());
  if (cells.every((c) => /^[-]+$/.test(c))) return '';
  const tag = line.startsWith('|---') ? 'th' : 'td';
  const cellHtml = cells.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join('');
  return `<tr>${cellHtml}</tr>`;
}

function wrapLists(html: string): string {
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/<ul><li>/g, '<ul><li>');
  return html;
}
