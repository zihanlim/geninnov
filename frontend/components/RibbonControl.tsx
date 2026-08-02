"use client";
// frontend/components/RibbonControl.tsx
//
// The shared LOOK of a TopBar tool control — `Ask` and `Live news`.
//
// Behaviour is deliberately NOT here. The two controls no longer behave alike:
// `Ask` opens a popover that dismisses on an outside click, `Live news` opens a
// persistent window that must survive one. What they must keep sharing is that
// they read as the same kind of thing sitting next to each other, which is a
// styling concern and nothing more. Splitting it this way is what lets their
// behaviours diverge without their appearance drifting.
//
// The label shows from `wide` (1424px) up — exactly where TopBar's nav goes
// `wide:hidden` and hands over to the SideRail. Below that a labelled control
// competes with four nav items for a 56px row, and measurement showed the label
// costing ~57px more than the icon. `aria-label` carries the name regardless, so
// the button is never anonymous to assistive tech when the text is hidden.

import { forwardRef } from "react";

export interface RibbonControlProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: React.ReactNode;
  /** Pressed/open styling. */
  active?: boolean;
}

const RibbonControl = forwardRef<HTMLButtonElement, RibbonControlProps>(
  function RibbonControl({ label, icon, active = false, className = "", ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors ${
          active
            ? "border-header-border bg-header-raised text-header-ink"
            : "border-header-border bg-transparent text-header-muted hover:text-header-ink hover:bg-header-raised"
        } ${className}`}
        {...rest}
      >
        {icon}
        <span className="hidden wide:inline">{label}</span>
      </button>
    );
  },
);

export default RibbonControl;
