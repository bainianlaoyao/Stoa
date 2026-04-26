---
date: 2026-04-27
topic: Stoa promotion platform and copy verification
status: completed
mode: context-gathering
sources: 7
---

## Context Report: Stoa Promotion Platform And Copy

### Why This Was Gathered

The user asked which promotion platforms to use for Stoa and what copy to publish. Current candidates are WeChat Moments and LINUX DO.

### Summary

Use LINUX DO as the primary public launch channel if the project can satisfy its open-source promotion requirements. Use WeChat Moments as a secondary warm-network post for early feedback, not as the main acquisition channel. Avoid overclaiming "open source" until a formal LICENSE exists; current repository docs say no formal license has been declared.

### Key Findings

- Stoa's strongest verified pitch is: local-first AI development desktop console for multiple projects, multiple agents, and multiple CLI sessions, with high test coverage and provider support.
- The project docs claim "完全开源", but also state that no formal license has been declared. External copy should either add a LICENSE before posting or say "源码公开 / public source" instead of making a complete open-source licensing claim.
- LINUX DO has a current "开源推广" path. Its March 18, 2026 announcement says complete open-source projects that link back to LINUX DO can use an open-source promotion declaration in public sections.
- LINUX DO's open-source promotion template requires the post to use `#开源推广`, declare that the project is fully open source with no closed parts, declare that it links back to LINUX DO, and disclose AI-generated/polished introduction content according to the template.
- LINUX DO's broader rules also restrict ordinary promotion frequency, require promotion labels, and prohibit diverting users to other communities.
- A recent LINUX DO discussion confirms the latest open-source promotion approach is looser than older rules: use the open-source promotion template and place a LINUX DO friend link in the GitHub project.
- WeChat Moments is suitable for social proof and feedback from known contacts, but it is not a public developer discovery channel. Keep copy personal, factual, and avoid incentive-based reposting or "please forward for rewards" mechanics.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Stoa is positioned as a local AI coding workbench for multi-project, multi-agent, multi-CLI sessions | README.md | `README.md:9`, `README.md:11` |
| Stoa highlights provider support for Claude Code, OpenCode, Codex, and Shell | README.md | `README.md:92` |
| Stoa says no formal license has been declared | README.en.md | `README.en.md:241`, `README.en.md:243` |
| LINUX DO announced a separate open-source promotion tag and rule path | LINUX DO announcement | https://linux.do/t/topic/1776670 |
| LINUX DO open-source promotion requires full open source, LINUX DO recognition link, `#开源推广`, and AI-content disclosure | LINUX DO announcement | https://linux.do/t/topic/1776670 |
| LINUX DO broader promotion rules include labels, frequency limits, and no community diversion | LINUX DO rules | https://wiki.linux.do/LinuxDo/rules |
| A recent LINUX DO discussion says the latest rule is to use the open-source promotion template and add a LINUX DO friend link in the GitHub project | LINUX DO discussion | https://linux.do/t/topic/1920305 |

### Risks / Unknowns

- [!] If no LICENSE is added before launch, the project may not cleanly satisfy "完整开源" for LINUX DO's open-source promotion declaration.
- [!] If the LINUX DO post includes QQ/TG/group/community diversion, it may conflict with community promotion norms.
- [?] The final GitHub release URL and download artifacts were not supplied in the prompt, so copy uses placeholders.
- [?] WeChat Moments has less public, auditable organic-post guidance than LINUX DO; compliance should be conservative and avoid inducement or exaggerated claims.

## Context Handoff: Stoa Promotion Platform And Copy

Start here: `research/2026-04-27-stoa-promotion-platform-copy.md`

Context only. Use the saved report as the source of truth.
