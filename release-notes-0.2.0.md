## Summary

- Promote the app version to `0.2.0` and refresh release references in the English and Chinese READMEs.
- Fix main-process startup ordering so the meta-session control secret is initialized before the shared webhook server starts.
- Harden the real Codex provider integration tests by killing the full spawned process tree on Windows and guarding late child-close waits.

## Verification

- `npm run test:generate`
- `npm run typecheck`
- `npx vitest run`
- `npm run test:e2e`
- `npm run test:behavior-coverage`
