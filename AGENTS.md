# AGENTS.md

## Global Instruction

All agents and contributors working in this repository must treat `docs/engineering/design-language.md` as a global visual and frontend constraint.

That file defines the authoritative design language for this project.

## Required Rule

For any UI, frontend, preview, or visual implementation work:

- Read and follow `docs/engineering/design-language.md`
- Do not introduce conflicting visual language unless the user explicitly requests it
- Do not hardcode visual primitives that should come from shared design tokens
- Preserve the project's Modern Minimalist Glassmorphism + Clean UI direction

## Priority

If a task touches styling, layout, panels, controls, previews, or renderer-facing components, the design-language document is a hard constraint, not a suggestion.

Only direct user instruction can override it.

不允许写任何兼容性代码, 做任何兼容性迁移行为. 我们处于原型开发阶段.所有改进做breaking change.
