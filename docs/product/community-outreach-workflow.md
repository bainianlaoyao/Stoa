# Community Outreach Workflow

## Purpose

This document defines the repeatable workflow for finding relevant community posts, drafting reply candidates, and recording them locally before any manual posting.

Use this workflow for Reddit, X, and later platforms.

## What The Reddit Pass Taught Us

- Broad Reddit search returns too much noise. Search inside the most relevant communities first, especially `r/ClaudeCode` and `r/ClaudeAI`.
- Freshness matters more than raw relevance. Threads older than roughly 48 hours usually have much lower reply value.
- The best targets are specific pain posts, not generic hype posts:
  - multiple Claude Code sessions
  - worktrees vs coordination
  - session visibility
  - session recovery / re-entry
  - too many tabs / terminal chaos
- Worktree discussions are good entry points, but the reply angle should be the missing layer above worktrees: visibility, coordination, persistence, and recovery.
- Candidate replies need to be written against the exact post, not copied across multiple threads.

## Core Reply Rules

- Answer first. Mention Stoa second.
- Disclose affiliation plainly: `I built Stoa` or equivalent.
- Stay factual. Use only repo-grounded claims.
- Keep the tone builder-like, not marketing-like.
- Be prototype-honest. Do not overclaim maturity.
- Link goes at the end unless a platform-specific exception is clearly justified.
- Keep replies short by default:
  - Reddit: usually 2 to 4 sentences
  - X: usually 1 to 3 sentences

## Stoa Positioning Guardrails

- Stoa is a local AI CLI workbench, not an IDE.
- Stoa is not a cloud agent platform.
- Stoa is not another chat box.
- The strongest pain points Stoa addresses are:
  - multi-session supervision
  - workspace switching without losing terminal state
  - session resume / recovery
  - structured state instead of terminal-text guessing
  - multi-provider CLI management

## Workflow

### 1. Search

- Start from platform-specific high-signal queries.
- Prefer narrow searches inside relevant communities or themes before broad global search.
- Record every interesting result, even if it is later rejected.

### 2. Triage

For each candidate, score:

- freshness
- relevance to a pain Stoa actually solves
- current engagement
- whether the thread still looks alive
- whether the community rules permit this kind of reply

Default preference:

- Reddit: `< 48h`
- X: `< 7d`, ideally much fresher for visibility

### 3. Draft

- Write a reply for the exact pain in that post.
- Mention only the layer Stoa actually helps with.
- Avoid feature dumping.
- Prefer one strong angle over trying to cover everything.

### 4. Record

Before any manual posting, save the target and the proposed reply in a dated document.

Path convention:

- `docs/product/outreach/YYYY-MM-DD-<platform>-candidate-replies.md`

### 5. Review

Check:

- affiliation disclosed
- answer-first structure
- link at end
- no hype wording
- no copied phrasing from another target
- claim accuracy

### 6. Manual Send

- Posting remains manual.
- If a reply is actually sent, update its status in the candidate document.

### 7. Monitor

- Record whether the reply got ignored, engaged with, or rejected.
- Reuse the winning pain angles, not the exact wording.

## Required Fields For Future Candidate Documents

Each target entry must include:

- `platform`
- `discovered_at`
- `target_url`
- `author`
- `post_date`
- `search_query_or_source`
- `engagement_snapshot`
- `pain_point`
- `why_stoa_is_relevant`
- `proposed_reply`
- `status`

Recommended `status` values:

- `draft`
- `approved`
- `sent-manually`
- `skipped`

## Template

```md
## Candidate N

- platform:
- discovered_at:
- target_url:
- author:
- post_date:
- search_query_or_source:
- engagement_snapshot:
- pain_point:
- why_stoa_is_relevant:
- status:

### Proposed Reply

...
```

## Notes By Platform

### Reddit

- Prefer pain-question threads over tool-showcase threads.
- Check subreddit-specific self-promo rules before using a Stoa mention.
- Avoid stale threads unless they are still receiving active replies.

### X

- Prefer active workflow threads, release threads, and pain-point posts.
- Replies should be especially short and direct.
- A strong pattern on X is:
  - direct observation
  - brief affiliation disclosure
  - one Stoa angle
  - link at the end

## X Workflow

This is the explicit workflow for X outreach.

### 1. Search On X

Start from high-signal queries around:

- Claude Code + worktrees
- Claude Code + multiple sessions
- Claude Code + session manager
- parallel agents
- terminal chaos
- session recovery
- competitor mentions such as Conductor, Claude Squad, Architect

Prefer:

- posts from power users
- release / feature threads
- posts where someone explicitly describes workflow pain

### 2. Triage X Targets

Prefer targets that are:

- fresh enough that replies still have a chance to be seen
- high-alignment with Stoa's actual value
- concrete enough that a short reply can add something

Strong target classes:

- someone showing a worktree-based setup and asking for better ways
- someone praising parallel agents while implying coordination pain
- someone recommending a competitor tool in a thread about session management
- someone describing too many Claude Code sessions, tabs, or repos

Weak target classes:

- generic AI hype
- broad model debates with no workflow pain
- posts where Stoa would be only tangentially relevant

### 3. Draft X Replies

Default structure:

1. direct observation about their exact pain or setup
2. brief disclosure: `I built Stoa`
3. one specific Stoa angle only
4. GitHub link at the end

Keep X replies:

- short
- direct
- non-defensive
- non-comparative unless the thread is already comparing tools

Good X reply angles:

- "worktrees solve isolation, but not supervision"
- "parallel agents are easy to start and hard to supervise"
- "the pain shifts from execution to visibility and re-entry"
- "the missing layer is a workspace view over real CLI sessions"

### 4. Record X Candidates

Before sending, every X candidate must be written to a dated doc under:

- `docs/product/outreach/YYYY-MM-DD-x-candidate-replies.md`

Each entry must contain:

- target link
- author
- date or explicit note that date still needs verification
- engagement snapshot
- pain point
- why Stoa is relevant
- proposed reply
- status

### 5. Review X Replies

Check:

- does the reply respond to this exact post
- is the disclosure present
- is there only one Stoa angle
- is the link at the end
- does it avoid hype words
- would it still be useful without the link

### 6. Send And Monitor

- Sending remains manual.
- After manual send, update `status` to `sent-manually`.
- If the final sent text changed, replace the draft with the actual sent text or append it below the draft.
- Re-check after some time and record whether the thread produced:
  - no reaction
  - likes
  - replies
  - follow-up questions

### 7. Reuse Policy

- Reuse pain angles.
- Do not reuse the exact same wording.
- If a pattern works repeatedly, convert it into a writing heuristic, not a template.
