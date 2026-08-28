import { useEffect, useRef, useState } from 'react';
import {
  createFileRoute,
  useNavigate,
} from '@tanstack/react-router';

import { noteRepository } from '../features/notes/note-repository';
import { useInstallPrompt } from '../features/pwa/use-install-prompt';
import { Icon } from '../components/icon';
import type { TemplateType } from '@bigmind/domain/notes';

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => ({
    category: typeof search.category === 'string' ? search.category : undefined,
  }),
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { isInstallable, isInstalled, install } = useInstallPrompt();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleCreate(templateType?: TemplateType) {
    const noteId = await noteRepository.create({
      templateType: templateType ?? 'MARKDOWN',
    });
    setMenuOpen(false);
    await navigate({
      to: '/notes/$noteId',
      params: { noteId },
    });
  }

  return (
    <section className="flex flex-col items-center px-4 py-16 text-center">
      {/* Hero */}
      <div className="max-w-4xl space-y-4">
        <h1 className="text-[32px] font-bold leading-10 tracking-[-0.02em] text-on-surface">
          Your mind. <span className="text-primary-container">Organized.</span> Everywhere.
        </h1>
        <p className="mx-auto max-w-2xl text-base leading-6 text-on-surface-variant">
          The intellectual canvas for your deep thoughts. A quiet, reliable
          partner designed to prioritize clarity, speed, and cognitive ease.
        </p>

        <div className="flex items-center justify-center gap-4 pt-4">
          <div ref={menuRef} className="relative inline-block">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-full bg-primary-container px-10 py-2 text-xs font-medium text-white shadow-sm transition-all hover:shadow-lg active:scale-95"
            >
              New content
            </button>

            {menuOpen && (
              <div className="absolute left-1/2 top-full z-30 mt-2 w-44 -translate-x-1/2 rounded-lg border border-outline-variant bg-surface-lowest py-1 text-left shadow-lg">
                <button
                  type="button"
                  onClick={() => void handleCreate('MARKDOWN')}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-on-surface transition hover:bg-surface-high"
                >
                  <Icon name="sticky_note_2" className="text-[18px] text-on-surface-variant" />
                  <span>Markdown Note</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreate('TODO_LIST')}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-on-surface transition hover:bg-surface-high"
                >
                  <Icon name="checklist" className="text-[18px] text-on-surface-variant" />
                  <span>Todo List</span>
                </button>
                <button
                  type="button"
                  onClick={() => void navigate({ to: '/agenda' })}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-on-surface transition hover:bg-surface-high"
                >
                  <Icon name="alarm" className="text-[18px] text-on-surface-variant" />
                  <span>Reminder</span>
                </button>
              </div>
            )}
          </div>

          {!isInstalled && isInstallable && (
            <button
              type="button"
              onClick={() => void install()}
              className="flex items-center gap-1 text-xs font-medium text-primary-container underline-offset-4 hover:underline decoration-2"
            >
              <Icon name="download" className="text-[18px]" />
              Install BigMind
            </button>
          )}
        </div>
      </div>

      {/* Bento Grid Features */}
      <div className="mt-16 grid w-full max-w-6xl grid-cols-12 gap-4">
        <FeatureCard
          icon="cloud_off"
          iconClassName="bg-primary-fixed/30 text-primary-container"
          title="Offline First"
          description="Work seamlessly without an internet connection. Your data stays local and syncs as soon as you're back online."
        >
          <div className="mt-auto flex items-center gap-1 pt-4">
            <span className="size-2 rounded-full bg-green-500" />
            <span className="text-xs font-medium text-on-surface-variant">Synced &amp; Ready</span>
          </div>
        </FeatureCard>

        <FeatureCard
          icon="hub"
          iconClassName="bg-tertiary-fixed/30 text-tertiary"
          title="Connected"
          description="Bridge your knowledge between mobile, desktop, and web. One workspace that follows you everywhere you think."
        >
          <div className="mt-auto flex -space-x-2 pt-4">
            <span className="flex size-8 items-center justify-center rounded-full border-2 border-surface-lowest bg-primary-fixed/20">
              <Icon name="smartphone" className="text-[16px] text-primary" />
            </span>
            <span className="flex size-8 items-center justify-center rounded-full border-2 border-surface-lowest bg-primary-fixed/20">
              <Icon name="laptop" className="text-[16px] text-primary" />
            </span>
          </div>
        </FeatureCard>

        <FeatureCard
          icon="security"
          iconClassName="bg-secondary-fixed/30 text-secondary"
          title="Private"
          description="Your thoughts are yours alone. Local-first storage ensures that your notes stay under your control."
        >
          <div className="mt-auto pt-4 text-left">
            <span className="rounded bg-secondary-container px-2 py-1 text-xs font-medium text-on-secondary-container">
              Local-first
            </span>
          </div>
        </FeatureCard>

        {/* Large Interactive Card */}
        <div className="col-span-12 mt-6 flex h-96 flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-lowest shadow-sm md:flex-row">
          <div className="flex flex-1 flex-col justify-center p-10 text-left">
            <span className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-primary-container">
              Experience focus
            </span>
            <h3 className="mb-4 text-2xl font-semibold leading-8 tracking-[-0.01em] text-on-surface">
              A canvas for deep work
            </h3>
            <p className="text-sm leading-5 text-on-surface-variant">
              Our interface disappears so your ideas can take center stage. No
              clutter, no distractions, just pure creative flow.
            </p>
          </div>
          <div className="relative flex-1 overflow-hidden bg-surface-container">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="size-48 rounded-full border-[20px] border-primary-container/10 animate-ping" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Icon name="edit_note" className="text-[96px] text-primary-container/30" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface FeatureCardProps {
  icon: string;
  iconClassName: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}

function FeatureCard({ icon, iconClassName, title, description, children }: FeatureCardProps) {
  return (
    <div className="group col-span-12 flex flex-col gap-4 rounded-xl border border-outline-variant bg-surface-lowest p-4 text-left transition-shadow hover:shadow-xl md:col-span-4">
      <div className={`flex size-12 items-center justify-center rounded-lg transition-transform group-hover:scale-110 ${iconClassName}`}>
        <Icon name={icon} className="text-3xl" />
      </div>
      <div>
        <h3 className="mb-1 text-2xl font-semibold leading-8 tracking-[-0.01em] text-on-surface">{title}</h3>
        <p className="text-sm leading-5 text-on-surface-variant">{description}</p>
      </div>
      {children}
    </div>
  );
}
