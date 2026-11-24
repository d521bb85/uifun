# AGENTS.md

## UI SDK

This project uses `@ui-sdk/react` and `@ui-sdk/core` for interaction behaviors and accessible UI primitives.

Before using `ui-sdk`, follow the `ui-sdk` skill if it's installed (`.agents/skills/ui-sdk`), and read `node_modules/@ui-sdk/react/docs/llms.txt`.
To build a new custom component or behavior primitive, also search `node_modules/@ui-sdk/react/docs/core.md` by heading, and read `node_modules/@ui-sdk/react/docs/rendering.md` next to it.

## Adding a UI Experiment

1. Create a folder under `src/experiments/<slug>/index.tsx` (kebab-case slug).
2. Export a default object created with `defineExperiment({ title, date, tags, description?, component })` from `@/lib/define-experiment`.
3. Experiments are auto-discovered and lazy-loaded via `import.meta.glob` in `src/lib/registry.ts` — no manual route or registry edits are needed.
4. Use `useStageActive()` from `@/components/stage/StageContext` to pause heavy `requestAnimationFrame` loops or timers when an experiment card is scrolled off-screen.
5. Run `pnpm run check` and `pnpm run build` before finishing.
