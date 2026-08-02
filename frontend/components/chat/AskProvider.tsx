"use client";
// frontend/components/chat/AskProvider.tsx
//
// The single owner of the Ask window's open state, and the second place Ask can
// be opened from: a bottom-right "Ask" pill fixed above the live-feed ribbon.
//
// WHY THE STATE LIVES HERE. `AskDock` in `TopBar` used to own the `open` boolean
// and render the one `AskWindow`. Lifting it into a provider in the root layout
// lets the TopBar control AND this FAB toggle the SAME window — one transcript,
// one `AskWindow`, one `AskConsole`. That is not an optimisation: AskConsole
// deliberately keeps no history (ADR-0087) and every turn costs two LLM calls on
// the same MiniMax quota the nightly book spends (three when a first answer
// fails its citation check), so a second, independent window would be a second
// place those refusals could be quietly relaxed — the exact "never copied" rule
// AskConsole's docstring states.
//
// The root layout is a Server Component that does not remount across client-side
// navigations, so state mounted here survives a route change for free — the same
// guarantee `FloatingWindow`'s header relies on for its own persistence.
//
// THE FAB. A navy `--logo-plate` pill, the brand ground, with white ink — the
// plate's call sites are the mark, the masthead, the active lens chip (ADR-0224)
// and now this button (ADR-0225). It tucks under the Ask window when open; like
// the TopBar control it toggles the shared window.

import { createContext, useContext, useState } from "react";
import { MessageSquareText } from "lucide-react";
import AskWindow from "@/components/chat/AskWindow";

interface AskState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const AskContext = createContext<AskState | null>(null);

/** `open`/`setOpen` for both Ask controls. Null only outside the provider. */
export function useAsk(): AskState {
  const ctx = useContext(AskContext);
  if (!ctx) throw new Error("useAsk must be used within AskProvider");
  return ctx;
}

export default function AskProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <AskContext.Provider value={{ open, setOpen }}>
      {children}

      {/* Bottom-right Ask pill — the brand navy, above the feed ribbon. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="ask-window-body"
        aria-label="Ask"
        className="fixed right-4 bottom-[calc(var(--feed-h)+14px)] z-50 inline-flex items-center gap-1.5 rounded-full bg-logo-plate text-white pl-3 pr-3.5 py-2 text-[12.5px] font-semibold shadow-lg transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <MessageSquareText size={15} aria-hidden strokeWidth={1.75} />
        <span>Ask</span>
      </button>

      {/* The one Ask window — shared by the TopBar control and this FAB. */}
      <AskWindow open={open} onClose={() => setOpen(false)} />
    </AskContext.Provider>
  );
}
