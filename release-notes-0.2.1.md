## Summary

- Fix packaged `stoa-ctl` on Windows releases by bundling the CLI into a self-contained ESM artifact instead of shipping a transpiled entrypoint with missing local dependencies.
- Add a release regression test that verifies `out/tools/stoa-ctl/index.mjs` can be imported directly by Node after the production build.
- Keep the existing Windows-first release posture for desktop artifacts while preserving the configured macOS and Linux targets for later platform-native release validation.

## Verification

- `npm run test:generate`
- `npm run typecheck`
- `npx vitest run`
- `npm run test:e2e`
- `npm run test:behavior-coverage`
