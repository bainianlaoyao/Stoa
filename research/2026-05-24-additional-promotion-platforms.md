---
date: 2026-05-24
topic: additional-promotion-platforms-beyond-reddit-x
status: completed
mode: context-gathering
sources: 28
---

## Context Report: Additional Promotion Platforms Beyond Reddit and X

### Why This Was Gathered

The existing community alignment research (`2026-05-24-community-alignment-research.md`) identified Reddit, HN, Dev.to, GitHub, and Chinese communities. X promotion is covered by the autopilot pipeline. This report evaluates **additional platforms not yet covered** (or covered shallowly) to expand the set of viable manual, helpful, disclosed promotion channels for Stoa.

### Summary

Six platforms beyond Reddit and X show meaningful fit for Stoa promotion: **Lobsters**, **Product Hunt**, **Discord** (Anthropic official + community servers), **Dev.to** (deepened), **Mastodon/Fediverse**, and **Indie Hackers**. Hacker News is re-evaluated here with fresh norms evidence. Stack Overflow is evaluated but rejected as unsuitable. Each platform is scored on audience fit, discussion density, self-promo norms, optimal motion (post vs reply), and risks.

---

### Platform 1: Lobsters (lobste.rs)

**Audience fit: Very High.** Lobsters is a link-aggregation and discussion site for systems programmers and tool builders. The community has a dedicated `vibecoding`/`llms` tag, active threads on AI coding agents, terminal tools, and agentic workflows. The audience is technically sophisticated, values engineering depth over hype, and self-selects for people building or evaluating developer tooling.

**Current discussion density: Moderate–High.** Active threads found:
- "Lobsters Vibecoding Challenge (Winter 2025-2026)" — community challenge around AI coding tools ([lobste.rs/s/igpevt](https://lobste.rs/s/igpevt/lobsters_vibecoding_challenge_winter))
- "Here's how I use LLMs to help me write code" — practical terminal/CLI workflows ([lobste.rs/s/gvkxlf](https://lobste.rs/s/gvkxlf/here_s_how_i_use_llms_help_me_write_code))
- "AI Changes Everything" — mentions Claude Code as agentic terminal tool ([lobste.rs/s/n2lvmy](https://lobste.rs/s/n2lvmy/ai_changes_everything))
- "If AI is so good at coding… where are the open source contributions?" — community debate ([lobste.rs/s/gkpmli](https://lobste.rs/s/gkpmli/if_ai_is_so_good_at_coding_where_are_open))
- New tag discussion: "vibecoding" vs "llms" terminology ([lobste.rs/s/lkngrz](https://lobste.rs/s/lkngrz/new_tag_vibecoding))

**Self-promo / reply norms:**
- **Hard rule: self-promo must be <25% of total activity** (submissions + comments) ([lobste.rs/s/unby50](https://lobste.rs/s/unby50), admin pushcx)
- Must be an active community member who also submits and discusses others' work
- "Hats" system for declaring formal affiliation when speaking for a project ([lobste.rs/about](https://lobste.rs/about))
- Thin/marketing content is actively moderated against ([lobste.rs/s/utbyws](https://lobste.rs/s/utbyws/mitigating_content_marketing))
- Rule of thumb: if a third of submissions are your own and you comment on others, you're fine ([lobste.rs/s/7mx8tx](https://lobste.rs/s/7mx8tx/is_it_appropriate_keep_submitting))

**Better motion: Submit a link (post) with genuine framing, then engage in comments.** Lobsters is link-driven; a well-written submission ("I built an open-source desktop app for managing multiple AI CLI sessions") with a GitHub link is the primary motion. Reply in existing threads about AI coding tools only when the discussion naturally calls for it.

**Main risks:**
- Lobsters is invite-only; you need an existing account with history before promoting
- The <25% rule requires sustained participation before and after any self-promotional submission
- The community is skeptical of Electron/desktop apps (strong terminal/text bias); frame Stoa's value in systems terms

**Recommended approach:**
1. Build a natural history on Lobsters (comment on AI/terminal threads for 2+ weeks)
2. Submit Stoa as a link with honest, technical framing
3. Use the "hat" system to declare affiliation
4. Engage deeply in comment threads on the submission

---

### Platform 2: Product Hunt

**Audience fit: Moderate–High.** Product Hunt is the canonical launch platform for developer tools. The audience includes early adopters, makers, and developers looking for new tools. Developer tools have a dedicated category, and several AI coding tools have launched successfully there in 2025-2026. The 2025 "Best Developer Tools" list shows strong community interest in AI coding assistants ([producthunt.com](https://www.producthunt.com/p/producthunt/best-developer-tools-launched-on-product-hunt-in-2025)).

**Current discussion density: High for dev tools.** AI coding tools are a trending category. Multiple Claude Code extensions, terminal tools, and agent managers have launched on PH in 2025-2026.

**Self-promo / reply norms:**
- **Product Hunt is explicitly designed for self-promotion** — the entire platform exists for launching products
- Use the official Launch Guide for best practices ([producthunt.com/launch](https://www.producthunt.com/launch))
- Be transparent about what it does, include a demo, show real usage
- Tuesday–Thursday launches get the most traffic ([syften.com/blog/hacker-news-marketing/](https://syften.com/blog/hacker-news-marketing/))
- Engage actively in comments on launch day
- Open-source projects are welcomed; mention license and repo link prominently

**Better motion: Post (one-time launch event).** Product Hunt is a single-launch event, not an ongoing engagement channel. Plan a dedicated launch day with:
- Compelling tagline (not hype — "Manage multiple AI coding agent sessions in one desktop workspace")
- Screenshots and a short demo GIF/video
- Clear open-source framing
- Active engagement in comments for 24 hours

**Main risks:**
- Product Hunt has a "vote manipulation" detection system — don't ask friends to upvote
- If Stoa is too early-stage (v0.3.0), users may find it unfinished and leave negative feedback
- One-shot opportunity; a poorly received launch can't be easily re-done
- Audience is less technical than HN/Lobsters; may need simpler framing

**Recommended approach:**
1. Wait until Stoa has a polished README with screenshots and a clear quickstart
2. Launch on a Tuesday or Wednesday
3. Cross-post the launch to Reddit (r/ClaudeAI, r/SideProject) and HN for maximum reach
4. Respond to every comment within the first 24 hours

---

### Platform 3: Discord (Anthropic Official + Community Servers)

**Audience fit: Very High.** The official Anthropic Discord has 98,000+ members ([discord.com/invite/6PPFFzqPDZ](https://discord.com/invite/6PPFFzqPDZ)). There is strong interest in Claude Code workflows, terminal tools, and multi-agent management. A Reddit thread proposed a dedicated Claude Code Discord server ([reddit.com/r/ClaudeCode/comments/1r0kbu2](https://www.reddit.com/r/ClaudeCode/comments/1r0kbu2/anyone_interested_in_a_small_discord_just_for/)), showing latent demand.

**Current discussion density: Very High.** Real-time discussions about Claude Code sessions, terminal workflows, multi-agent setups. Claude Code Channels (Anthropic's official Discord/Telegram integration) was launched recently, generating substantial buzz ([venturebeat.com](https://venturebeat.com/orchestration/anthropic-just-shipped-an-openclaw-killer-called-claude-code-channels)).

**Self-promo / reply norms:**
- Discord servers are generally more permissive than forums for sharing projects
- The Anthropic Discord likely has specific channel rules (#showcase or #projects channels)
- Direct DM promotion is universally considered spam
- Best approach: participate in relevant channels, answer questions, share Stoa when someone asks about multi-session management
- Community-built tools are celebrated (see: community-built chat interface for Claude Code getting thousands of downloads on Reddit)

**Better motion: Reply in channels.** Discord is conversation-driven, not post-driven. The right motion is to join the server, participate in #claude-code or relevant channels, and mention Stoa when someone asks about session management or multi-agent workflows. A one-time showcase post in a dedicated channel is also appropriate.

**Main risks:**
- Discord has no public searchable archive; engagement is ephemeral
- Server-specific rules vary widely; must read and follow each server's guidelines
- Risk of over-mentioning Stoa in a small real-time community (reputation damage is immediate)
- The Anthropic Discord may have restrictions on promoting third-party tools

**Recommended approach:**
1. Join the Anthropic Discord server
2. Identify relevant channels (#claude-code, #tools, #showcase)
3. Participate as a genuine community member for 1-2 weeks
4. When multi-session management comes up, share Stoa with affiliation disclosure
5. Consider a one-time showcase post if a #projects or #showcase channel exists

---

### Platform 4: Hacker News (news.ycombinator.com) — Deepened

*Note: HN is already covered in `2026-05-24-community-alignment-research.md` but this section adds fresh norms evidence.*

**Audience fit: Very High.** Confirmed by existing research. The HN audience values technical depth, open-source projects, and honest engineering stories.

**Self-promo / reply norms (fresh evidence):**
- **Official rule: "Please don't use HN primarily for promotion"** ([news.ycombinator.com/item?id=24353959](https://news.ycombinator.com/item?id=24353959))
- Occasional self-submissions are OK; primary use should be genuine intellectual curiosity
- **Show HN is the accepted mechanism** for showcasing projects ([news.ycombinator.com/showhn.html](https://news.ycombinator.com/showhn.html))
- Every Show HN appears on `shownew`; clears a small points threshold to appear on the main Show HN page
- **Neutral titles required** — no hype, exclamation points, or marketing language
- **Be transparent**: introduce yourselves, say what it does in one clear sentence, explain the technology/story behind it ([markepear.dev/blog/dev-tool-hacker-news-launch](https://www.markepear.dev/blog/dev-tool-hacker-news-launch))
- **Optimal timing**: Tuesday–Thursday, 7–9 AM EST ([syften.com/blog/hacker-news-marketing/](https://syften.com/blog/hacker-news-marketing/))
- **At least 19% of AI developers promote their GitHub projects on HN** with positive engagement ([arxiv.org/abs/2506.12643](https://arxiv.org/abs/2506.12643))

**Better motion: Both post (Show HN) AND reply.** Two strategies:
1. **Post**: Submit Stoa as a Show HN with honest framing
2. **Reply**: In threads about competing tools (Claude Squad, Architect, Conductor), mention Stoa as an alternative when someone describes a problem Stoa solves

**Main risks (deepened):**
- Show HN gets one real shot — a failed launch can't be easily re-done
- HN has aggressive vote-ring detection — don't coordinate upvotes
- The community punishes marketing-speak severely; every word must be genuine
- Comment threads can turn critical quickly; be prepared for technical challenges

---

### Platform 5: Dev.to (deepened beyond existing research)

*Note: Dev.to is already covered in `2026-05-24-community-alignment-research.md` but this section adds norms evidence.*

**Audience fit: High.** 3.9M+ developer community. Dev.to has a dedicated `#opensource` tag, active AI tool discussions, and tutorial-oriented readers who appreciate practical "how I solved X" stories.

**Self-promo / reply norms (fresh evidence):**
- **Self-promotion in comments is debated** — discreet links are generally accepted, overt spam is flagged ([dev.to/preciouschicken/self-promotion-in-dev-to-comments-spammy-not-spammy-281m](https://dev.to/preciouschicken/self-promotion-in-dev-to-comments-spammy-not-spammy-281m))
- **Cross-posting is common** (Medium ↔ Dev.to) with canonical links ([medium.com/@tylerauerbeck](https://medium.com/@tylerauerbeck/publishing-to-dev-to-from-medium-f5808d7240f5))
- **Content quality matters more than ratio** — the algorithm promotes genuinely useful content
- Dev.to has a more permissive stance than Reddit/HN toward project showcases
- The "creator self-promotion dilemma" is openly discussed in the community ([dev.to/playfulprogramming/of-chickens-and-pigs-the-dilemma-of-creator-self-promotion-51ea](https://dev.to/playfulprogramming/of-chickens-and-pigs-the-dilemma-of-creator-self-promotion-51ea))
- Half-hidden self-promotion has been flagged as a growing problem ([dev.to/samuelfaure/is-dev-to-victim-of-its-own-success-1ioj](https://dev.to/samuelfaure/is-dev-to-victim-of-its-own-success-1ioj))

**Better motion: Write original articles (posts).** Dev.to is article-driven. The best approach is:
1. Write a genuine article about the multi-agent management problem (not a Stoa ad)
2. Include Stoa as the solution alongside other approaches
3. Comment on existing articles about Claude Squad, Conductor, parallel agents with substantive observations

**Main risks:**
- Dev.to's algorithm rewards click-baity titles; resisting this temptation is important for builder voice
- Cross-posted content needs canonical links to avoid SEO issues
- The audience is slightly less technical than HN/Lobsters; may need more explanation of concepts

---

### Platform 6: Mastodon / Fediverse

**Audience fit: Moderate.** Mastodon has tech-focused instances (fosstodon.org, hachyderm.io, mastodon.social) with developer communities. However, Mastodon lost ~1.8M users (>60% of peak) and only ~300K remain active from the Twitter migration waves ([reddit.com/r/Mastodon/comments/1g1g844](https://www.reddit.com/r/Mastodon/comments/1g1g844/why_is_mastodon_struggling_to_survive/)). The remaining users tend to be tech-savvy and values-driven (open source, decentralization, privacy).

**Current discussion density: Low–Moderate.** Some AI coding tool discussion exists on tech instances, but density is lower than Reddit/HN/Discord. The Fediverse developer community is being actively built ([dev.to/andypiper/thoughts-around-fediverse-developer-communities-cb6](https://dev.to/andypiper/thoughts-around-fediverse-developer-communities-cb6)).

**Self-promo / reply norms:**
- **Instance-dependent** — each Mastodon instance has its own rules
- Generally permissive: Mastodon's culture is more accepting of self-promotion than HN or Reddit
- The #BuildInPublic and #opensource hashtags are commonly used
- Boost culture (resharing) can amplify reach organically
- No algorithm — reach is purely follower-based and hashtag-based

**Better motion: Posts (toots) with hashtags.** Mastodon is post-driven, not reply-driven. The right motion is:
1. Post about Stoa's development progress using relevant hashtags
2. Engage in conversations about AI coding tools
3. Follow and interact with the local developer community on your chosen instance

**Main risks:**
- Very low reach compared to Reddit/HN/X
- Instance fragmentation means you need to pick the right instance
- No algorithm means growth is slow and depends on organic networking
- Effort-to-reward ratio may not justify the time investment at current user levels

**Recommended approach:** Low priority. Set up an account on a tech instance (fosstodon.org or hachyderm.io), cross-post major updates, but don't invest significant time here.

---

### Platform 7: Indie Hackers (indiehackers.com)

**Audience fit: Moderate.** Indie Hackers is a community for founders building profitable online businesses. The audience includes solo developers, bootstrappers, and #BuildInPublic advocates. AI tools for indie hackers are a trending topic ([buildmvpfast.com/blog/free-ai-tools-indie-hackers-2026](https://www.buildmvpfast.com/blog/free-ai-tools-indie-hackers-2026)). The #BuildInPublic culture aligns well with Stoa's builder-voice approach.

**Current discussion density: Moderate.** AI developer tools are discussed, but the focus is on business outcomes (revenue, users) rather than technical depth.

**Self-promo / reply norms:**
- **Explicitly designed for self-promotion** — the platform exists for founders to share what they're building
- "Ship and share" culture is the norm
- Product launches and milestone posts are encouraged
- The community values transparency about process, numbers, and learnings

**Better motion: Post (build-in-public updates).** Write posts about the development journey, technical decisions, and what you've learned building Stoa. The audience responds to authentic stories about building in public.

**Main risks:**
- Audience is business-oriented, not primarily technical; may need different framing
- Stoa is non-commercial and open-source, which may not align with the revenue-focused community
- Lower technical density means fewer people who understand the specific pain point

**Recommended approach:** Medium priority. Share occasional build-in-public posts about Stoa's development. Frame around the journey and learnings, not the product itself.

---

### Platform 8: Stack Overflow — REJECTED

**Audience fit: Low for promotion.** Stack Overflow is a Q&A site, not a discussion forum. Self-promotion is explicitly restricted: "you must disclose your affiliation in your post" and the community aggressively downvotes and flags promotional content ([meta.stackexchange.com/questions/57497](https://meta.stackexchange.com/questions/57497/limits-for-self-promotion-in-answers)). The site has ongoing tension about AI-generated content, with moderators going on strike over AI content policies ([meta.stackoverflow.com/questions/424952](https://meta.stackoverflow.com/questions/424952/discussion-new-ai-generated-content-policy)).

**Why rejected:**
- Self-promotion norms are the most restrictive of any platform evaluated
- The community is actively hostile to AI tool promotion (84% adoption but 46% distrust AI accuracy per the 2025 SO Developer Survey)
- Answers must stand alone; linking to your own tool as the primary answer violates the rules
- No mechanism for "show and tell" — the entire platform structure works against product discovery
- Risk of account ban for even well-intentioned self-referential answers

---

### Platform 9: GitHub (Issues, Discussions, Awesome Lists) — Already Covered

GitHub is already well-documented in the existing community alignment research (`2026-05-24-community-alignment-research.md:113-138`). Key actions: PR to awesome lists, comment on relevant issues (#7671), ensure README is compelling. No additional findings needed here.

---

### Comparative Summary

| Platform | Audience Fit | Discussion Density | Self-Promo Norms | Best Motion | Priority |
|----------|-------------|-------------------|------------------|-------------|----------|
| **Lobsters** | Very High | Moderate–High | <25%, must participate first | Submit link + engage in comments | High |
| **Hacker News** | Very High | High | Occasional OK, use Show HN | Show HN post + reply in threads | High |
| **Dev.to** | High | High | Permissive, quality-focused | Write original articles | High |
| **Product Hunt** | Moderate–High | High (dev tools trending) | Explicitly designed for launch | One-time launch post | Medium (timed for launch) |
| **Discord** | Very High | Very High | Generally permissive | Reply in channels + showcase | Medium–High |
| **Mastodon/Fediverse** | Moderate | Low–Moderate | Permissive, instance-dependent | Posts with hashtags | Low |
| **Indie Hackers** | Moderate | Moderate | Explicitly encouraged | Build-in-public posts | Low–Medium |
| **Stack Overflow** | Low | High (but hostile to promo) | Most restrictive | **Rejected** | None |

---

### Recommended Engagement Order

1. **Immediate (ongoing): Discord** — Join Anthropic Discord + Claude Code community servers. Participate naturally, mention Stoa when relevant. Lowest effort, highest density of target users.

2. **Near-term (when ready): Hacker News Show HN + Lobsters submission** — Requires existing account history on Lobsters. Prepare a compelling Show HN post and cross-submit to Lobsters with the "hat" affiliation system.

3. **Near-term (parallel): Dev.to articles** — Write 2-3 genuine articles about the multi-agent management problem. Include Stoa as a solution alongside alternatives. Cross-reference existing articles about Claude Squad, Conductor, etc.

4. **Timed event (when polished): Product Hunt launch** — One-time launch event. Coordinate with HN and Reddit posts for maximum reach. Requires polished README and screenshots.

5. **Background (low effort): Mastodon + Indie Hackers** — Set up accounts, cross-post major updates. Don't invest significant time here given low reach.

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Lobsters <25% self-promo rule, admin pushcx | Lobsters community discussion | [lobste.rs/s/unby50](https://lobste.rs/s/unby50) |
| Lobsters vibecoding challenge Winter 2025-2026 | Lobsters thread | [lobste.rs/s/igpevt](https://lobste.rs/s/igpevt/lobsters_vibecoding_challenge_winter) |
| Lobsters LLM workflow discussion | Lobsters thread | [lobste.rs/s/gvkxlf](https://lobste.rs/s/gvkxlf/here_s_how_i_use_llms_help_me_write_code) |
| Lobsters "AI Changes Everything" mentions Claude Code | Lobsters thread | [lobste.rs/s/n2lvmy](https://lobste.rs/s/n2lvmy/ai_changes_everything) |
| Lobsters mitigating content marketing policy | Lobsters admin post | [lobste.rs/s/utbyws](https://lobste.rs/s/utbyws/mitigating_content_marketing) |
| Lobsters "hats" affiliation system | Lobsters about page | [lobste.rs/about](https://lobste.rs/about) |
| HN "don't use primarily for promotion" | HN community discussion | [news.ycombinator.com/item?id=24353959](https://news.ycombinator.com/item?id=24353959) |
| HN Show HN official guidelines | HN official page | [news.ycombinator.com/showhn.html](https://news.ycombinator.com/showhn.html) |
| HN dev tool launch best practices | Markepear blog | [markepear.dev/blog/dev-tool-hacker-news-launch](https://www.markepear.dev/blog/dev-tool-hacker-news-launch) |
| HN timing: Tue-Thu 7-9 AM EST | Syften blog | [syften.com/blog/hacker-news-marketing/](https://syften.com/blog/hacker-news-marketing/) |
| 19% of AI developers promote on HN | arXiv paper | [arxiv.org/abs/2506.12643](https://arxiv.org/abs/2506.12643) |
| Product Hunt official launch guide | Product Hunt | [producthunt.com/launch](https://www.producthunt.com/launch) |
| Product Hunt best dev tools 2025 | Product Hunt | [producthunt.com](https://www.producthunt.com/p/producthunt/best-developer-tools-launched-on-product-hunt-in-2025) |
| Anthropic Discord 98K+ members | Discord invite | [discord.com/invite/6PPFFzqPDZ](https://discord.com/invite/6PPFFzqPDZ) |
| Claude Code Channels Discord integration | VentureBeat | [venturebeat.com](https://venturebeat.com/orchestration/anthropic-just-shipped-an-openclaw-killer-called-claude-code-channels) |
| Reddit thread proposing Claude Code Discord | Reddit | [reddit.com/r/ClaudeCode/comments/1r0kbu2](https://www.reddit.com/r/ClaudeCode/comments/1r0kbu2/anyone_interested_in_a_small_discord_just_for/) |
| Dev.to self-promotion norms debate | Dev.to community | [dev.to/preciouschicken/self-promotion-in-dev-to-comments](https://dev.to/preciouschicken/self-promotion-in-dev-to-comments-spammy-not-spammy-281m) |
| Dev.to creator self-promotion dilemma | Dev.to community | [dev.to/playfulprogramming/of-chickens-and-pigs](https://dev.to/playfulprogramming/of-chickens-and-pigs-the-dilemma-of-creator-self-promotion-51ea) |
| Dev.to half-hidden self-promo problem | Dev.to community | [dev.to/samuelfaure/is-dev-to-victim-of-its-own-success-1ioj](https://dev.to/samuelfaure/is-dev-to-victim-of-its-own-success-1ioj) |
| Mastodon lost 1.8M users, only 300K active | Reddit discussion | [reddit.com/r/Mastodon/comments/1g1g844](https://www.reddit.com/r/Mastodon/comments/1g1g844/why_is_mastodon_struggling_to_survive/) |
| Fediverse developer communities being built | Dev.to article | [dev.to/andypiper/thoughts-around-fediverse-developer-communities-cb6](https://dev.to/andypiper/thoughts-around-fediverse-developer-communities-cb6) |
| Indie Hackers AI tools for indie hackers | BuildMVPFast | [buildmvpfast.com/blog/free-ai-tools-indie-hackers-2026](https://www.buildmvpfast.com/blog/free-ai-tools-indie-hackers-2026) |
| Stack Overflow self-promotion limits | Meta Stack Exchange | [meta.stackexchange.com/questions/57497](https://meta.stackexchange.com/questions/57497/limits-for-self-promotion-in-answers) |
| SO AI content policy controversy | Meta Stack Overflow | [meta.stackoverflow.com/questions/424952](https://meta.stackoverflow.com/questions/424952/discussion-new-ai-generated-content-policy) |
| SO 2025 Developer Survey AI stats | Stack Overflow | [survey.stackoverflow.co/2025](https://survey.stackoverflow.co/2025) |
| Existing community alignment research (Reddit, HN, Dev.to, GitHub, Chinese) | Prior research | `research/2026-05-24-community-alignment-research.md` |
| Existing self-referential reply norms research | Prior research | `research/2026-05-24-self-referential-reply-norms.md` |
| Existing repeatable outreach workflow derivation | Prior research | `research/2026-05-24-repeatable-outreach-workflow.md` |

### Risks / Unknowns

- **[!] Lobsters requires invite + history** — Cannot self-promote immediately; needs 2+ weeks of genuine participation first
- **[!] Product Hunt is one-shot** — A poorly received launch can't be re-done. Wait until Stoa has a polished presentation
- **[!] Discord server rules unknown** — The Anthropic Discord's specific rules about third-party tool promotion have not been verified. Must check before engaging
- **[!] HN Show HN gets one real shot** — Needs compelling title, good README, active engagement during first hours
- **[?] Dev.to algorithm optimization** — Unclear how Dev.to's promotion algorithm works for developer tool content; may need experimentation
- **[?] Discord server fragmentation** — Multiple Claude Code Discord servers exist; unclear which has the best signal-to-noise ratio for Stoa's audience
- **[?] Mastodon instance selection** — The right instance (fosstodon vs hachyderm vs mastodon.social) affects reach and audience alignment; needs investigation
