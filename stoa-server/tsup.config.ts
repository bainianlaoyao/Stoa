import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  // Bundle workspace dependencies (stoa-shared) into the output so the
  // compiled CJS file is self-contained at runtime.
  noExternal: ['stoa-shared'],
});
