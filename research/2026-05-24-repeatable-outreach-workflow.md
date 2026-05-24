---
date: 2026-05-24
topic: repeatable-outreach-workflow
status: completed
mode: context-gathering
sources: 22
---

## Context Report: Repeatable Outreach Workflow — Derivation from Prior Exploration

### Why This Was Gathered

Derive a concrete, repeatable outreach workflow from prior Reddit exploration and the existing X promotion pipeline. The goal: a single process that can be followed (or automated) for any target community, with mandatory fields per target post and proposed reply, shaped by repo-local product positioning constraints.

### Summary

Prior Reddit exploration was **research-only** — no posts or replies were ever sent. The research produced a well-defined engagement strategy (answer-first, mention-Stoa-second, stay within ratio), 11 search queries, and 11 candidate threads. The X promotion pipeline was built and run 7 times but also never published. Together these form a clear de facto workflow: search → triage → draft → record → review → send. The key gaps are: no triage scoring, no structured per-target record format, and no feedback loop after posting.

### What Actually Happened in Practice

| Step | What Was Done | Evidence |
|------|--------------|----------|
| 1. Research communities | Identified 5 communities (Reddit, HN, Dev.to, GitHub, Chinese). For Reddit specifically: found 11 threads, defined 11 search queries, documented engagement strategy | `research/2026-05-24-community-alignment-research.md:19-51` |
| 2. Research norms | Documented self-promotion rules for Reddit (10:1 ratio), HN, SO, Lobsters. Produced 8-point cross-platform checklist | `research/2026-05-24-self-referential-reply-norms.md:90-99` |
| 3. Define positioning | Created product positioning brief with pain points, target users, 12 high-signal keywords, architectural differentiators | `research/2026-05-24-product-positioning-brief.md:22-96` |
| 4. Build X automation | Implemented 3-stage pipeline (asset factory → week planner → daily orchestrator). Ran 7 dry runs (2026-05-17 to 2026-05-19). **Zero posts published, zero replies sent** | `automation/promo/state/run-log.json` (7 entries with empty `publishedPostIds` and `generatedReplyIds`) |
| 5. Define voice | Wrote voice config: "builder account, not marketing account"; no hype words; soft CTA only | `automation/promo/config/voice.md:1-8` |
| 6. Draft first post | Generated one "first impression" post about what Stoa is (2026-05-19). Never published | `automation/promo/out/today-posts.md` |

**What was never done**: No actual Reddit browsing, no manual replies to any thread, no cross-referencing of the 11 candidate threads against current freshness, no tracking of which threads were still active, no reply drafts for Reddit.

### What Worked vs Failed

#### Worked (Reusable)

- **Search query patterns** — The 11 Reddit queries and 15 cross-platform queries are well-targeted and map to real observed threads (`community-alignment-research.md:38-49`)
- **Pain-point-to-solution mapping** — The 6-row table in the positioning brief (`product-positioning-brief.md:53-60`) directly connects observable community complaints to Stoa features
- **Voice constraints** — The builder-voice tone produced content that reads genuinely, not like marketing (`voice.md:1-8`)
- **Structured output via Claude CLI** — The LLM-in-the-loop approach (Claude CLI with JSON schema) produces well-formed drafts (`claude-cli.ts:14-99`, `daily-orchestrator.ts:222-289`)
- **Graceful degradation** — When X search failed, the orchestrator fell back to fact-pack-only mode (`daily-orchestrator.ts:60-69`, tested at `daily-orchestrator.test.ts:68-100`)

#### Failed or Missing

- **No triage/scoring of targets** — Search matches were collected but never filtered by freshness, engagement level, or reply-worthiness. The X pipeline just passes all matches to the LLM
- **No per-target structured record** — The X pipeline records search matches as flat data (`PromoSearchMatch`), but there is no field for: thread freshness, upvote count, number of existing replies, whether the thread is still active, subreddit-specific rules check
- **No feedback loop** — After dry runs, nothing measured whether the drafted content was good enough to actually send. No quality score, no human review checklist beyond "pick an option"
- **No rate/ratio tracking** — The self-referential norms research specifies a 10:1 ratio for Reddit, but the X pipeline has no ratio tracking mechanism
- **Platform lock-in** — The pipeline hardcodes X/Twitter (kimi WebBridge, x.com URLs, tweet-length limits). No abstraction layer for other platforms

### Mandatory Fields Per Target Post

Derived from the existing `PromoSearchMatch` type (`types.ts:101-107`) and the gaps identified above. Every target post discovered during outreach must record:

| Field | Source / Reason | Already in Types? |
|-------|----------------|-------------------|
| `id` | Unique identifier (post ID) | Yes (`PromoSearchMatch.id`) |
| `query` | Which search query found it | Yes (`PromoSearchMatch.query`) |
| `url` | Full URL to the post | Yes (`PromoSearchMatch.url`) |
| `authorHandle` | Author username | Yes (`PromoSearchMatch.authorHandle`) |
| `text` | Post text content | Yes (`PromoSearchMatch.text`) |
| `platform` | Which platform (reddit, hn, devto, github) | **Missing** — needed for platform-specific rules |
| `subreddit` | Subreddit or section (for ratio/rule lookup) | **Missing** — needed for subreddit-specific self-promo rules |
| `discoveredAt` | When this post was found | **Missing** — needed for freshness tracking |
| `postDate` | When the post was originally created | **Missing** — needed to avoid engaging with stale threads |
| `upvotes` | Engagement signal | **Missing** — needed for triage scoring |
| `replyCount` | Number of existing replies | **Missing** — needed for triage (0 replies = high signal) |
| `freshness` | Derived: hours since postDate | **Missing** — engagement value decays rapidly |
| `rulesChecked` | Whether subreddit-specific self-promo rules were verified | **Missing** — compliance gate |

### Mandatory Fields Per Proposed Reply

Derived from the existing `PromoReplyCandidate` type (`types.ts:118-126`) and gaps:

| Field | Source / Reason | Already in Types? |
|-------|----------------|-------------------|
| `id` | Unique identifier | Yes (`PromoReplyCandidate.id`) |
| `createdAt` | When the draft was created | Yes (`PromoReplyCandidate.createdAt`) |
| `query` | Which search query led to the target | Yes (`PromoReplyCandidate.query`) |
| `targetUrl` | URL of the target post | Yes (`PromoReplyCandidate.targetUrl`) |
| `targetText` | Text of the target post | Yes (`PromoReplyCandidate.targetText`) |
| `whyReply` | Reason for engaging | Yes (`PromoReplyCandidate.whyReply`) |
| `options` | Multiple reply text options (human picks) | Yes (`PromoReplyCandidate.options`) |
| `affiliationDisclosed` | Whether "I'm the author of Stoa" is in the text | **Missing** — hard compliance requirement (`self-referential-reply-norms.md:91`) |
| `answerFirstCompliant` | Whether the reply solves the problem before mentioning Stoa | **Missing** — hard compliance requirement (`self-referential-reply-norms.md:92`) |
| `linkAsSupport` | Whether links support the answer rather than substitute | **Missing** — hard compliance requirement (`self-referential-reply-norms.md:93`) |
| `status` | Draft → reviewed → sent → monitoring | **Missing** — needed for pipeline tracking |
| `sentAt` | When the reply was actually sent | **Missing** — needed for ratio tracking |
| `sentText` | Final text that was sent (may differ from options) | **Missing** — needed for history |
| `communityReaction` | Upvotes/replies received after sending | **Missing** — needed for feedback loop |

### Product Positioning Constraints That Must Shape All Replies

These constraints are derived from repo-local docs and are non-negotiable:

1. **Builder voice, not marketing** — "Lead with real pain, real observations, and small build notes" (`voice.md:3`). No hype words: revolutionary, game-changing, must-have (`voice.md:4`)

2. **Open-source, non-commercial framing** — "Remember that Stoa is an open-source, non-commercial project" (`voice.md:5`). Never sell. Soft CTA to GitHub only (`voice.md:6`)

3. **Answer-first, mention-second** — "Give a genuine answer about your own workflow, mention Stoa as the tool you built for this exact problem" (`community-alignment-research.md:51`). Not every reply needs to mention Stoa — some should just be helpful technical answers to build credibility

4. **Disclose affiliation** — "I'm the author/maintainer of Stoa" must appear in any reply mentioning Stoa (`self-referential-reply-norms.md:91`)

5. **Stay within ratio** — Self-referential replies must be ≤10% of total Reddit activity (`self-referential-reply-norms.md:39-41`). This means for every Stoa-mentioning reply, 9+ genuine non-promotional comments are needed

6. **No templating** — "Each reply must be unique, written for the specific question" (`self-referential-reply-norms.md:51`). Same answer to multiple threads = spam

7. **Factual grounding only** — Facts must come from README, assets, or repo text. No fabrication (`2026-05-16-x-promotion-autopilot-design.md:156`)

8. **Only four post angles allowed** — `pain-note`, `build-note`, `tiny-proof`, `sharp-opinion` (`2026-05-16-x-promotion-autopilot-design.md:146-148`)

9. **Prototype honesty** — Stoa is v0.3.0, in active prototype stage. Never overclaim maturity. Do not claim "fully open source" without a LICENSE file (`2026-04-27-stoa-promotion-platform-copy.md:22`)

10. **Not-X positioning** — Stoa is NOT an IDE, NOT a cloud platform, NOT a chat box (`promotion-copy.md:27-30`). It is a "local dispatch console for AI concurrent programming" (`vision-and-principles.md:5`)

### Recommended Repeatable Workflow

Based on what the prior exploration actually did and what it missed:

```
Step 1: SEARCH
  - Run platform-specific search queries from the master list
  - Record every result as a TargetPost with all mandatory fields
  - Include: platform, subreddit, discoveredAt, postDate, upvotes, replyCount

Step 2: TRIAGE
  - Filter by freshness (posts < 48 hours old preferred)
  - Filter by engagement (0-5 replies = high signal; >20 replies = probably too late)
  - Filter by relevance (does the post describe a pain point Stoa solves?)
  - Mark rulesChecked = true after verifying subreddit-specific self-promo rules
  - Score: high-freshness + low-replies + high-relevance = engage

Step 3: DRAFT
  - For each triaged target, produce 2-3 reply options via LLM
  - Auto-check compliance: affiliationDisclosed, answerFirstCompliant, linkAsSupport
  - Record whyReply for each draft
  - Voice check: no hype words, builder tone, prototype-honest

Step 4: RECORD
  - Save TargetPost + ReplyCandidate to local state
  - Include all mandatory fields for both
  - Append to history for ratio tracking

Step 5: REVIEW
  - Human reviews each reply draft
  - Verify compliance checks passed
  - Select one option or request revision
  - Check ratio: have we sent >10% self-referential replies in recent history?

Step 6: SEND
  - Post the reply manually (Reddit has no WebBridge automation)
  - Record sentAt, sentText, status = sent

Step 7: MONITOR
  - Check back in 24-48 hours
  - Record communityReaction (upvotes, replies, any negative responses)
  - Feed reaction data back into future triage (high-reaction topics = signal to engage more)
  - Respond to follow-up questions genuinely
```

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Reddit exploration was research-only, no posts sent | Community alignment research | `research/2026-05-24-community-alignment-research.md` (entire file) |
| 11 candidate Reddit threads with pain points | Community alignment research | `research/2026-05-24-community-alignment-research.md:23-36` |
| 11 Reddit search query patterns | Community alignment research | `research/2026-05-24-community-alignment-research.md:38-49` |
| Engagement strategy: answer-first, mention-second | Community alignment research | `research/2026-05-24-community-alignment-research.md:51` |
| 10:1 Reddit self-promotion ratio | Self-referential reply norms | `research/2026-05-24-self-referential-reply-norms.md:39-41` |
| 8-point cross-platform checklist | Self-referential reply norms | `research/2026-05-24-self-referential-reply-norms.md:90-99` |
| Product name Stoa, v0.3.0, Apache-2.0 | package.json | `package.json:2-6` |
| Builder voice constraints | Voice config | `automation/promo/config/voice.md:1-8` |
| Only four allowed post angles | X promotion design spec | `docs/superpowers/specs/2026-05-16-x-promotion-autopilot-design.md:146-148` |
| No fabrication guardrail | X promotion design spec | `docs/superpowers/specs/2026-05-16-x-promotion-autopilot-design.md:156` |
| Stoa is NOT an IDE, cloud, chat box | Promotion copy | `docs/product/promotion-copy.md:27-30` |
| Don't overclaim "open source" without LICENSE | Platform copy | `research/2026-04-27-stoa-promotion-platform-copy.md:22` |
| X pipeline ran 7 dry runs, zero published | Run log state | `automation/promo/state/run-log.json` |
| PromoSearchMatch type (5 fields) | Types | `src/core/promo/types.ts:101-107` |
| PromoReplyCandidate type (6 fields) | Types | `src/core/promo/types.ts:118-126` |
| Daily orchestrator graceful degradation | Daily orchestrator | `src/core/promo/daily-orchestrator.ts:60-69` |
| Fact pack grounding mechanism | Fact pack | `src/core/promo/fact-pack.ts:14-107` |
| Target user definition | Positioning brief | `research/2026-05-24-product-positioning-brief.md:35-41` |
| 6 pain-point-to-solution mappings | Positioning brief | `research/2026-05-24-product-positioning-brief.md:53-60` |
| Prototype stage, known gaps | Positioning brief | `research/2026-05-24-product-positioning-brief.md:116-119` |
| 5 communities identified with search patterns | Community alignment research | `research/2026-05-24-community-alignment-research.md:19-168` |
| Competitor landscape (Claude Squad, Architect, etc.) | Community alignment research | `research/2026-05-24-community-alignment-research.md:172-184` |

### Risks / Unknowns

- [!] **Reddit has no browser automation equivalent of kimi WebBridge** — all Reddit replies must be manual. The workflow must account for human-in-the-loop at the send step
- [!] **Reddit enforcement is inconsistent** — the 10:1 rule is applied unevenly and some subreddits ban all self-promotion regardless (`self-referential-reply-norms.md:103`). Subreddit-specific rule checking is mandatory before any reply
- [!] **Thread freshness decays fast** — Reddit threads older than 48 hours rarely get new engagement. The triage step must filter aggressively by post date
- [!] **No existing ratio tracking** — neither the X pipeline nor any other system tracks the 10:1 ratio requirement. Building this is a prerequisite for Reddit outreach
- [?] **Subreddit-specific rules not yet collected** — r/ClaudeAI and r/ClaudeCode rules need to be checked and documented before any outreach begins
- [?] **Dev.to and daily.dev norms not verified** — the norms research explicitly notes these platforms were not sourced from official documents (`self-referential-reply-norms.md:105`)
