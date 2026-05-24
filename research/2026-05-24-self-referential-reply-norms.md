---
date: 2026-05-24
topic: Self-referential reply norms on high-signal technical discussion sites
status: completed
mode: context-gathering
sources: 10
---

## Context Report: Self-Referential Reply Norms on Technical Discussion Sites

### Why This Was Gathered
To understand what makes a manual, self-referential reply (mentioning your own project/tool) acceptable versus spam on high-signal developer communities, so that any promotional engagement from this repo follows site norms precisely.

### Summary
Across all major technical discussion sites (Hacker News, Reddit, Stack Overflow, Lobsters), the universal requirements for acceptable self-referential replies are: **(1) disclose your affiliation explicitly**, **(2) the reply must genuinely answer the question or contribute to the discussion**, **(3) self-promotional content must remain a minority of your total activity** (ranging from <10% on Reddit to <25% on Lobsters), and **(4) links must support the answer, not substitute for it**. The tone should be factual, specific, and teach — not sell.

### Key Findings

#### 1. Disclosure Is Mandatory Everywhere

Every platform requires that you state your connection to what you're mentioning. Omitting this is the single fastest path to being flagged as spam.

- **Stack Overflow**: "you _must_ disclose your affiliation in your post" ([source](https://stackoverflow.com/help/promotion))
- **Reddit**: "You should not hide your affiliation to your project or site, or lie about it" ([source](https://www.reddit.com/r/reddit.com/wiki/selfpromotion/))
- **HN**: Implied by the general guideline against astroturfing; the community actively calls out undisclosed self-promotion
- **Lobsters**: The "hats" system exists precisely for declaring formal affiliation when speaking for a project ([source](https://lobste.rs/about))

#### 2. The Reply Must Stand On Its Own Merit

Links and project references must _support_ the answer, not be the answer.

- **Stack Overflow**: "Don't include links except to _support_ what you've written. Links are not a substitute for including information in your answer itself." ([source](https://stackoverflow.com/help/promotion))
- **Stack Overflow**: "Always solve the asker's problem. A good answer should _at minimum_ allow the person whose question you're answering to solve their problem." ([source](https://stackoverflow.com/help/promotion))
- **HN**: "Anything that gratifies one's intellectual curiosity" — content must be intrinsically interesting, not just promotional ([source](https://news.ycombinator.com/newsguidelines.html))
- **Lobsters**: "Will this improve the reader's next program? Will it deepen their understanding of their last program?" — topicality test ([source](https://lobste.rs/about))

#### 3. Activity Ratio Thresholds (Platform-Specific)

| Platform | Self-Promo Limit | Source |
|----------|-----------------|--------|
| Reddit | ≤10% of total posts (10:1 rule) | [r/modnews clarification](https://www.reddit.com/r/modnews/comments/2oamgp/moderators_clarifications_around_our_101/) |
| Hacker News | "part of the time" but not "primarily for promotion" | [HN Guidelines](https://news.ycombinator.com/newsguidelines.html) |
| Lobsters | <25% of stories and comments | [Lobsters About](https://lobste.rs/about) |
| Stack Overflow | "some (but not all)" answers about your product | [SO Help](https://stackoverflow.com/help/promotion) |

#### 4. Tone and Scope Norms

- **Factual over promotional**: "Don't tell – show! The best way to avoid being seen as a snake-oil salesman is to demonstrate a solution, rather than simply asserting that the problem can be solved." (Stack Overflow)
- **Answer for the ages**: Write for future readers, not just the current asker. Explain _why_ the solution works. (Stack Overflow)
- **Be respectful and curious**: "Anyone sharing work is making a contribution, however modest. Ask questions out of curiosity. Don't cross-examine." (HN Show HN guidelines)
- **No generic or templated replies**: Posting the same answer across multiple questions is flagged as spam on Stack Overflow and Reddit
- **Don't solicit engagement**: "Don't solicit upvotes, comments, or submissions." (HN Guidelines)

#### 5. What Crosses Into Spam

| Behavior | Why It's Spam | Platform |
|----------|--------------|----------|
| Undisclosed affiliation | Hides commercial/personal interest | All |
| Reply that is just a link | No substantive contribution | SO, Reddit |
| Same answer posted to many threads | Template/astroturfing | SO, Reddit |
| Account exists only to self-promote | No genuine community participation | Reddit (10:1), HN, Lobsters |
| Asking friends to upvote | Vote manipulation | HN |
| Posting only to questions your product answers | Clearly here to sell, not help | SO |
| Low-effort or generated content | Not meaningful human authorship | Lobsters (spam flag definition) |

#### 6. The "Show HN" Mechanism (Special Case)

HN has a dedicated format for sharing your own work: **Show HN**. Key rules:
- Must be something people can _run or try_, not just read about
- Must be non-trivial and personally worked on
- Author must be present to discuss
- No landing pages, signups, or fundraisers
- New features/upgrades are generally not enough; a major overhaul is ok
- Community should be "comfortable with work that's at an early stage"
([source](https://news.ycombinator.com/showhn.html))

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| HN: don't use primarily for promotion; ok part of the time | HN Guidelines | https://news.ycombinator.com/newsguidelines.html |
| HN: Show HN rules for self-shared projects | Show HN Guidelines | https://news.ycombinator.com/showhn.html |
| Reddit: 10:1 self-promotional ratio rule | Reddit r/modnews | https://www.reddit.com/r/modnews/comments/2oamgp/ |
| Reddit: don't hide affiliation; don't spam | Reddit Self-Promo Wiki | https://www.reddit.com/r/reddit.com/wiki/selfpromotion/ |
| SO: must disclose affiliation; answer must stand alone | SO Help Center | https://stackoverflow.com/help/promotion |
| Lobsters: self-promo <25%; spam = commercial promotion or non-human content | Lobsters About | https://lobste.rs/about |
| Lobsters: community guidance on ~1/3 threshold when engaging broadly | Lobsters Discussion | https://lobste.rs/s/7mx8tx/ |
| SO Meta: fully disclosed self-promotion judged by vote quality | Meta Stack Exchange | https://meta.stackexchange.com/questions/57497/ |

### Cross-Platform Checklist for Acceptable Self-Referential Replies

1. **Disclose** — State "I'm the author/maintainer of [project]" in the reply body
2. **Answer the question first** — Solve the problem or contribute substantively before mentioning your project
3. **Link as support, not substitute** — The reply must be useful even if the link is removed
4. **Be specific** — Show how your project solves the exact problem, with code or configuration
5. **Stay within ratio** — Ensure self-referential replies are a small minority of your total activity on the site
6. **Use the right format** — Show HN on HN; proper tags on Lobsters; respect subreddit-specific rules on Reddit
7. **Be present for follow-up** — Respond to questions and feedback genuinely
8. **No vote solicitation** — Never ask anyone to upvote or engage

### Risks / Unknowns

- [!] Reddit enforcement is inconsistent — the 10:1 rule is applied unevenly and some subreddits ban all self-promotion regardless. Always check subreddit-specific rules first.
- [!] HN has no hard numeric threshold; "primarily for promotion" is a judgment call by moderators (dang). A single well-timed Show HN is safer than multiple comments.
- [?] Dev.to and daily.dev norms were not sourced from official primary documents in this pass — their norms appear more permissive but this was not verified against official rules.
- [?] GitHub Discussions norms for self-promotion were not covered due to rate limiting; GitHub's community guidelines are less formalized on this specific topic.
