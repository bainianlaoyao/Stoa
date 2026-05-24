---
date: 2026-05-24
topic: Self-promotion norms for developer tooling on Hacker News, GitHub, Dev.to, Lobsters, Product Hunt, and Chinese dev communities
status: completed
mode: context-research
sources: 18
---

## Context Report: Developer Tool Self-Promotion Norms by Platform

### Why This Was Gathered
Supports planning for community outreach and promotion of an open-source developer tool (Stoa/Ultra Simple Panel) across platforms beyond Reddit and X. Understanding what is acceptable for a builder mentioning their own tool is a prerequisite for any outreach workflow.

### Summary
Each platform has distinct norms for self-promotion. Hacker News has a dedicated "Show HN" format and tolerates occasional self-posts. Lobsters caps self-promo at under 25% of activity. Dev.to requires content to not be "primarily for promotion." Product Hunt actively encourages makers to launch their own products. GitHub Discussions/Issues are for your own project's community only — cross-project promotion is considered spam. Chinese dev communities (V2EX, Juejin) permit project showcases in dedicated nodes but enforce frequency limits and content-quality thresholds.

### Key Findings

---

## 1. Hacker News

**Primary source:** [HN Guidelines](https://news.ycombinator.com/newsguidelines.html) and [Show HN page](https://news.ycombinator.com/showhn.html)

**Official rules:**
- "Please don't use HN primarily for promotion. It's ok to post your own stuff part of the time, but the primary use of the site should be for curiosity." — [newsguidelines.html](https://news.ycombinator.com/newsguidelines.html)
- Show HN is specifically for "something you've made that other people can play with." Title must begin with "Show HN:".
- Must be personally worked on, and the author must be "around to discuss."
- "Please make it easy for users to try your thing out, ideally without barriers such as signups or emails."
- "The project should be non-trivial. Don't post quickly-generated one-offs."
- "A Show HN needn't be complicated or look slick. The community is comfortable with work that's at an early stage."
- No landing pages or fundraisers. "Once it's ready, come back and do it then."
- Minor version bumps ("Foo 1.3.1 is out") are not substantive enough. Major overhauls are ok.
- "Please don't ask friends to upvote or comment. That's not ok on HN."

**Community norms from discussions:**
- Up to ~3 reposts of the same project are generally accepted, spaced about one per week. — [Ask HN discussion](https://news.ycombinator.com/item?id=24170546)
- When mentioning your project in comments on other threads, it must be "directly relevant to the conversation" and "organically fit in." — [HN comment](https://news.ycombinator.com/item?id=47679119)
- Transparency is valued — don't pretend to be an unaffiliated third party. — [HN discussion](https://news.ycombinator.com/item?id=41967875)

**Verdict for a builder:** Show HN is the primary channel. Post your project there when it's ready for users to try. Participate in other discussions (curiosity-driven) so self-promotion is not your primary activity. Mentioning your tool in comments is acceptable only when directly relevant.

---

## 2. GitHub Discussions / Issues

**Primary source:** [GitHub Discussions Quickstart](https://docs.github.com/discussions/quickstart), [GitHub Blog: 5 tips for promoting your open source project](https://github.blog/open-source/maintainers/5-tips-for-promoting-your-open-source-project/), [GitHub Community Discussion #170078](https://github.com/orgs/community/discussions/170078)

**Key distinction:**
- **Your own repo's Discussions/Issues** — fully acceptable to promote, announce releases, gather feedback, run Q&A. This is the intended use.
- **Other projects' Discussions/Issues** — posting about your own tool is considered spam/low-quality contribution. — [GitHub Community Discussion #185387](https://github.com/orgs/community/discussions/185387)

**Official GitHub Blog advice for promotion:**
- "Respond to community posts with solutions" — be helpful first.
- "Reach out to podcasts and YouTube channels."
- "Submit conference talks."
- Write blog posts and share in relevant subreddits/Discord servers.
- Create your own Discussions for community building. — [GitHub Blog](https://github.blog/open-source/maintainers/5-tips-for-promoting-your-open-source-project/)

**Verdict for a builder:** Use your own repo's Discussions and Issues freely. Never post about your tool in another project's Issues or Discussions. GitHub itself recommends external channels (blogs, podcasts, conferences, Reddit, Discord) for cross-project visibility.

---

## 3. Dev.to

**Primary source:** [Dev.to Terms — Section 11 (Content Policy)](https://dev.to/terms), [community discussion on self-promotion](https://dev.to/samuelfaure/is-dev-to-victim-of-its-own-success-1ioj)

**Official rule (verbatim from Terms):**
- "Users must make a good-faith effort to share content that is on-topic, of high-quality, and is not designed primarily for the purposes of promotion or creating backlinks."
- "Posts must contain substantial content — they may not merely reference an external link that contains the full post."
- "If a post contains affiliate links, that fact must be clearly disclosed."

**Community norms:**
- A "discreet link to your own blog or github page is fine" but covert self-promotion is frowned upon. — [dev.to community post](https://dev.to/samuelfaure/is-dev-to-victim-of-its-own-success-1ioj)
- The accepted pattern is ~80/20: 80% genuinely helpful/educational content, 20% mentioning your own tool.
- Lead with educational/informative content (tutorials, deep-dives, lessons learned), not a sales pitch.
- Open source project introductions are welcome when framed as technical content ("how I built X," "lessons from building Y").

**Verdict for a builder:** Write a substantive technical article (e.g., "How I built a terminal panel for AI coding agents" or "Architecture decisions behind Stoa") and include your project link naturally. Pure announcement posts are likely to be flagged. The [Wasp 6k-star guide](https://dev.to/wasp/how-i-promoted-my-open-source-repo-to-6k-stars-in-6-months-3li9) is a good reference for format.

---

## 4. Lobsters

**Primary source:** [Lobsters About page](https://lobste.rs/about)

**Official rule (verbatim):**
- "It's great to have authors participate in the community, but not to exploit it as a write-only tool for product announcements or driving traffic to their work. As a rule of thumb, self-promo should be less than a quarter of one's stories and comments."

**Additional context:**
- Lobsters is "focused pretty narrowly on computing" — developer tools fit well.
- Invitation-only registration (invitation tree is public for accountability).
- New users (< 70 days) cannot submit links to domains not previously seen, cannot use certain tags, cannot flag or suggest edits.
- Has a tagging system; content must fit predefined tags.
- "Spam" flag reason: "content that either is designed to promote a commercial service or for content that is created without meaningful human authorship."
- Community values technical depth and genuine participation.

**Verdict for a builder:** You can submit your own open source project, but it must be < 25% of your total activity. Build a history of commenting on others' submissions and submitting third-party content first. Your project's technical content is very much on-topic.

---

## 5. Product Hunt

**Primary source:** [Product Hunt Launch Guide](https://www.producthunt.com/launch), [Product Hunt FAQ](https://www.producthunt.com/launch)

**Official stance:**
- Product Hunt **actively encourages** makers to launch their own products. "Interested in sharing something you made? DO IT!"
- "We encourage makers to hunt their own products, and there's no discernible advantage to using a third-party hunter."
- No company accounts — must be personal accounts.
- "You can launch as often as you have new significant product iterations available."
- "The only real rule here is that you cannot ask people directly to upvote your product. Instead, ask them to visit and comment."
- Featuring decisions are made by PH staff. [Featuring Guidelines](https://help.producthunt.com/en/articles/9883485-product-hunt-featuring-guidelines) explain criteria.

**Best practices:**
- Launch on Tuesday–Thursday for maximum visibility.
- Launch at 12:01 AM Pacific Time.
- Prepare assets: tagline, description, images, video.
- Engage with comments throughout launch day.
- Don't create fake accounts or ask for upvotes directly.

**Verdict for a builder:** Product Hunt is the most self-promotion-friendly platform. Launch your tool directly as the maker. The key constraint is authenticity — don't manipulate votes. A well-prepared launch with genuine engagement is the expected pattern.

---

## 6. Chinese Developer Communities

### V2EX (v2ex.com)

**Primary source:** [V2EX community guide](https://v2ex.com/t/164415), [V2EX 分享创造 node](https://www.v2ex.com/go/create), community discussions

**Dedicated node:** `/go/create` (分享创造 / "Share Creations") — specifically for sharing your own projects.

**Key rules:**
- Same project should generally only be posted **once** in 分享创造. Repeated posting of the same project is likely to result in a ban. — [V2EX discussion](https://www.v2ex.com/t/469028)
- Account registration time requirements may apply (varies; some report 30+ days).
- "推广" (`/go/promote`) node exists for more promotional content with different rules.
- No title-gaming (标题党) or funneling to WeChat groups (引流).
- Replies cannot be edited or deleted once sent.
- Topics can be edited within 600 seconds of creation; deletions available after 1800 seconds.

**Verdict:** Post once in 分享创造 with a clear, honest title and substantive project description. Don't repost the same project. Don't add WeChat/group funnels.

### 掘金 / Juejin (juejin.cn)

**Primary source:** [How to use Juejin community](https://juejin.cn/book/m/6844733795329900551/section/6876001660431400967), [Community content standards](https://juejin.cn/book/m/6844733795329900551/section/6844733795380232200)

**Acceptable topics:** "开源工具介绍" (open source tool introductions) is explicitly listed as an acceptable topic category.

**Key rules:**
- Content must have technical substance — pure advertisements are not acceptable.
- No bulk operations, fake engagement, or spam.
- Title format: translated articles use `[译]` prefix; original project posts use descriptive titles.
- 掘力值 (Juejin Power) system rewards quality content.
- 沸点 (Boiling Point, a microblogging feature) can be used for project updates.

**Verdict:** Write a quality technical article about your project — its architecture, design decisions, usage tutorial. This is explicitly welcomed. Don't post pure ads.

### 知乎 / Zhihu (zhihi.com)

**Primary source:** [Zhihu terms](https://www.zhihu.com/term/zhihu-terms), [How to promote open source on Zhihu](https://www.zhihu.com/question/26652664)

**Acceptable approach:**
- Answer relevant questions (e.g., "What are good terminal tools for developers?") and mention your project as one solution.
- Publish 专栏 (column) articles about the design and technical implementation.
- Must answer the question substantively; don't just drop a link.

**Verdict:** Find questions where your tool is genuinely relevant and provide a thorough answer that mentions it as one option among others. Don't just paste your link.

---

## Cross-Platform Summary Table

| Platform | Self-promo OK? | Format | Key Constraint | Effort Level |
|---|---|---|---|---|
| **Hacker News** | Yes, via Show HN | Title prefix "Show HN:" | Must not be primary activity; project must be try-out-able | Medium |
| **GitHub** | Own repo only | Discussions/Issues in your repo | Never post in other projects' spaces | Low (own repo) |
| **Dev.to** | Yes, with caveats | Technical article format | Must not be "primarily for promotion"; needs substantial content | Medium-High |
| **Lobsters** | Yes, <25% of activity | Standard link submission | Must participate broadly; self-promo minority | Medium |
| **Product Hunt** | Fully encouraged | Product launch page | No vote manipulation; no company accounts | Medium |
| **V2EX 分享创造** | Yes, once per project | Single post in /go/create | Don't repost same project; no funneling | Low |
| **掘金** | Yes, as tech article | Article format | Must have technical substance; no pure ads | Medium |
| **知乎** | Yes, in answers | Answer relevant questions | Must substantively answer; don't just drop links | Medium |

---

## Evidence Chain

| Finding | Source | Location |
|---|---|---|
| HN: "don't use HN primarily for promotion" | HN Guidelines | https://news.ycombinator.com/newsguidelines.html |
| HN: Show HN for "something you've made that other people can play with" | Show HN page | https://news.ycombinator.com/showhn.html |
| HN: Up to ~3 reposts acceptable | Community discussion | https://news.ycombinator.com/item?id=24170546 |
| Lobsters: "self-promo should be less than a quarter" | Lobsters About | https://lobste.rs/about |
| Lobsters: computing-focused, invitation tree | Lobsters About | https://lobste.rs/about |
| Dev.to: "not designed primarily for promotion" | Terms Section 11 | https://dev.to/terms |
| Dev.to: "discreet link is fine" but covert promo frowned upon | Community post | https://dev.to/samuelfaure/is-dev-to-victim-of-its-own-success-1ioj |
| Product Hunt: "Interested in sharing something you made? DO IT!" | Launch Guide | https://www.producthunt.com/launch |
| Product Hunt: "encourage makers to hunt their own products" | Launch Guide FAQ | https://www.producthunt.com/launch |
| Product Hunt: cannot ask for upvotes directly | Launch Guide | https://www.producthunt.com/launch |
| GitHub: cross-project promo = spam | Community Discussion | https://github.com/orgs/community/discussions/185387 |
| GitHub: 5 tips for promotion (use external channels) | GitHub Blog | https://github.blog/open-source/maintainers/5-tips-for-promoting-your-open-source-project/ |
| V2EX: same project only once in 分享创造 | Community discussion | https://www.v2ex.com/t/469028 |
| V2EX: community guide (replies can't be edited) | V2EX post | https://v2ex.com/t/164415 |
| 掘金: "开源工具介绍" is acceptable topic | How to use Juejin | https://juejin.cn/book/m/6844733795329900551/section/6876001660431400967 |
| 知乎: answer questions with project as solution | Zhihu Q&A | https://www.zhihu.com/question/26652664 |

### Risks / Unknowns

- [!] **Rate limiting hit Chinese sources hard.** V2EX and Juejin rules are based on fewer primary-source verifications than English platforms. The Zhihu section relies more on community guidance than official policy text.
- [!] **Lobsters is invitation-only.** You need an existing member to invite you, and new users face significant posting restrictions for 70 days. This is a high-friction channel.
- [!] **V2EX account age requirements are inconsistent across reports** (30 days vs. 90 days vs. 1014 days). The actual threshold likely depends on the node and whether external links are included.
- [?] **GitHub cross-project "discussions" etiquette** for very closely related tools (e.g., a plugin for another tool) is not well-documented. The line between helpful mention and spam may depend on the receiving project's maintainers.
- [?] **Dev.to moderation** of AI-generated or AI-assisted content is evolving. If the outreach workflow generates drafts with AI assistance, the originality threshold may need monitoring.
