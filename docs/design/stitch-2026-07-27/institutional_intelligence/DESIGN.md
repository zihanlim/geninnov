---
name: Institutional Intelligence
colors:
  surface: '#fcf8fa'
  surface-dim: '#dcd9db'
  surface-bright: '#fcf8fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f5'
  surface-container: '#f0edef'
  surface-container-high: '#eae7e9'
  surface-container-highest: '#e4e2e4'
  on-surface: '#1b1b1d'
  on-surface-variant: '#45464d'
  inverse-surface: '#303032'
  inverse-on-surface: '#f3f0f2'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#0058be'
  on-secondary: '#ffffff'
  secondary-container: '#2170e4'
  on-secondary-container: '#fefcff'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#271901'
  on-tertiary-container: '#98805d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#fcdeb5'
  tertiary-fixed-dim: '#dec29a'
  on-tertiary-fixed: '#271901'
  on-tertiary-fixed-variant: '#574425'
  background: '#fcf8fa'
  on-background: '#1b1b1d'
  surface-variant: '#e4e2e4'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  data-tabular:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: -0.01em
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  margin: 24px
---

## Brand & Style

This design system is engineered for high-stakes financial environments where information density and clarity are paramount. The aesthetic is a refined evolution of **Corporate Modern** with subtle **Glassmorphism**, prioritizing technical precision over decorative flair. 

The target audience consists of analysts, traders, and decision-makers who require "at-a-glance" comprehension of complex data. The UI evokes a sense of institutional stability, calmness under pressure, and mathematical accuracy.

**Visual Principles:**
- **Clarity over Decoration:** Every line and shadow must serve a functional purpose in establishing hierarchy.
- **Micro-interactions:** Transitions should be instantaneous and crisp, reflecting the real-time nature of financial data.
- **Reduced Cognitive Load:** Use subtle tonal shifts instead of heavy borders to separate data modules.

## Colors

The palette is anchored in a sophisticated range of "Slate" and "Cool Gray" to maintain a neutral environment that allows data indicators to stand out.

- **Background & Surfaces:** A base of `F8FAFC` (Off-white) provides a clean canvas. Cards and containers use pure white or semi-transparent white for glassmorphic effects.
- **Primary Text:** `0F172A` (Slate 900) ensures maximum legibility and an authoritative tone.
- **Functional Accents:**
    - **Blue (Action):** Used for interactive elements and primary call-to-actions.
    - **Emerald (Growth):** Specifically reserved for positive market movement and "Success" states.
    - **Amber (Caution):** Used for volatile data or "Warning" thresholds.
    - **Red (Loss):** Used for negative movement and critical errors.

## Typography

This design system utilizes a dual-font strategy to balance UI navigation with data integrity.

- **UI Sans (Geist/Inter):** Used for all structural labels, headings, and interface instructions. Geist provides a modern, technical feel for headlines, while Inter handles dense body copy with exceptional legibility.
- **Tabular Mono (JetBrains Mono):** Mandatory for all numeric values, price tickers, and timestamps. This ensures that columns of numbers align perfectly (tabular figures), allowing for faster vertical scanning and comparison.
- **Hierarchy:** Use `label-caps` for secondary metadata and table headers to create a distinct visual break from content.

## Layout & Spacing

The layout follows a **Fluid Grid** model with a high-density philosophy. Information is organized into modular cards that reflow based on screen real estate.

- **Grid System:** A 12-column grid for desktop with 16px gutters.
- **Density:** We utilize a 4px baseline grid. Padding within cards is typically tight (`12px` to `16px`) to maximize data visibility without creating clutter.
- **Responsive Behavior:** 
  - **Desktop:** Multi-pane view with a persistent slim sidebar (collapsed) or full sidebar (expanded).
  - **Tablet:** Two-column stack; cards collapse to 100% width.
  - **Mobile:** Single-column vertical flow with critical "Quick Actions" anchored to the bottom.

## Elevation & Depth

Depth is used sparingly to define hierarchy without compromising the clean, technical aesthetic.

- **Surface Tiers:**
  - **Level 0 (Background):** `F8FAFC`.
  - **Level 1 (Card/Container):** Pure white background with a `0.5px` border in Slate-200.
  - **Level 2 (Hover/Active):** Subtle 4% opacity shadow with a 8px blur, slightly tinted with the primary navy color to avoid "dirty" grays.
- **Glassmorphism:** Apply a `backdrop-filter: blur(12px)` to top navigation bars and modal overlays to maintain context of the underlying data while focusing the user.
- **Outlines:** Instead of heavy shadows, use low-opacity inner borders (0.5px) to give elements a "milled" or "machined" look.

## Shapes

The shape language is disciplined and geometric. 

- **Containers:** Cards and primary modules use a `12px` (`rounded-lg`) radius to soften the technical edge of the data.
- **UI Elements:** Buttons and input fields use a `8px` (`base`) radius.
- **Indicators:** Small status dots and tags (e.g., "Active" or "Pending") use a full pill-shape (`999px`) to distinguish them from structural elements.

## Components

### Buttons & Inputs
- **Primary Action:** Solid Slate-900 with white text. High contrast, sharp corners (8px).
- **Secondary Action:** Ghost style with 0.5px Slate-200 border.
- **Input Fields:** Flat background (`F1F5F9`) that shifts to white with a 1px Blue-500 border on focus.

### Data Modules (Cards)
- **Header:** Integrated headline-sm with optional "More" (ellipsis) menu.
- **Content:** Strict adherence to the 16px internal padding.
- **Footer:** Separated by a 0.5px horizontal rule for secondary metadata or export actions.

### Financial Indicators
- **Trend Chips:** Small, low-saturation backgrounds (e.g., 10% opacity Emerald) with high-saturation text and a micro-icon (arrow up/down) for instant directionality.
- **Data Grids:** Use zebra-striping (very faint Slate-50) only for tables exceeding 10 rows. Otherwise, use horizontal rules.

### Navigation
- **Sidebar:** Icons only by default to maximize workspace. Active state is indicated by a vertical 2px Blue-500 bar on the leading edge.