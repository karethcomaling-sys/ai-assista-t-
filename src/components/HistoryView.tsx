import { MessageSquare, Search, Trash2, ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ConversationSession, LanguagePreference } from '../types/assistant';

interface HistoryViewProps {
  sessions: ConversationSession[];
  onLoadSession: (session: ConversationSession) => void;
  onClearHistory: () => Promise<void>;
}

export function HistoryView({
  sessions,
  onLoadSession,
  onClearHistory,
}: HistoryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [langFilter, setLangFilter] = useState<'all' | LanguagePreference>('all');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (langFilter !== 'all' && s.language !== langFilter) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m) => m.text.toLowerCase().includes(q))
      );
    });
  }, [langFilter, searchQuery, sessions]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Conversation History</h2>
          <p className="mt-1 text-sm text-slate-400">
            Locally stored transcripts across English, Filipino/Tagalog, and Cebuano/Bisaya sessions.
          </p>
        </div>

        {sessions.length > 0 && (
          <div className="flex items-center gap-2">
            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#121826] px-3.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-red-500/40 hover:text-red-300 whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear History
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await onClearHistory();
                    setConfirmClear(false);
                  }}
                  className="rounded-lg bg-red-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-red-500 whitespace-nowrap shrink-0"
                >
                  Confirm Delete All
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search transcripts..."
            className="w-full rounded-lg border border-white/10 bg-[#121826] py-2 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#121826] p-1">
          {(['all', 'auto', 'en', 'tl', 'ceb'] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLangFilter(code)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                langFilter === code
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {code === 'all'
                ? 'All'
                : code === 'auto'
                  ? 'Auto'
                  : code === 'en'
                    ? 'English'
                    : code === 'tl'
                      ? 'Filipino'
                      : 'Cebuano'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#121826] py-16 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-slate-500" />
          <h3 className="mt-3 text-sm font-medium text-slate-200">
            {sessions.length === 0 ? 'No saved conversations yet' : 'No matching transcripts found'}
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            Start a voice or text session in the Voice Console to record conversation history.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-[#121826]">
          {filtered.map((session) => (
            <div
              key={session.id}
              className="flex flex-col gap-3 p-5 transition-colors hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <h3 className="truncate text-sm font-semibold text-slate-100">
                  {session.title}
                </h3>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
                  <span>{new Date(session.updatedAt).toLocaleString()}</span>
                  <span aria-hidden="true">·</span>
                  <span>{session.messages.length} turns</span>
                  <span aria-hidden="true">·</span>
                  <span>Language: {session.language.toUpperCase()}</span>
                </div>
                {session.messages.length > 0 && (
                  <p className="line-clamp-1 text-xs text-slate-400">
                    {session.messages[session.messages.length - 1].text}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => onLoadSession(session)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#0B0F17] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-blue-500/50 hover:text-white whitespace-nowrap shrink-0 self-start sm:self-center"
              >
                Open in Console
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
