import { useEffect, useMemo, useRef, useState } from 'react';
import { Crepe } from '@milkdown/crepe';
import { normalizeWikiLinks, rankTitles } from '@bigmind/markdown';

import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

interface MarkdownEditorProps {
  initialValue: string;
  onChange: (markdown: string) => void;
  noteSuggestions?: { id: string; title: string }[];
}

interface WikiLinkTrigger {
  block: HTMLElement;
  startOffset: number;
  endOffset: number;
  query: string;
  left: number;
  top: number;
}

export function MarkdownEditor({
  initialValue,
  onChange,
  noteSuggestions = [],
}: MarkdownEditorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialValueRef = useRef(initialValue);
  const onChangeRef = useRef(onChange);
  const suggestionsRef = useRef(noteSuggestions);
  const triggerRef = useRef<WikiLinkTrigger | null>(null);
  const selectedIndexRef = useRef(0);
  const insertWikiLinkRef = useRef<(note: { title: string }) => void>(
    () => undefined,
  );
  const [trigger, setTrigger] = useState<WikiLinkTrigger | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  onChangeRef.current = onChange;
  suggestionsRef.current = noteSuggestions;
  triggerRef.current = trigger;
  selectedIndexRef.current = selectedIndex;

  const visibleSuggestions = useMemo(
    () => rankTitles(noteSuggestions, trigger?.query ?? '').slice(0, 8),
    [noteSuggestions, trigger?.query],
  );

  function closeSuggestions() {
    triggerRef.current = null;
    setTrigger(null);
    setSelectedIndex(0);
  }

  function insertWikiLink(note: { title: string }) {
    const current = triggerRef.current;
    if (!current) return;

    const start = positionAtTextOffset(current.block, current.startOffset);
    const end = positionAtTextOffset(current.block, current.endOffset);
    if (!start || !end) return;

    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const text = `[[${note.title}]]`;
    if (!document.execCommand('insertText', false, text)) {
      range.deleteContents();
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      current.block.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: text,
        }),
      );
    }
    closeSuggestions();
  }
  insertWikiLinkRef.current = insertWikiLink;

  useEffect(() => {
    const container = containerRef.current;
    const wrapper = wrapperRef.current;

    if (!container || !wrapper) {
      return;
    }
    const editorContainer = container;
    const wrapperElement = wrapper;
    let triggerFrame: number | undefined;
    let observer: MutationObserver | undefined;
    let destroyed = false;

    const editor = new Crepe({
      root: editorContainer,
      defaultValue: initialValueRef.current,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: 'Start writing, or type / for commands...',
          mode: 'block',
        },
      },
    });

    editor.on((listener) => {
      listener.markdownUpdated((_context, markdown, previousMarkdown) => {
        if (markdown !== previousMarkdown) {
          onChangeRef.current(normalizeWikiLinks(markdown));
          scheduleWikiLinkTrigger();
        }
      });
    });

    function closePopup() {
      triggerRef.current = null;
      setTrigger(null);
      setSelectedIndex(0);
    }

    function updateWikiLinkTrigger(
      fallbackBlock?: HTMLElement,
      allowEndFallback = false,
    ) {
      const selection = window.getSelection();
      const hasUsableSelection = Boolean(
        selection?.isCollapsed &&
        selection.anchorNode &&
        editorContainer.contains(selection.anchorNode),
      );
      if (!hasUsableSelection && (!allowEndFallback || !fallbackBlock)) {
        closePopup();
        return;
      }

      const anchorNode = hasUsableSelection ? selection?.anchorNode : undefined;
      const parent =
        anchorNode?.nodeType === Node.ELEMENT_NODE
          ? (anchorNode as Element)
          : anchorNode?.parentElement;
      let block =
        parent?.closest<HTMLElement>(
          'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre',
        ) ?? fallbackBlock;
      if (!block) return;

      let text = block.textContent ?? '';
      let rect = block.getBoundingClientRect();
      if (anchorNode && selection) {
        const beforeCaret = document.createRange();
        beforeCaret.selectNodeContents(block);
        beforeCaret.setEnd(anchorNode, selection.anchorOffset);
        text = beforeCaret.toString();
        rect = selection.getRangeAt(0).cloneRange().getBoundingClientRect();
      }

      let match = text.match(/\[\[([^[\]\n]*)$/);
      if (!match && allowEndFallback && fallbackBlock) {
        block = fallbackBlock;
        text = block.textContent ?? '';
        rect = block.getBoundingClientRect();
        match = text.match(/\[\[([^[\]\n]*)$/);
      }
      if (!match) {
        closePopup();
        return;
      }

      const wrapperRect = wrapperElement.getBoundingClientRect();
      const nextTrigger: WikiLinkTrigger = {
        block,
        startOffset: text.length - match[0].length,
        endOffset: text.length,
        query: match[1] ?? '',
        left: Math.max(0, rect.left - wrapperRect.left),
        top: rect.bottom - wrapperRect.top + 6,
      };
      triggerRef.current = nextTrigger;
      setTrigger(nextTrigger);
      setSelectedIndex(0);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (
        !(event.target instanceof Node) ||
        !editorContainer.contains(event.target)
      ) {
        return;
      }
      const current = triggerRef.current;
      if (!current) return;
      const notes = rankTitles(suggestionsRef.current, current.query).slice(
        0,
        8,
      );

      if (event.key === 'Escape') {
        event.preventDefault();
        closePopup();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((value) => Math.min(value + 1, notes.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((value) => Math.max(value - 1, 0));
      } else if (event.key === 'Enter' && notes[selectedIndexRef.current]) {
        event.preventDefault();
        insertWikiLinkRef.current(notes[selectedIndexRef.current]);
      }
    }

    function scheduleWikiLinkTrigger() {
      if (triggerFrame !== undefined) cancelAnimationFrame(triggerFrame);
      triggerFrame = requestAnimationFrame(() => {
        triggerFrame = undefined;
        const editable = editorContainer.querySelector<HTMLElement>(
          '[contenteditable="true"]',
        );
        const blocks = editable?.querySelectorAll<HTMLElement>(
          'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre',
        );
        const fallbackBlock = blocks?.item(Math.max(0, blocks.length - 1));
        updateWikiLinkTrigger(fallbackBlock ?? undefined, true);
      });
    }

    document.addEventListener('keydown', handleKeyDown, true);

    void editor.create().then(() => {
      if (destroyed) return;
      observer = new MutationObserver(scheduleWikiLinkTrigger);
      observer.observe(editorContainer, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });

    return () => {
      destroyed = true;
      observer?.disconnect();
      if (triggerFrame !== undefined) cancelAnimationFrame(triggerFrame);
      document.removeEventListener('keydown', handleKeyDown, true);
      void editor.destroy();
    };
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <div ref={containerRef} className="bigmind-editor min-h-[60vh]" />

      {trigger && visibleSuggestions.length > 0 && (
        <div
          role="listbox"
          aria-label="Wiki link suggestions"
          className="absolute z-30 w-64 overflow-hidden rounded-md border border-slate-200 bg-white p-1 shadow-xl"
          style={{ left: trigger.left, top: trigger.top }}
        >
          {visibleSuggestions.map((note, index) => (
            <button
              key={note.id}
              type="button"
              role="option"
              aria-selected={selectedIndex === index}
              onMouseDown={(event) => {
                event.preventDefault();
                insertWikiLink(note);
              }}
              className={`block w-full truncate rounded px-3 py-2 text-left text-sm ${
                selectedIndex === index
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {note.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function positionAtTextOffset(
  root: HTMLElement,
  targetOffset: number,
): { node: Text; offset: number } | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = targetOffset;
  let node = walker.nextNode() as Text | null;

  while (node) {
    if (offset <= node.data.length) return { node, offset };
    offset -= node.data.length;
    node = walker.nextNode() as Text | null;
  }

  return undefined;
}
