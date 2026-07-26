---
name: Technical Precision
colors:
  surface: '#f6fafe'
  surface-dim: '#d6dade'
  surface-bright: '#f6fafe'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f4f8'
  surface-container: '#eaeef2'
  surface-container-high: '#e4e9ed'
  surface-container-highest: '#dfe3e7'
  on-surface: '#171c1f'
  on-surface-variant: '#45464d'
  inverse-surface: '#2c3134'
  inverse-on-surface: '#edf1f5'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#ba0035'
  on-secondary: '#ffffff'
  secondary-container: '#e21e49'
  on-secondary-container: '#fffbff'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#341100'
  on-tertiary-container: '#d95f00'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#ffdada'
  secondary-fixed-dim: '#ffb3b6'
  on-secondary-fixed: '#40000c'
  on-secondary-fixed-variant: '#920028'
  tertiary-fixed: '#ffdbca'
  tertiary-fixed-dim: '#ffb690'
  on-tertiary-fixed: '#341100'
  on-tertiary-fixed-variant: '#783200'
  background: '#f6fafe'
  on-background: '#171c1f'
  surface-variant: '#dfe3e7'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  body-base:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: 0em
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: -0.01em
  label-xs:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin-page: 24px
  card-padding: 20px
  density-compact: 8px
  density-comfortable: 16px
---

## Brand & Style

This design system is engineered for high-density, professional utility environments. The brand personality is "Pro-Tool Modern"—a synthesis of technical rigor and high-fidelity aesthetics. It prioritizes information density without sacrificing clarity, evoking a sense of calm under pressure.

The visual style is **Corporate / Modern** with a lean toward **Minimalism**. It utilizes a sophisticated, desaturated foundation to allow complex data visualizations and status accents to remain primary. The emotional response is one of reliability, precision, and surgical control. Key attributes include:
- **Engineered Logic:** Every element follows a strict geometric hierarchy.
- **High Fidelity:** Subtle depth and refined strokes suggest a premium, specialized tool.
- **Information Density:** Compact spacing and varied card types (charts, gauges, lists) are optimized for expert users.

## Colors

The palette is anchored in a professional, neutral foundation with high-contrast functional accents. 

- **Primary:** A deep Navy-Slate used for text, primary navigation, and structural emphasis.
- **Secondary/Tertiary:** High-energy Crimson and Burnt Orange are reserved for critical data points, status indicators, and subtle line-chart accents.
- **Neutrals:** A multi-layered scale of cool grays and slates defines the UI structure. The background is a clean, off-white slate that reduces eye strain in high-density layouts.
- **Functional Accents:** Utilize a muted "Success" Green and "Info" Blue specifically for data status, ensuring they remain distinct from the core brand colors.

## Typography

The typography strategy leverages a dual-font approach to separate narrative UI from technical data.

- **Hanken Grotesk** serves as the primary interface font. Its sharp, contemporary geometry provides a clean "tech" feel for headers and navigation.
- **JetBrains Mono** is strictly reserved for data values, table cells, and technical labels. This monospaced choice ensures that numerical data is vertically aligned and easily scannable in high-density tables.
- **Scale Strategy:** Headline sizes are kept relatively compact to maximize screen real estate. Use uppercase treatments for `label-xs` to create clear categorization in small-scale metadata.

## Layout & Spacing

This design system uses a **Fluid Grid** model with a hard 4px baseline shift. 

- **Grid:** A 12-column layout for desktop with 16px gutters. Elements should snap to column spans (e.g., 3-col sidebar, 9-col content).
- **Density:** High-density is the default. Information-heavy components (tables, lists) use 8px internal vertical padding. Dashboard cards use 20px padding to provide visual "breathing room" amidst complex charts.
- **Mobile Reflow:** On mobile (<768px), the grid collapses to a single column, with page margins reducing to 16px. Cards maintain internal padding but may hide secondary metadata columns in tables.

## Elevation & Depth

Visual hierarchy is established through **Tonal Layers** and **Low-Contrast Outlines** rather than aggressive shadows.

- **Surfaces:** The base layer is the page background. Cards and primary containers use a pure white surface.
- **Outlines:** All containers utilize a 1px solid border (`#E2E8F0`). This creates a crisp, "blueprint" feel.
- **Shadows:** Use a single, highly-diffused ambient shadow for active or floating elements (e.g., dropdowns, modals). The shadow should be tinted with the Primary color at 5-8% opacity to maintain a technical, clean look.
- **Active State:** Represent elevation changes via border-color shifts or subtle inner-glows rather than physical lifts.

## Shapes

The shape language balances technical precision with modern approachability.

- **Standard Radius:** UI components (buttons, inputs) use a 0.5rem (8px) radius.
- **Container Radius:** Dashboard cards and large containers use 1rem (16px) for the outer boundary and 0.5rem for internal nested elements to create a harmonious "nested-radius" effect.
- **Interactive Elements:** Small interactive icons or status chips use a "soft" radius (4px) to distinguish them from standard buttons.

## Components

- **Buttons:** Primary buttons use solid Navy-Slate with white text. Secondary buttons are outlined with a 1px border. "Ghost" buttons are used for utility actions within cards.
- **Dashboard Cards:** Every card must have a consistent header structure (Title on left, Actions/Timeframe on right). Use a 1px divider between the header and content body.
- **Data Tables:** Use JetBrains Mono for all numeric values. Row hover states should use a subtle gray fill (`#F8FAFC`). No vertical borders; use horizontal lines only for a cleaner horizontal scan.
- **Input Fields:** Minimalist style with a 1px border. On focus, the border shifts to the primary color with a 2px outer "halo" of the same color at 10% opacity.
- **Status Chips:** Small, pill-shaped indicators with low-opacity background tints (e.g., 10% Crimson background for "High Alert" with 100% Crimson text).
- **Gauges & Charts:** Use thin strokes (1.5pt to 2pt). For sparklines, use a subtle gradient fill below the line to anchor the data to the card base.