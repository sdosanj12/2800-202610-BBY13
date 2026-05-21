# CSS Suggestions & Consistency Audit

## Overview

The app currently has **8 external CSS files** and **5 EJS templates with inline styles**.
Multiple teammates styled pages independently, leading to duplicated navbars, fragmented
color palettes, and inconsistent typography. The fixes below are ordered by impact.

---

## 1. Color Palette Fragmentation (High Priority)

Four different "navy" values appear across the codebase:

| Where | Hex | Notes |
|-------|-----|-------|
| style.css, login.css, signup.css, client-dashboard.css, request.css, volunteer-dashboard.css | `#1a3a5c` | Main palette |
| loggedout.ejs (inline) | `#1a2c4e` | Darker variant |
| admin-dashboard.ejs, admin-employees.ejs, admin-generate-codes.ejs (inline) | `#1a4f7a` | Lighter variant |
| inventory.css, clock.css | `#198754` | Green — not navy at all |

**Suggestion:** Pick `#1a3a5c` as the single primary color and update all others.
Define it once in a shared file (see item 6 below).

---

## 2. Font Family Inconsistency

| Pages | Font |
|-------|------|
| Most client-facing pages | Inter |
| inventory.ejs | Lexend Deca / Bricolage Grotesque |
| clock-in.ejs | Courier New (monospace) |
| loggedout.ejs | System font stack |
| Admin pages | DM Sans |

Navigating from the client dashboard to inventory shows a jarring typeface switch.

**Suggestion:** Standardize on **Inter** everywhere. If admin pages need a distinct feel,
DM Sans is acceptable but document it as intentional.

---

## 3. Duplicated Navbar & Footer Styles

The `.navbar`, `.nav-brand`, `.nav-links`, `.site-footer`, and `.footer-links` selectors
are copy-pasted across **6+ files**: style.css, login.css, signup.css, client-dashboard.css,
request.css, and loggedout.ejs. A single navbar change requires editing all of them.

**Suggestion:** Move shared navbar/footer CSS into **one file** (e.g. `public/shared.css`)
and `<link>` it from every page. Delete the duplicates from per-page files.

---

## 4. Inline CSS in EJS Templates

These templates embed all their styles in `<style>` tags instead of external files:

- `loggedout.ejs` — 184 lines of CSS
- `admin-dashboard.ejs` — ~150 lines
- `admin-employees.ejs` — ~150 lines
- `admin-generate-codes.ejs` — ~100 lines
- `admin-login.ejs` — shares login.css but adds inline overrides

**Suggestion:** Extract each into a dedicated `.css` file (e.g. `admin-dashboard.css`
already exists for the admin side). This enables browser caching, deduplication, and
easier maintenance.

---

## 5. Inconsistent Border-Radius Scale

Values found: 3px, 4px, 6px, 8px, 10px, 12px, 16px, 20px, 999px (pill buttons in request.css).

Login buttons are rectangular (`6px`), request form buttons are pills (`999px`).

**Suggestion:** Adopt a consistent scale: `4px` (small), `8px` (medium), `16px` (large).
Reserve `999px` only for avatar circles or pill badges — not primary action buttons.

---

## 6. No Shared Design Tokens

`style.css` defines CSS custom properties (`--color-navy`, `--space-md`, `--radius-lg`)
but other files either redefine them with different values or hard-code raw hex/px values.

**Suggestion:** Create a **`public/tokens.css`** with the canonical set of variables:

```css
:root {
  /* Colors */
  --color-navy:       #1a3a5c;
  --color-navy-dark:  #142d47;
  --color-navy-light: #eaf0f7;
  --color-success:    #16a34a;
  --color-danger:     #dc2626;
  --color-warning:    #b45309;
  --color-text:       #1a1a2e;
  --color-muted:      #6b7280;

  /* Spacing */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;

  /* Radii */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;

  /* Typography */
  --font-body: "Inter", sans-serif;
}
```

Link this **before** all per-page stylesheets and reference variables everywhere.

---

## 7. Responsive Design Gaps

| Page | Media Queries | Issue |
|------|---------------|-------|
| inventory.ejs | None | Breaks on mobile — table overflows |
| loggedout.ejs | None | Card padding doesn't adjust |
| clock-in.ejs | 768px, 576px | Bootstrap breakpoints, different from 600px used elsewhere |
| volunteer-dashboard.ejs | Only 900px, 640px | Missing tablet (768px) breakpoint |

**Suggestion:** Use consistent breakpoints across all files:
- `640px` — mobile
- `768px` — tablet
- `1024px` — desktop

Add at minimum a `640px` query to inventory.ejs and loggedout.ejs.

---

## 8. Accessibility Concerns

### Missing Focus States
- `volunteer-dashboard.css`: `.sidebar-link`, `.notif-action-btn` have no `:focus` style
- `request.css`: `.form-select` lacks a visible focus ring

### Font Sizes Too Small
- `request.css` `.form-section-title`: **0.72rem** (11.5px) — below WCAG minimum
- `volunteer-dashboard.css` `.notif-card__label`: **0.7rem** (11.2px) — too small

**Suggestion:** Minimum font size should be `0.75rem` (12px). Add
`outline: 2px solid var(--color-navy)` as a `:focus-visible` style on all
interactive elements that currently lack one.

### Color Contrast
- `inventory.css` `.location-tag` text (`#475569` on `#eef2f7`) is borderline at 4.5:1
- Ensure all text/background combos pass WCAG AA (4.5:1 for normal text)

---

## 9. Quick Wins

These are small changes that improve consistency immediately:

1. **loggedout.ejs** — change `#1a2c4e` to `#1a3a5c` (2 places)
2. **request.css** — change `.btn-submit` border-radius from `999px` to `8px`
3. **inventory.css** — remove the `body { font-family: var(--primary-font); }` override
   that forces Lexend Deca on the entire page
4. **clock.css** — replace `font-family: "Courier New"` with `"Inter", sans-serif`
5. **admin pages** — change `--blue-dark: #1a4f7a` to `--blue-dark: #1a3a5c`

---

## Summary

| Category | Severity | Effort |
|----------|----------|--------|
| Color fragmentation | High | Low — find-and-replace hex values |
| Font inconsistency | High | Low — change 4 font-family declarations |
| Duplicated navbar/footer | High | Medium — extract shared CSS file |
| Inline styles in EJS | Medium | Medium — create external CSS files |
| Design tokens file | Medium | Low — create tokens.css, link everywhere |
| Responsive gaps | Medium | Medium — add media queries to 3 pages |
| Accessibility | Medium | Low — add focus styles, bump font sizes |
| Border-radius scale | Low | Low — standardize to 3 values |
