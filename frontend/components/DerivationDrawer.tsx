"use client";
import { ReactNode, useEffect, useRef } from "react";

/**
 * Base slide-in drawer used by ThemeDerivationDrawer and TradeDerivationDrawer.
 * Closes on ESC, on backdrop click, and on the X button.
 *
 * a11y (T23): role="dialog", aria-modal, ESC close, backdrop click close,
 * aria-labelledby pointing at the title, and a minimal focus trap that keeps
 * Tab cycling within the panel.
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

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function DerivationDrawer({
  open,
  onClose,
  title,
  subtitle,
  meta,
  children,
  width = 560,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = "derivation-drawer-title";

  useEffect(() => {
    if (!open) return;
    // Remember the trigger so we can restore focus on close.
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        // Minimal focus trap: cycle Tab within the drawer panel.
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => !el.hasAttribute("aria-hidden"));
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !panelRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the panel after mount.
    const t = window.setTimeout(() => {
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const target = focusables?.[0] ?? panelRef.current;
      target?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="ml-auto h-full bg-bg-surface border-l border-border-strong overflow-y-auto relative animate-slide-in focus:outline-none"
        style={{ width }}
      >
        <div
          className="sticky top-0 z-10 flex items-start justify-between gap-3 p-6 border-b border-border"
          style={{ background: "linear-gradient(180deg, #1a2230 0%, #131822 100%)" }}
        >
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="text-[18px] font-semibold m-0 leading-[1.3]">{title}</h2>
            {subtitle && (
              <div className="text-text-secondary text-[12.5px] mt-1 leading-[1.5]">{subtitle}</div>
            )}
            {meta && <div className="mt-2.5">{meta}</div>}
          </div>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary text-[20px] leading-none px-1.5 py-0.5 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
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
