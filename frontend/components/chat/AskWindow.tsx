"use client";
// frontend/components/chat/AskWindow.tsx
//
// `Ask` as a persistent floating window, at the owner's direction — the same
// treatment `Live news` got, and for a sharper reason.
//
// WHY PERSISTENCE MATTERS MORE HERE THAN FOR THE TV. A dropped broadcast costs a
// reader nothing; it resumes. A dropped transcript is gone for good and was
// expensive: `AskConsole` deliberately keeps NO history (ADR-0087 — nothing here
// writes to the domain database), and every turn costs two LLM calls on the same
// MiniMax quota the nightly book spends — three when the guardrail rejects the
// first answer and forces its documented retry. As a popover this dismissed on any
// outside `pointerdown`, and every nav link is one — so the ordinary act of
// reading the answer and then going to look at /book destroyed the answer. Hence
// `keepMounted`: closing HIDES the window, and reopening finds the conversation
// where it was. A full page reload still clears it, which is the boundary
// ADR-0087 actually cares about — nothing is persisted anywhere.
//
// It opens BOTTOM-RIGHT (owner's choice), the chat-widget convention, leaving the
// reading column clear; `Live news` takes top-right so the two never start on top
// of each other. Both are draggable and remember where they were put.
//
// It mounts the SAME `AskConsole` the `/ask` route does. A second copy of the
// composer would be a second place for that ADR's refusals — no streaming, no
// persistence, no answers from the model's own knowledge — to be quietly relaxed.

import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import FloatingWindow from "@/components/FloatingWindow";
import AskConsole from "@/components/chat/AskConsole";

export default function AskWindow({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <FloatingWindow
      id="ask"
      title="Ask the book"
      open={open}
      onClose={onClose}
      corner="bottom-right"
      // Wider and taller than the TV: this holds a transcript with reasoning
      // steps and a composer, not a video and a caveat.
      widthClass="w-[min(94vw,480px)]"
      bodyClass="max-h-[min(72vh,620px)]"
      keepMounted
      icon={<MessageSquareText size={12} aria-hidden strokeWidth={1.75} />}
    >
      <div className="p-4">
        <p className="m-0 mb-3.5 text-[11.5px] leading-[1.55] text-text-tertiary">
          Answered from the published run only — the same rows{" "}
          <span className="num">/book</span>, <span className="num">/risk</span> and{" "}
          <span className="num">/method</span> render. The agent fetches values and
          explains them; it never calculates one, and every figure is checked against
          what it fetched before you see it.{" "}
          <Link href="/ask" className="text-accent hover:underline whitespace-nowrap">
            Open full page
          </Link>
        </p>
        <AskConsole compact />
      </div>
    </FloatingWindow>
  );
}
