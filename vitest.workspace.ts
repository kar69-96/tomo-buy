import { defineWorkspace } from 'vitest/config';

// Each package/app owns its vitest.config.ts; this aggregates them so a single
// `pnpm vitest` (or root `pnpm test` via turbo) runs the whole workspace.
export default defineWorkspace(['packages/*', 'apps/*']);
