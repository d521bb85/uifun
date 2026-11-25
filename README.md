# uifun

Interactive UI experimentation laboratory and showcase, served at [ui.ivanen.co](https://ui.ivanen.co).

Built with React 19, Vite, TypeScript, Tailwind CSS v4, Motion, [UI SDK](https://ui-sdk.dev/), TanStack Router, and Biome — deployed to Cloudflare Workers Static Assets.

## Requirements

- Node.js 22.12+
- pnpm 10 (`corepack enable` installs the version pinned in `package.json`)
- A Cloudflare account for deployment

## Scripts

```bash
pnpm install
pnpm dev
```

- `pnpm dev` runs the Vite development server.
- `pnpm check` runs TypeScript type-checking (`tsc --noEmit`) and Biome linting/formatting checks.
- `pnpm fix` auto-formats and fixes lint issues with Biome.
- `pnpm test` runs unit tests with Vitest (`pnpm test:watch` for watch mode).
- `pnpm build` creates the production build in `dist/`.
- `pnpm preview` previews the Vite production build locally.
- `pnpm cf:dev` builds and runs the real Worker locally with Wrangler.
- `pnpm release` checks, builds, and deploys to production.
- `pnpm rollback` puts the previous production version back.

Note: `pnpm deploy` is a built-in pnpm command, not this project's script. Use `pnpm release` (or `pnpm run deploy`, which skips checks).

## Adding an Experiment

Create a folder under `src/experiments/<slug>/index.tsx`:

```tsx
import { defineExperiment } from "@/lib/define-experiment";

export default defineExperiment({
  title: "Magnetic Toggle",
  date: "2026-11-24",
  tags: ["switch", "spring"],
  description: "Spring-loaded toggle built with UI SDK behaviors.",
  component: function MagneticToggle() {
    return <div>...</div>;
  },
});
```

Experiments are automatically discovered, sorted newest-first, code-split, and accessible by direct link at `/e/<slug>`. The root path `/` currently redirects to [ivanen.co](https://ivanen.co).

## Releasing

The site is a Cloudflare Worker named `uifun`, configured in `wrangler.jsonc`, serving `ui.ivanen.co`.

Releases are made by hand. `.github/workflows/check.yml` checks and builds each push to `main` and each pull request; it deploys nothing.

Sign in once:

```bash
pnpm exec wrangler login
```

Then release:

```bash
pnpm release
```

### If a release goes wrong

```bash
pnpm rollback
```

`pnpm exec wrangler deployments list` shows the recent versions.
