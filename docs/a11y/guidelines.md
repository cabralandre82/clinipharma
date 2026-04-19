# Accessibility Guidelines

| Field         | Value                                          |
| ------------- | ---------------------------------------------- |
| Owner         | Engineering / Design                           |
| Last reviewed | 2026-04-18                                     |
| Conformance   | WCAG 2.1 Level AA (production target)          |
| Enforcement   | `STRICT_A11Y=1` axe-core scan in CI (blocking) |

The platform serves Brazilian healthcare professionals. Any clinic
operator, doctor, or pharmacy clerk must be able to use it with a
keyboard, a screen reader, low-vision settings, or a motor disability.
That is a legal requirement (Lei Brasileira de Inclusão, art. 63) and
a moral one.

## 1. Hard rules (CI-enforced)

These are checked automatically every push to `main` via the
`smoke-a11y.test.ts` Playwright job. A regression drops the build.

- **Zero critical/serious axe-core violations** under WCAG 2.1 A and
  AA tags on the public pages: `/login`, `/forgot-password`,
  `/registro`, `/terms`, `/privacy`, `/dpo`, `/trust`, `/status`.
- Same scan also runs on a **mobile (Pixel 5)** viewport — catches
  tap-target spacing, reflow @ 320 CSS px, viewport-meta misuse.

## 2. Soft rules (PR review)

Caught during code review or in the periodic A11y inventory script
(`scripts/a11y-inventory.mjs`). These do not block CI but PRs that
introduce a regression should be revisited.

- Tab order matches visual order. Use semantic markup (`<button>`,
  `<a>`, `<form>`) instead of `<div onClick>`. The
  `jsx-a11y/click-events-have-key-events` ESLint rule catches the
  most common drift; a deliberate exception requires a colocated
  `eslint-disable-next-line` with a one-line justification.
- Visible focus ring on every interactive element. Tailwind: prefer
  `focus-visible:outline-2 focus-visible:outline-[hsl(196,91%,33%)]`
  over `focus:outline-none`. We **never** strip the focus indicator
  globally.
- Color contrast ≥ 4.5 : 1 for body text, ≥ 3 : 1 for large text
  (≥ 18 pt). Brand teal (`hsl(196,91%,33%)`) and slate-600 satisfy
  this on white. Do NOT introduce text-slate-400 / text-gray-400 on
  light backgrounds.
- Form fields have an associated `<Label htmlFor>`. Shadcn's
  `<Label>` component is the canonical way; raw `<label>` triggers
  `jsx-a11y/label-has-associated-control` warnings.
- Iconography embedded in interactive controls has either an
  `aria-label` on the control OR an accompanying visible text.
  Lucide icons get `aria-hidden="true"` when the surrounding
  control already has accessible text.

## 3. Patterns we use

### 3.1 Skip-to-main link

`app/layout.tsx` ships an `<a href="#main">` link as the first focusable
element on every page. Pages anchor `<main id="main">` (already wired
in `LegalLayout`, `Shell`, `(auth)/layout.tsx`, `/status`).

If a route lacks an `id="main"` anchor the skip-link silently no-ops.
That's preferable to a broken anchor — but please add one when you
introduce a new top-level layout.

### 3.2 Visually hidden but screen-reader-announced

Use Tailwind's `sr-only` for content that must be read but not seen.
Combine with `focus:not-sr-only` to make focus-visible UI like the
skip-link possible.

### 3.3 ARIA attributes (sparingly)

Native HTML semantics first; ARIA second. The order of preference is:

1. The right semantic element (`<button>` over `role="button"`).
2. A native attribute (`disabled` over `aria-disabled`).
3. `aria-label` when no visible label is possible (icon-only
   buttons: `<button aria-label="Ocultar senha">`).
4. `aria-pressed`, `aria-expanded`, `aria-current` for stateful
   controls. The login-form eye-toggle is a working reference.

### 3.4 Toggles and dropdown backdrops

A click-outside backdrop is an interactive surface. Use a
`<button tabIndex={-1} aria-hidden="true">` instead of a `<div>`
with an `onClick` — the lint rule
`jsx-a11y/no-static-element-interactions` will refuse the latter.
References: `components/shared/date-range-picker.tsx`,
`components/shared/export-button.tsx`.

### 3.5 Reduced motion

Wrap any non-essential animation in `motion-safe:` so users who set
`prefers-reduced-motion: reduce` get a still image:

```tsx
<div className="motion-safe:animate-pulse motion-reduce:opacity-90" />
```

Mandatory for: loading spinners that cycle indefinitely, hero
transitions on the marketing surface (none today), and any toast
that shakes/bounces.

### 3.6 Toast / status messages

Sonner toasts ship with `role="status"` and `aria-live="polite"` by
default; we keep the defaults. Never invent your own toast — funnel
through the Sonner `toast()` API.

## 4. Audit cadence

| Cadence   | Action                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Per PR    | CI runs `STRICT_A11Y=1 smoke-a11y` on 8 pages × 2 viewports.                                                                                                             |
| Quarterly | Manual review with a screen reader (NVDA on Windows or VoiceOver on macOS) of the primary order-creation flow.                                                           |
| Half-year | Run `scripts/a11y-inventory.mjs` against staging; triage any new soft warnings into a focused sprint.                                                                    |
| Annually  | External a11y audit (third-party, scope = public + key authenticated paths). Trigger to schedule: any time the platform serves a customer with > 100 daily active users. |

## 5. When in doubt

Two heuristics that resolve most arguments:

1. _"Could a keyboard-only user complete this flow without a mouse?"_
   Try it. Open the page, press Tab repeatedly, and ensure every
   interactive element receives focus and can be activated with
   Enter / Space.
2. _"Could a screen-reader user understand the meaning of this
   element from the announcement alone?"_ Inspect the accessibility
   tree (Chrome DevTools → Accessibility panel) and read what's
   actually exposed.

If either answer is "no", the design is incomplete — not the user's
fault, not their device's fault.

## 6. References

- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [Inclusive Components by Heydon Pickering](https://inclusive-components.design/)
- [axe-core rule documentation](https://dequeuniversity.com/rules/axe/)
- Internal: `tests/e2e/smoke-a11y.test.ts`,
  `scripts/a11y-inventory.mjs`, `eslint.config.mjs`.

## 7. Change log

| Date       | Change                                                                |
| ---------- | --------------------------------------------------------------------- |
| 2026-04-18 | Initial publication. Hard rules, soft rules, patterns, audit cadence. |
