# ADR-0002 — Vercel for frontend hosting

- Status: accepted
- Date: 2026-07-21
- Tags: ops, infrastructure

## Context

The Next.js frontend needs zero-configuration deployment with GitHub auto-deploy on push to main. A VPS with Docker Compose was one option, but adds server management without adding value at this stage.

## Decision

Host the Next.js frontend on Vercel. Push to GitHub → Vercel auto-deploys. No server to manage.

## Consequences

### Positive
- Zero-configuration: connect repo → auto-deploys, no server setup
- No cost for moderate traffic
- Native Next.js 14 App Router support

### Negative
- Platform lock-in: migrating away from Vercel requires a new deployment pipeline
- Usage limits on free tier (100GB bandwidth/mo)

### Neutral
- Can add a custom domain in Vercel settings

## Alternatives considered

### Docker Compose on a VPS
What it was: Next.js running in a container on a VPS.
Why we ruled it out: Adds VPS cost and management overhead. No benefit over Vercel for this use case.

### AWS Amplify / Cloudflare Pages
What it was: Other hosted Next.js options.
Why we ruled them out: Vercel has better Next.js App Router integration and a more mature free tier.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md`
