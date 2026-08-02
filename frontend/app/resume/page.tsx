import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";

export const metadata: Metadata = {
  title: "Resume — Lim Zi Han",
  description: "Lim Zi Han's resume",
};

const RESUME_PATH = "/cv/LIMZIHAN_Resume_2026.pdf";

export default function ResumePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg-base px-4 py-16">
      <div className="w-full max-w-3xl">
        <div className="flex items-center gap-3 mb-8">
          <FileText size={28} strokeWidth={1.5} className="text-accent" aria-hidden />
          <h1 className="text-2xl font-semibold text-text-primary">Lim Zi Han</h1>
        </div>

        <div className="bg-bg-elevated border border-border rounded-2xl overflow-hidden shadow-sm">
          <iframe
            src={RESUME_PATH}
            title="Lim Zi Han's resume"
            className="w-full h-[min(72vh,680px)] border-0 bg-bg-surface"
          />
          <div className="px-4 py-3 border-t border-border bg-bg-elevated flex items-center justify-end">
            <Link
              href={RESUME_PATH}
              target="_blank"
              rel="noreferrer"
              className="text-[13px] font-medium text-accent hover:underline"
            >
              Open in new tab →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
