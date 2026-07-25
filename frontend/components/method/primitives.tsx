"use client";
// frontend/components/method/primitives.tsx
// Shared presentational primitives for /method. No data access, no fabrication:
// every component here either renders text it was given or renders an explicit
// "this is missing, here is why" state.

import type { ReactNode } from "react";
// Tone classes live in lib/ so the contrast test can import the real strings —
// see lib/methodTones.ts for why the `/40` and `/50` modifiers came off.
import { TONE_CLS, TONE_LABEL_CLS, type Tone } from "@/lib/methodTones";

/* ── Section shell ────────────────────────────────────────────────────────── */

export function Section({
  id,
  index,
  title,
  lede,
  children,
}: {
  id: string;
  index: string;
  title: string;
  lede: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mb-10 scroll-mt-20">
      <div className="flex items-baseline gap-3 mb-1.5">
        <span className="num text-[11px] text-text-tertiary tracking-[0.14em]">{index}</span>
        <h2 id={`${id}-h`} className="text-[16px] font-semibold tracking-[-0.01em] m-0">
          {title}
        </h2>
      </div>
      <p className="m-0 mb-4 text-[13px] text-text-secondary max-w-[86ch]">{lede}</p>
      {children}
    </section>
  );
}

export function SubHead({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 mb-2 flex-wrap">
      <h3 className="text-[12px] uppercase tracking-[0.1em] text-text-secondary font-medium m-0">
        {children}
      </h3>
      {note ? <span className="text-[11px] text-text-tertiary">{note}</span> : null}
    </div>
  );
}

/* ── Monospace formula block ──────────────────────────────────────────────── */

export function Formula({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="overflow-x-auto min-w-0 rounded-lg border border-border-strong bg-bg-primary">
      {label ? (
        <div className="px-4 pt-3 text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          {label}
        </div>
      ) : null}
      <pre className="num m-0 px-4 py-3 text-[13px] leading-[1.75] text-text-primary whitespace-pre">
        {children}
      </pre>
    </div>
  );
}

/* ── Inline code / symbol ─────────────────────────────────────────────────── */

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="num text-[12px] px-1 py-[1px] rounded bg-bg-elevated border border-border text-text-primary">
      {children}
    </code>
  );
}

/* ── Notes: every one of these must name a table/column and a remedy ──────── */


export function Note({
  tone = "info",
  label,
  children,
}: {
  tone?: Tone;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border px-3.5 py-3 text-[12.5px] leading-[1.6] ${TONE_CLS[tone]}`}
      role={tone === "bad" ? "alert" : undefined}
    >
      <span
        className={`block text-[10px] uppercase tracking-[0.14em] font-semibold mb-1 ${TONE_LABEL_CLS[tone]}`}
      >
        {label}
      </span>
      <div className="max-w-[92ch]">{children}</div>
    </div>
  );
}

/** A query that failed. Names the table so the failure is actionable. */
export function QueryError({ table, message }: { table: string; message: string }) {
  return (
    <Note tone="bad" label={`Query failed · ${table}`}>
      <span className="num text-[12px] break-words">{message}</span>
      <div className="mt-1 text-text-tertiary">
        Nothing on this panel could be computed. Check that the table exists, that a
        <span className="num"> SELECT </span>
        policy grants the anon role read access, and that the migration defining it has been
        applied.
      </div>
    </Note>
  );
}

/** A query that succeeded but returned nothing. Names the cause and the remedy. */
export function EmptyState({ table, cause, remedy }: { table: string; cause: string; remedy: string }) {
  return (
    <Note tone="warn" label={`No rows · ${table}`}>
      {cause}
      <div className="mt-1 text-text-tertiary">{remedy}</div>
    </Note>
  );
}

/* ── Small stat tile ──────────────────────────────────────────────────────── */

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: "default" | "good" | "bad" | "warn" | "muted";
}) {
  const color =
    tone === "good"
      ? "text-long"
      : tone === "bad"
        ? "text-short"
        : tone === "warn"
          ? "text-warning"
          : tone === "muted"
            ? "text-text-tertiary"
            : "text-text-primary";
  return (
    <div className="card p-3.5">
      <div className="text-[10px] uppercase tracking-[0.12em] text-text-tertiary mb-1">{label}</div>
      <div className={`num text-[20px] font-semibold leading-[1.15] ${color}`}>{value}</div>
      {sub ? <div className="text-[11px] text-text-tertiary mt-1 leading-[1.45]">{sub}</div> : null}
    </div>
  );
}

/* ── Table shell — always horizontally scrollable in its own container ────── */

export function TableWrap({ children }: { children: ReactNode }) {
  // min-w-0: an overflow-x-auto div that is a flex/grid item still gets
  // min-width:auto, which resolves to the table's min-content and makes the
  // wrapper grow instead of clip — leaking horizontal scroll to the body on
  // phones. min-w-0 lets it shrink to its container so the table scrolls locally.
  return <div className="overflow-x-auto min-w-0">{children}</div>;
}

export function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`px-[14px] py-2.5 text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated whitespace-nowrap ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  mono = false,
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-[14px] py-2.5 border-b border-border align-top ${
        align === "right" ? "text-right" : "text-left"
      } ${mono ? "num" : ""} ${className}`}
    >
      {children}
    </td>
  );
}
