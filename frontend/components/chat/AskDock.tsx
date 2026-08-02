"use client";
// frontend/components/chat/AskDock.tsx
//
// The TopBar control that opens the Ask window.
//
// The open state no longer lives here: it is lifted into `AskProvider` in the
// root layout, so this control and the bottom-right "Ask" FAB toggle the SAME
// `AskWindow`. `AskProvider` renders the single window; this control is just the
// TopBar-side switch.
//
// The `/ask` ROUTE STAYS and the window links to it. Not deference to bookmarks:
// it is published in `llms.txt` as a documented entry point and referenced by the
// MCP route's notes, so removing it would break a contract with machine readers.
// It also does what a floating window structurally cannot — `app/ask/page.tsx` is
// a scrolling DOCUMENT, so a long transcript stays Ctrl+F-able and deep-linkable
// (goal 7). The two are scoped by length: a question from wherever you are, or a
// session you intend to read back.

import { MessageSquareText } from "lucide-react";
import RibbonControl from "@/components/RibbonControl";
import { useAsk } from "@/components/chat/AskProvider";

export default function AskDock() {
  const { open, setOpen } = useAsk();

  return (
    <RibbonControl
      label="Ask"
      active={open}
      aria-expanded={open}
      aria-controls="ask-window-body"
      onClick={() => setOpen(!open)}
      icon={<MessageSquareText size={13} aria-hidden strokeWidth={1.75} />}
    />
  );
}
