---
date: 2026-05-24
topic: README review best practices for open-source desktop workbench
status: completed
mode: context-gathering
sources: 12
---

## Context Report: README Review Best Practices for an Open-Source Desktop Workbench

### Why This Was Gathered
Building a strict review rubric for evaluating an open-source README. The product is a local-first Electron desktop workbench that manages Claude Code, Codex, OpenCode, and other AI CLI sessions. The rubric must cover: product category definition, truthful capability boundaries, non-marketing tone, LLM/search friendliness, information hierarchy, and open-source trust preservation.

### Summary
Community best practices converge on a small set of review criteria: the README must immediately classify what the product is and is not, use plain language over marketing, follow a predictable information hierarchy, and include explicit status/maturity statements. A newer but increasingly standardized concern is LLM-citation friendliness via structured markdown and the emerging `llms.txt` convention. No single source covers all six criteria; this report synthesizes across pyOpenSci (review checklist), CFPB (plain-language mandate), Daytona (hierarchy), dbader.org (minimalism), llms-txt spec (machine readability), and DEV community (LLM-friendly docs).

### Key Findings

#### 1. Clear Product Category Definition

Every major guide agrees: the first 1-3 sentences must state what the project is, what problem it solves, and where it fits in the ecosystem.

- **pyOpenSci** requires "an easy-to-understand explanation (2-4 sentences) of what your tool does" and "context for how the tool fits into the broader ecosystem." If a library wraps another, it must link to the wrapped package. ([pyOpenSci README guidelines](https://www.pyopensci.org/python-package-guide/documentation/repository-files/readme-file-best-practices.html))
- **CFPB open-source template** mandates "a meaningful, short, plain-language description of what this project is trying to accomplish and why it matters. Describe the problem(s) this project solves." It also requires stating the **Technology stack** and **Status** (Alpha, Beta, 1.1, etc.). ([CFPB README template](https://github.com/cfpb/open-source-project-template/blob/main/README.md))
- **Daytona (4000-star case study)** calls this "The Elevator Pitch": "a concise, one-liner that encapsulates the essence of your project, followed by a compelling sub-title that provides additional context." ([Daytona blog](https://www.daytona.io/dotfiles/how-to-write-4000-stars-github-readme-for-your-project))
- **dbader.org** says: "Potential users should be able to figure out quickly what the purpose of the project is. Make sure to get this information across early on." ([dbader.org](https://dbader.org/blog/write-a-great-readme-for-your-github-project))

**Rubric criteria derived:**
- [ ] First 1-3 sentences name the product category (e.g., "desktop workbench for AI CLI sessions") without relying on the reader's prior knowledge
- [ ] The description states what problem the tool solves and for whom
- [ ] The broader ecosystem context is given (what tools it manages/competes with/complements)
- [ ] Technology stack and platform are stated explicitly

#### 2. Truthful Capability Boundaries

This is the most important trust criterion and the least well-covered by generic README guides. The evidence comes from indirect sources:

- **CFPB template** requires a **"Known issues"** section: "Document any known significant shortcomings with the software." This is an explicit mandate to surface limitations. ([CFPB README template](https://github.com/cfpb/open-source-project-template/blob/main/README.md))
- **CFPB template** also requires stating **Status** (Alpha, Beta, 1.1) — this sets maturity expectations. ([CFPB README template](https://github.com/cfpb/open-source-project-template/blob/main/README.md))
- **pyOpenSci** requires linking to wrapped packages and their documentation, implicitly preventing the README from claiming capabilities that belong to upstream tools. ([pyOpenSci guidelines](https://www.pyopensci.org/python-package-guide/documentation/repository-files/readme-file-best-practices.html))
- **The Daytona case study** warns: "avoid unnecessarily long README files, as they can deter users and contributors who may perceive the project as overly complex." This implicitly argues against overclaiming scope. ([Daytona blog](https://www.daytona.io/dotfiles/how-to-write-4000-stars-github-readme-for-your-project))
- **jehna/readme-best-practices** template includes a **Features** section that lists only what the project *actually does*, not aspirational features. ([jehna/readme-best-practices](https://github.com/jehna/readme-best-practices))

**Rubric criteria derived:**
- [ ] Status/maturity is stated honestly (alpha/beta/stable) with version number
- [ ] Known issues or limitations are documented explicitly
- [ ] The README does not claim capabilities provided by managed tools (Claude Code, Codex, etc.) as its own
- [ ] Feature lists are bounded — only shipped features, not roadmap items
- [ ] Any "wraps" or "manages" relationship to upstream tools is clearly stated

#### 3. Human-Readable Non-Marketing Tone

- **pyOpenSci** explicitly says: "The language in this description should use less technical terms so that a variety of users with varying scientific (and development) backgrounds can understand it." It recommends "consider writing for a high school level." ([pyOpenSci guidelines](https://www.pyopensci.org/python-package-guide/documentation/repository-files/readme-file-best-practices.html))
- **CFPB template** requires "plain-language description" — no buzzwords. ([CFPB README template](https://github.com/cfpb/open-source-project-template/blob/main/README.md))
- **Utrecht University reproducibility guide** says: "Be concise — Keep it readable; avoid long blocks of text." ([Utrecht University](https://utrechtuniversity.github.io/workshop-computational-reproducibility/chapters/readme-files.html))
- **The strategic developer marketing guide** notes that developers are "skeptical of traditional marketing" — honesty and technical precision build more trust than superlatives. ([StrategicNerds developer marketing guide](https://www.strategicnerds.com/blog/the-complete-developer-marketing-guide-2026))
- **DEV community LLM-friendly docs article** says: "LLMs (and humans) parse concise, imperative phrasing more effectively." Replace vague hedging with direct statements. ([DEV community](https://dev.to/joshtom/optimizing-technical-documentations-for-llms-4bcd))

**Rubric criteria derived:**
- [ ] Language is plain, direct, imperative — no superlatives ("blazing fast", "revolutionary")
- [ ] Technical terms are defined on first use or linked
- [ ] No hype adjectives or aspirational language in feature descriptions
- [ ] Sentences are short and scannable; no paragraph walls

#### 4. Search/LLM-Summary/Citation Friendliness

This is the newest and fastest-evolving criterion area.

- **llms.txt specification (AnswerDotAI)** proposes a standard `/llms.txt` file with: H1 project name → blockquote summary → detail sections → H2-delimited file lists with hyperlinks. The format is "human and LLM readable, but also in a precise format allowing fixed processing methods." Key guidelines: "Use concise, clear language. When linking to resources, include brief, informative descriptions. Avoid ambiguous terms or unexplained jargon." ([AnswerDotAI/llms-txt](https://github.com/AnswerDotAI/llms-txt))
- **DEV community LLM docs article** says: "Traditional documentation is written for humans. It assumes the reader can cross check references, scan changelogs, and adapt examples to newer versions. LLMs don't do this. They rely on explicit patterns in the text." Specific techniques: use clear consistent headings, pair explanations with practical examples, define acronyms on first use, state defaults explicitly, avoid ambiguous pronoun references. ([DEV community](https://dev.to/joshtom/optimizing-technical-documentations-for-llms-4bcd))
- **ReadMe.LLM academic framework (arXiv)** demonstrates that "LLMs perform poorly with traditional README.md files" and argues for documentation intentionally structured for machine comprehension. ([arXiv ReadMe.LLM](https://arxiv.org/html/2504.09798v3))
- **DEV community article** also recommends: "Provide an llms.txt file" and "Test your docs with LLMs." ([DEV community](https://dev.to/joshtom/optimizing-technical-documentations-for-llms-4bcd))

**Rubric criteria derived:**
- [ ] First H1 and opening paragraph contain enough context for an LLM to categorize and summarize the project without reading further
- [ ] Acronyms and project-specific terms are defined inline
- [ ] Headings use descriptive, searchable phrases (not "Advanced stuff" but "Configuring OAuth 2.0 Authentication")
- [ ] Code examples are complete and runnable, not fragments
- [ ] Consider providing an `llms.txt` or structured summary that LLMs can consume directly

#### 5. Information Hierarchy

All sources converge on a common ordering, with minor variations:

**Consensus hierarchy (top to bottom):**

1. **Logo/Title + Badges** — project identity and trust signals
2. **One-liner / Elevator pitch** — what it is, in one sentence
3. **Visual demo** — screenshot or GIF showing the product
4. **Feature highlights** — bullet list of key capabilities
5. **Quick start / Installation** — get running in minimal steps
6. **Usage examples** — how to use it after installing
7. **Configuration** — settings, env vars, config files
8. **Development / Contributing** — for contributors, not users
9. **License, Credits, Links** — legal and community signals

Sources:
- **Daytona** structures as: Logo → Badges → One-liner → Visual → Features → Quickstart → The Why → Backstory → Getting Started → Contributing → License → Code of Conduct → Support. ([Daytona blog](https://www.daytona.io/dotfiles/how-to-write-4000-stars-github-readme-for-your-project))
- **dbader.org** structures as: What it does → How to install → Example usage → Dev setup → How to ship a change → Changelog → License/author. ([dbader.org](https://dbader.org/blog/write-a-great-readme-for-your-github-project))
- **jehna/readme-best-practices** template: Logo+Title → Tagline → Description → Installing → Developing → Building → Deploying → Features → Configuration → Contributing → Links → Licensing. ([jehna template](https://github.com/jehna/readme-best-practices))
- **CFPB template**: Description → Screenshot → Dependencies → Installation → Configuration → Usage → Testing → Known issues → Getting help → Getting involved → Licensing → Credits. ([CFPB README template](https://github.com/cfpb/open-source-project-template/blob/main/README.md))
- **pyOpenSci checklist**: Name → Badges → Description → Ecosystem context → Quick-start code → Docs links → Tutorials → Citation. ([pyOpenSci guidelines](https://www.pyopensci.org/python-package-guide/documentation/repository-files/readme-file-best-practices.html))

**Rubric criteria derived:**
- [ ] Title and one-liner appear before any other content (above the fold)
- [ ] Visual demo appears within the first screenful
- [ ] Installation/quick-start appears before any conceptual explanation
- [ ] Contributor-facing sections (dev setup, contributing) appear after user-facing sections
- [ ] License and legal sections appear at the end

#### 6. Preserving Open-Source Trust/Boundary Statements

- **Daytona case study** emphasizes: "Badges Convey Trust at a Glance" — CI status, license, version badges "instill confidence in potential contributors, reassuring them that your project adheres to industry best practices." ([Daytona blog](https://www.daytona.io/dotfiles/how-to-write-4000-stars-github-readme-for-your-project))
- **CFPB template** requires explicit **Status** and **Known issues** sections — these are trust-building mechanisms. ([CFPB README template](https://github.com/cfpb/open-source-project-template/blob/main/README.md))
- **Daytona** also requires: Contributing guide, License, Code of Conduct, and Security (SECURITY.md) — collectively called "Project Hygiene Essentials." ([Daytona blog](https://www.daytona.io/dotfiles/how-to-write-4000-stars-github-readme-for-your-project))
- **pyOpenSci** uses the README as a quality gate: "An editor or the editor in chief will ask you to revise your README file before a review begins if it does not meet the criteria." This positions the README itself as a trust boundary. ([pyOpenSci guidelines](https://www.pyopensci.org/python-package-guide/documentation/repository-files/readme-file-best-practices.html))
- **Baserow open-core discussion** highlights community trust erosion when boundaries between open and proprietary are unclear. For a workbench that manages proprietary tools (Claude Code, Codex), stating the boundary between what is open-source and what is not is critical. ([Baserow community](https://community.baserow.io/t/open-core-concerns/1467))

**Rubric criteria derived:**
- [ ] License is clearly stated with link to full text
- [ ] The relationship between the open-source project and any managed/closed-source tools is explicitly stated
- [ ] Contributing guidelines are linked or included
- [ ] Code of Conduct is referenced
- [ ] Status/maturity is stated (no "production-ready" claims for alpha software)

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| README must have 2-4 sentence plain-language description with ecosystem context | pyOpenSci | https://www.pyopensci.org/python-package-guide/documentation/repository-files/readme-file-best-practices.html |
| CFPB requires "plain-language description", Known Issues, Status, Tech Stack | CFPB | https://github.com/cfpb/open-source-project-template/blob/main/README.md |
| "Elevator Pitch" one-liner + subtitle pattern | Daytona | https://www.daytona.io/dotfiles/how-to-write-4000-stars-github-readme-for-your-project |
| 7 mandatory elements: what it does, install, usage, dev setup, ship change, changelog, license | dbader.org | https://dbader.org/blog/write-a-great-readme-for-your-github-project |
| llms.txt specification: H1 → blockquote summary → sections → H2 file lists | AnswerDotAI | https://github.com/AnswerDotAI/llms-txt |
| LLM-friendly docs: clear headings, define acronyms, state defaults, avoid ambiguous pronouns | DEV community | https://dev.to/joshtom/optimizing-technical-documentations-for-llms-4bcd |
| ReadMe.LLM academic framework: traditional READMEs perform poorly for LLM comprehension | arXiv | https://arxiv.org/html/2504.09798v3 |
| "Be concise, include working commands, keep it updated" | Utrecht University | https://utrechtuniversity.github.io/workshop-computational-reproducibility/chapters/readme-files.html |
| Features section lists only actual capabilities, not aspirational | jehna | https://github.com/jehna/readme-best-practices |
| Badges convey trust; project hygiene: Contributing, License, CoC, Security | Daytona | https://www.daytona.io/dotfiles/how-to-write-4000-stars-github-readme-for-your-project |
| Open-core trust erosion when boundaries unclear | Baserow community | https://community.baserow.io/t/open-core-concerns/1467 |
| pyOpenSci uses README as quality gate before review begins | pyOpenSci | https://www.pyopensci.org/python-package-guide/documentation/repository-files/readme-file-best-practices.html |

### Risks / Unknowns

- [!] The `llms.txt` specification is still informal and community-driven. It may change. The core structural principles (H1 → summary → sections → file lists) are stable.
- [!] No source specifically addresses the README pattern for a "workbench that manages other CLI tools." The closest analogy is a desktop IDE or terminal multiplexer — but the trust boundary between the open-source workbench and managed proprietary tools (Claude Code, Codex) is novel.
- [?] The academic ReadMe.LLM paper proposes a structured metadata format beyond what the llms.txt spec covers. Whether this becomes standardized is unknown.
- [?] Rate-limiting on web search prevented gathering additional sources on trust boundary statements for projects that wrap/manage proprietary tools. The Baserow open-core discussion is the closest proxy found.

### Consolidated Review Rubric Draft

Based on the above findings, a rubric for reviewing the README would contain these checks:

**A. Product Category Definition (pass/fail)**
- A1: First 1-3 sentences name the product category
- A2: Problem statement and target audience are stated
- A3: Ecosystem context (what it manages/complements) is given
- A4: Tech stack and platform stated

**B. Truthful Capability Boundaries (pass/fail)**
- B1: Status/maturity stated (alpha/beta/stable) with version
- B2: Known issues or limitations documented
- B3: No claiming upstream tool capabilities as own
- B4: Feature list is bounded to shipped features only
- B5: Wraps/manages relationship to upstream tools stated

**C. Non-Marketing Tone (pass/fail)**
- C1: No superlatives or hype adjectives
- C2: Technical terms defined or linked
- C3: Short, scannable sentences
- C4: No aspirational language in features

**D. Search/LLM/Citation Friendliness (pass/fail)**
- D1: Opening paragraph is LLM-summarizable standalone
- D2: Acronyms and project-specific terms defined inline
- D3: Descriptive, searchable headings
- D4: Code examples are complete and runnable
- D5: (Optional) llms.txt file provided

**E. Information Hierarchy (pass/fail)**
- E1: Title + one-liner before all other content
- E2: Visual demo within first screenful
- E3: Quick-start before conceptual explanations
- E4: Contributor sections after user sections
- E5: License at the end

**F. Open-Source Trust/Statements (pass/fail)**
- F1: License clearly stated with link
- F2: Open-source / managed-tool boundary stated
- F3: Contributing guidelines linked
- F4: Code of Conduct referenced
- F5: No production-ready claims for alpha software
