"use client";
// frontend/components/chat/AskDock.tsx
//
// The TopBar control that opens the Ask window.
//
// `open` lives here rather than inside the window because this sits in `TopBar`,
// which `app/layout.tsx` renders — and the App Router does not remount a layout
// across a client-side navigation. So the open state, and the transcript inside,
// survive a route change for free.
//
// The `/ask` ROUTE STAYS and the window links to it. Not deference to bookmarks:
// it is published in `llms.txt` as a documented entry point and referenced by the
// MCP route's notes, so removing it would break a contract with machine readers.
// It also does what a floating window structurally cannot — `app/ask/page.tsx` is
// a scrolling DOCUMENT, so a long transcript stays Ctrl+F-able and deep-linkable
// (goal 7). The two are scoped by length: a question from wherever you are, or a
// session you intend to read back.

import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import RibbonControl from "@/components/RibbonControl";
import AskWindow from "@/components/chat/AskWindow";

export default function AskDock() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <RibbonControl
        label="Ask"
        active={open}
        aria-expanded={open}
        aria-controls="ask-window-body"
        onClick={() => setOpen((o) => !o)}
        icon={<MessageSquareText size={13} aria-hidden strokeWidth={1.75} />}
      />
      <AskWindow open={open} onClose={() => setOpen(false)} />
    </>
  );
}
