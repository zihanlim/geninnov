# ADR-0226: The rail author card and the resume window

## Context

The owner wanted to be credited as the app's author in the persistent left rail
(`SideRail`), with a way to open their resume from there. The resume is a PDF at
`docs/cv/LIMZIHAN_Resume_2026.pdf` (untracked, 336K).

**Decisions (confirmed with owner):**
- A card in the SideRail **above the "Narrow" toggle**, reading **"Built by
  Zihan Lim"**, with a **"Resume"** button.
- The resume opens **in a floating card** — a PDF `<iframe>` inside a
  `FloatingWindow`, reusing the exact window pattern from `LiveNewsWindow`.

## Decision

### 1. The PDF is served statically
`docs/cv/LIMZIHAN_Resume_2026.pdf` is copied to `frontend/public/cv/`, which
Next.js serves at `/cv/LIMZIHAN_Resume_2026.pdf`. `docs/cv/` stays as the
owner's source of record; the `public/cv/` copy is the tracked, served artifact.

### 2. `ResumeWindow` is a floating window, `keepMounted` OFF
`frontend/components/ResumeWindow.tsx` mounts a `FloatingWindow` (`id="resume"`,
title "Zihan Lim · Resume", `corner="top-right"`, `keepMounted={false}`) with a
PDF `<iframe>` and an "Open in new tab" link. **`keepMounted` OFF, exactly as the
live-news TV does it**: closing or collapsing UNMOUNTS the iframe, so a closed
panel makes no request for the document — ADR-0104's "nothing loads until you
open it" principle. `corner="top-right"` keeps it off the Ask window
(bottom-right); both are draggable and remember position.

### 3. The rail author card owns the window
`SideRail` (in the layout, not remounted on nav) holds the `resumeOpen` state
and renders `ResumeWindow`, like `AskDock`/`LiveNewsDock` own their windows. The
card sits **above the `mt-auto` Narrow toggle**: a small avatar/`UserRound` icon
+ "Zihan Lim" ("Zihan" when collapsed) + "Built by · author of Andromeda" when
expanded, and a "Resume" / "CV" button. It stays reachable in both the 56px
collapsed and 200px expanded rail states. Uses the existing rail tokens and
lucide icons; no new dependency.

## Consequences

- The owner is credited on every page (the rail is persistent), with the resume
  one click away and readable in-app (PDF iframe) or in a new tab.
- The resume PDF is a tracked static asset; `docs/cv/` remains the source.
- The window is a second floating document surface alongside Ask and Live news,
  and it follows the same `keepMounted`-off privacy/perf contract.
- `--logo-plate` is not involved here (the author card uses paper tokens, not the
  brand navy); this ADR does not widen the plate fence.
