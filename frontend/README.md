# FleetMind frontend

React + TypeScript app for the dashboard rebuild. The live dashboard is still the static site in `../docs`.

## Run commands from the repo root

Always use `npm --prefix frontend ...`. Do not `cd frontend`.

```
npm --prefix frontend install
npm --prefix frontend run dev
npm --prefix frontend run build
npm --prefix frontend run lint
npm --prefix frontend install <package>
npx shadcn@latest add <names> --cwd frontend --yes
```

`build` currently writes to `frontend/dist` (ignored by git).

## What is installed

- Vite, React, TypeScript, oxlint
- Tailwind CSS v4 through the `@tailwindcss/vite` plugin
- `@/` path alias for `src/` (set in `tsconfig.json`, `tsconfig.app.json` and `vite.config.ts`)
- shadcn/ui (style `radix-nova`, neutral base colour, CSS variables): button, card, badge, input,
  table, tabs, tooltip, dialog, dropdown-menu, sheet, select, switch, scroll-area, separator, sonner.
  Components are in `src/components/ui`. Wrap the app in `TooltipProvider` before using tooltips.
- maplibre-gl, lucide-react, motion
- Manrope from Google Fonts (linked in `index.html`, set as `--font-sans` in `src/index.css`)
