## Summary

- Fix provider sidecar ownership so Stoa no longer overwrites user-owned Claude and Codex project configuration files during install/uninstall flows.
- Preserve user Claude project/local settings, remove only Stoa-managed Claude hooks, and fail fast instead of overwriting malformed `settings.json`.
- Preserve user Codex project `config.toml`, remove only Stoa-managed hook blocks, and keep managed-sidecar cleanup from deleting preserved config artifacts.

## Verification

- `npm run test:generate`
- `npm run typecheck`
- `npx vitest run`
- `npm run test:e2e`
- `npm run test:behavior-coverage`
