# Awesomic Editorial Zinc Grid — Migration Record

**Date:** 2026-09-29
**Scope:** Admin Studio OS (`/admin/**`, `src/components/admin/**`, `src/components/crew/**`)

## Design system

Light-only, achromatic zinc with a **single** accent. Defined in `src/app/globals.css` (`:root`), consumed as raw-hex arbitrary Tailwind classes (`bg-[#f4f4f5]`) — the convention used throughout the converted files.

| Token | Hex | Use |
|---|---|---|
| obsidian | `#09090b` | deepest ink; success / paid / complete |
| graphite | `#18181b` | working body ink; dark (`DarkPanel`) surfaces |
| slate | `#27272a` | dark surfaces |
| iron | `#3f3f46` | muted labels, outlined-button text |
| steel | `#52525b` | icon strokes, metadata |
| fog | `#71717a` | helper text |
| ash | `#a1a1aa` | placeholder, disabled |
| mist | `#d4d4d8` | subtle dividers |
| cloud | `#ececee` | **THE** primary border colour |
| paper | `#f4f4f5` | canvas |
| snow | `#ffffff` | elevated card surface |
| ember | `#ff5a00` | **the only accent** (text on white: `#c2410c`) |

Substitute surface: `#fafafa`.

### Rules
1. Ember is the only chromatic colour — reserved for high-priority badges, active/live production status, and critical alerts. Never body text, links, or large fills.
2. No `emerald`/`amber`/`rose`/`purple`/`blue`/`indigo`/`teal`/`green`/`orange`/`cyan`/`violet`/`pink`/`sky`/`lime`/`fuchsia`/`red`/`yellow` classes.
3. No `zinc`/`slate`/`gray`/`neutral`/`stone` grey utilities — use the tokens above.
4. No `backdrop-blur`. Surfaces are opaque; frosted glass was dropped.
5. Elevation is a 1px hairline (`border border-[#ececee]`), not a drop shadow.
6. Three radii: `12px` (badges/chips), `14px` (buttons/inputs), `36px` (cards). Nav CTAs: `10000px`.
7. Mobile-first: ≥44px (`min-h-11`) touch targets everywhere.

### State mapping
| Semantic | Treatment |
|---|---|
| success / paid / complete / accepted | obsidian `#09090b` (or `#a1a1aa` when muted) |
| pending / warning / in-review | Ember `#ff5a00` |
| danger / overdue / rejected / failed | Ember `#ff5a00` filled (or filled obsidian for "rejected") |
| neutral / info | `#ececee` border on `#ffffff` / `#fafafa` |

## Surfaces

`src/components/ui/glass.tsx` exports the **only** sanctioned surfaces:

```
Card        // rounded-[36px] border border-[#ececee] bg-white
CardInner   // rounded-[12px] border border-[#ececee] bg-[#fafafa]
DarkPanel   // rounded-[36px] bg-[#18181b] text-white   (studio-private only)
CardHeader  // { title, description?, badge?, action? }
Badge       // { variant: "ember" | "outline" | "filled" }
StatTile    // { label, value, hint? }
```

`GlassPanel` / `GlassInner` / `GlassSectionHeader` **do not exist** — do not reintroduce them.

## Dark mode: removed

Dark mode was deleted entirely, not disabled:

- Deleted `src/lib/theme.ts`, `src/lib/theme.server.ts`, `src/app/actions/theme.ts`, `src/components/admin/theme-toggle.tsx`.
- `src/app/layout.tsx` no longer reads a theme cookie or sets a `.dark` class.
- `globals.css` no longer declares `@custom-variant dark`, a `.dark` block, or a `prefers-color-scheme` query.

The `@custom-variant dark (&:where(.dark, .dark *))` line is important history: the design system shipped hardcoded **light** tokens, so an OS dark-mode setting previously activated every `dark:` utility against a light canvas — producing black blocks and invisible text. Binding `dark:` to an explicit class was the interim fix; removing dark mode entirely is the final one.

**All 899 `dark:` variants across 31 files were removed.**

## Legacy `.glass-*` shims

`globals.css` retains `.glass-panel` / `.glass-inner` / `.tab-pill-active` as **opaque hairlined shims** matching `Card`/`CardInner` weight, with no backdrop-blur. They exist only so any not-yet-migrated screen cannot render unstyled. No `.tsx` file in the admin surface references them any more; migrate to `Card`/`CardInner` rather than using them.

## Verification (post-migration)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npm run build` | **PASS** (25/25 routes) |
| `dark:` variants in `src/` | **0** |
| Chromatic classes in admin surface | **0** |
| Grey-utility classes in admin surface | **0** |
| `.glass-*` references in `.tsx` | **0** |
| `GlassPanel`/`GlassInner`/`GlassSectionHeader` | **0** |
| Theme plumbing references | **0** |

## Known remaining debt (pre-existing, out of scope)

`npm run lint` reports **12 errors** and **118 warnings**, none introduced by this migration. They live in files that were never part of the admin refactor:

- `src/app/actions/admin-customers.ts` — `@typescript-eslint/no-explicit-any` (×3)
- `src/app/actions/crew.ts` — `prefer-const`
- `src/app/gallery/[slug]/page.tsx` — `react-hooks/purity`, `no-explicit-any`
- `src/components/admin/calendar/calendar-dashboard-client.tsx` — `react-hooks/set-state-in-effect`
- `src/components/booking/booking-wizard.tsx` — `prefer-const`
- `src/components/client/moodboard/card-comment-drawer.tsx` — `react-hooks/set-state-in-effect` (×2)
- `src/components/client/moodboard/moodboard-view.tsx` — `react/no-unescaped-entities` (×2)

### Public / client surface is a separate design scope

`src/components/client/**`, `src/components/booking/**` and `src/app/gallery/**` still carry chromatic classes (~86 in total). These are the **public-facing** gallery, moodboard and booking flows, not the admin Studio OS. They were deliberately left alone — converting them is a separate design decision, not part of the admin re-foundation.

### Lint configuration notes

- `eslint-plugin-react-hooks` is at **v7**, which enables the React Compiler rule set as **errors**: `set-state-in-effect`, `purity`, `immutability`, `set-state-in-render`. These are genuine correctness rules. Patterns used to satisfy them during this migration:
  - *Adjust state on prop change* → compare-during-render with a `synced` state value, not a `useEffect`.
  - *Derived state from props* → compute during render; do not mirror into state.
  - *Fetch on mount* → hold the **promise** in `useState` and unwrap with React 19 `use()`. Never `useMemo(() => fetch())` (re-fires every render), never call `use()` inside a `useMemo`/`useEffect` callback (Rules of Hooks), and never mutate anything returned by `useState`.
  - *Impure values (`Date.now()`)* → capture once via `useState(() => Date.now())[0]`.
- `.archive/**` is lint-ignored in `eslint.config.mjs` — it is dead code.

## Audit findings beyond the design system

- `src/app/admin/login/page.tsx` was missing a `<Suspense>` boundary around `AdminLoginForm`, which reads `useSearchParams()`. This broke `next build` (prerender failure on `/admin/login`). Fixed.
- The `idr` currency helper is `@/lib/format`; `roundIdr` was an undefined phantom. Use `idr` for display.
- Dual-approval founder splits are owned by the Postgres function `public.approve_money_split` and must never be reimplemented client-side. Receipt numbering is minted by `public.next_document_number('RCP', 'YYYY-MM')` — never a JS sequence.
