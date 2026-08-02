"use client";
// frontend/components/ResumeWindow.tsx
//
// The author's resume, as a persistent floating window — the same treatment the
// live-news TV and the Ask console get.
//
// WHY A WINDOW AND NOT A POPOVER: same reasoning as `LiveNewsWindow`. A popover
// dismisses on any outside pointerdown, and every nav link is one — so the one
// interaction a resume window exists for ("leave it open, go read the app")
// would be the one that closed it. A draggable, collapsible, portalled window
// survives navigation and is dismissed only when told to.
//
// `keepMounted` IS OFF, exactly as the TV does it. Closing or collapsing
// UNMOUNTS the PDF `<iframe>`, so a closed panel makes no request for the
// document — the same "nothing loads until you open it" privacy/perf guarantee
// ADR-0104 applies to the YouTube frame. Hiding the iframe with `display:none`
// instead would leave a live frame behind a hidden box.
//
// It opens TOP-RIGHT (owner's choice) because `Ask` takes the bottom-right
// corner; both are draggable and remember where they were put.

import Link from "next/link";
import { FileText } from "lucide-react";
import FloatingWindow from "@/components/FloatingWindow";

const RESUME_PATH = "/cv/LIMZIHAN_Resume_2026.pdf";

export default function ResumeWindow({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <FloatingWindow
      id="resume"
      title="Lim Zi Han · Resume"
      open={open}
      onClose={onClose}
      corner="top-right"
      // Wider and taller than the TV: this holds a PDF document.
      widthClass="w-[min(94vw,720px)]"
      bodyClass="max-h-[min(82vh,760px)]"
      icon={<FileText size={12} aria-hidden strokeWidth={1.75} />}
    >
      <div className="p-0">
        <iframe
          src={RESUME_PATH}
          title="Lim Zi Han's resume"
          className="w-full h-[min(72vh,680px)] border-0 bg-bg-surface"
        />
        <div className="px-3 py-2 border-t border-border bg-bg-elevated flex items-center gap-2">
          <span className="text-[11.5px] text-text-tertiary">
            The PDF is also served at its own URL.
          </span>
          <Link
            href={RESUME_PATH}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-[12px] font-medium text-accent hover:underline whitespace-nowrap"
          >
            Open in new tab
          </Link>
        </div>
      </div>
    </FloatingWindow>
  );
}
