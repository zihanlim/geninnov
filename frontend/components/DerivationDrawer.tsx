"use client";
import { ReactNode, useEffect } from "react";

/**
 * Base slide-in drawer used by ThemeDerivationDrawer and TradeDerivationDrawer.
 * Closes on ESC, on backdrop click, and on the X button.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  children: ReactNode;
  width?: number;
}

export default function DerivationDrawer({
  open,
  onClose,
  title,
  subtitle,
  meta,
  children,
  width = 560,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="ml-auto h-full bg-bg-surface border-l border-border-strong overflow-y-auto relative animate-slide-in"
        style={{ width }}
      >
        <div
          className="sticky top-0 z-10 flex items-start justify-between gap-3 p-6 border-b border-border"
          style={{ background: "linear-gradient(180deg, #1a2230 0%, #131822 100%)" }}
        >
          <div className="flex-1 min-w-0">
            <h2 className="text-[18px] font-semibold m-0 leading-[1.3]">{title}</h2>
            {subtitle && (
              <div className="text-text-secondary text-[12.5px] mt-1 leading-[1.5]">{subtitle}</div>
            )}
            {meta && <div className="mt-2.5">{meta}</div>}
          </div>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary text-[20px] leading-none px-1.5 py-0.5 rounded transition-colors"
            aria-label="Close derivation panel"
          >
            ×
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
