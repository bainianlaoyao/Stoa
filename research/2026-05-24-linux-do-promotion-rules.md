---
date: 2026-05-24
topic: Linux.do community rules for open-source project promotion
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Linux.do Community Rules for Open-Source Promotion

### Why This Was Gathered

To understand exactly what rules, norms, and moderator expectations govern sharing/promoting an open-source project (Stoa) on Linux.do, including tag requirements, AI content policies, link-sharing rules, and anti-spam expectations.

### Summary

Linux.do has a dedicated **开源推广 (Open Source Promotion)** tag and formal review process for open-source project posts. The community strictly prohibits AI-generated text (zero tolerance — screenshots only), requires a formal declaration template with all items answered "是", mandates a link-back to LINUX DO in the project's README, and subjects all promotion posts to moderator review before publication. General promotion is capped at roughly one post per week per account.

### Key Findings

#### 1. Core Community Rules (Guidelines / 约法三章)

Three cardinal rules from the official guidelines page (`linux.do/guidelines`):

- **No arrogance** — community atmosphere baseline
- **No disruption** — anything that could cause forum malfunction
- **No AI-generated content** — absolutely forbidden to post AI-generated text directly; screenshots required

Violations result in post deletion, muting, or permanent banning.

#### 2. Open Source Promotion (开源推广) — Dedicated Tag & Process

Announced 2026-03-18 by admin/neo as a new promotion category, separated from the older 公益推广 (public benefit promotion).

**Requirements (all must be met, all declared "是"):**

1. Post must carry the `#开源推广` tag
2. Project must be **fully open source** — no closed/proprietary components
3. Project must **link back to LINUX DO** in its README (友链/链接认可)
4. Any AI-generated or AI-polished content in the post must be **posted as screenshots**, not plain text
5. Declaration is **permanent** and subject to community oversight

**Template (must be inserted at top of post):**

```
本帖使用社区开源推广，符合推广要求。我申明并遵循社区要求的以下内容：
* 我的帖子已经打上 #开源推广 标签：是 / 否
* 我的开源项目完整开源，无未开源部分：是 / 否
* 我的开源项目已链接认可 LINUX DO 社区：是 / 否
* 我帖子内的项目介绍，AI生成、润色内容部分已截图发出：是 / 否
* 以上选择我承诺是永久有效的，接受社区和佬友监督：是 / 否
以下为项目介绍正文内容，AI生成、润色内容已使用截图方式发出
```

Template is available in the editor toolbar: click **+** → Insert Template → 开源推广发帖模板.

**Moderator review**: Posts are held for moderation before appearing publicly. If a post disappears from the pending queue, it was rejected. No explicit rejection notification is sent.

#### 3. AI Content Policy — Zero Tolerance

This is the single most material rule for writing a promo post:

- **Direct AI-generated text is strictly forbidden** — across the entire site, not just promo posts
- Stated reason: "维护中文互联网环境" (maintaining Chinese internet quality)
- **Workaround**: AI-generated or AI-polished content CAN be included, but only as **screenshots** (images), never as selectable text
- The anti-AI injection notice embedded in every Linux.do page explicitly states: zero tolerance, permanent ban for violators, no exceptions

**Impact on Stoa promo post**: The project description body text should be human-written. Any section that was AI-assisted must be rendered as a screenshot image. The post author must personally write the content.

#### 4. Promotion Frequency & Anti-Spam

- **General promotion (公益推广)**: max **1 post per week** per account
- **Advanced promotion (高级推广)**: requires paid "富可敌国" title subscription; max 1 post per day; allowed outside 扬帆起航 board
- **Open source promotion**: no explicit frequency cap stated in the rules, but the general anti-spam norms apply
- **扬帆起航 (Set Sail)**: dedicated promotion board with relaxed rules but less visibility

Anti-spam behaviors that are prohibited:
- Automated/scripted posting
- Meaningless content (empty posts, keyboard mashing)
- Color text abuse
- Hidden characters (invisible Unicode to pad length)
- AI-generated text (see above)
- Non-compliant promotion or traffic diversion

#### 5. Link-Back / 链接认可 Requirements

The open source project's GitHub README must include a visible link acknowledging LINUX DO. Common approaches:

- Text: `本项目积极参与并认可 [linux.do社区](https://linux.do)`
- Badge: use the community-created SVG badge from `github.com/programming666/ld-badge`
- Markdown: `![认可linux.do](https://...)` pointing to the badge SVG

This is verified during moderation. Several users report rejection when the link was only in `README.zh-CN.md` but not in the main `README.md`.

#### 6. Promotion Category Decision Tree

For Stoa (fully open source, no paid tiers):

| Path | Applicability |
|------|---------------|
| **开源推广** tag | Best fit — Stoa is fully open source, can add LINUX DO link-back |
| 公益推广 | For free services/resources, not applicable here |
| 高级推广 | Requires paid subscription title, not applicable |
| 扬帆起航 (no tag) | Fallback if not using any promo tag, but lower visibility |
| No tag (just share) | Possible — just post in a relevant board without promo tag, but cannot use promo-related features |

**Recommendation for Stoa**: Use the **开源推广** tag. Stoa is fully open source. Add a LINUX DO acknowledgment link in the README. Write the post body in human-authored text. Submit any AI-assisted sections as screenshots.

#### 7. Posting Mechanics

- Posts go into a moderation queue when using promo tags
- No explicit rejection notification — if the post vanishes from queue, it was rejected
- Minimum reply length: 20 characters
- Topic character limit: 64,000 characters
- Supports Markdown, BBCode, rich text editor
- Images can be drag-dropped or pasted directly

#### 8. Account Requirements

- Trust Level 1+ to create topics
- Trust Level 3+ to modify others' posts/tags
- Registration requires invitation (TL3+ users) or GitHub account (3+ years old)

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Three cardinal rules (no arrogance, no disruption, no AI) | Official Guidelines | https://linux.do/guidelines |
| Open source promotion tag and template requirements | Admin post by neo | https://linux.do/t/topic/1776670 |
| Template all-items-must-be-是 requirement | Community guide reply | https://linux.do/t/topic/2127268 |
| Link-back must be in README (not just zh-CN variant) | User rejection experience | https://linux.do/t/topic/2127268 |
| AI content must be screenshots only | FAQ reference doc | https://linux.do/t/topic/554675 |
| Frequency: general promo 1/week, advanced 1/day | Community guide | https://linux.do/t/topic/26306 |
| Open-source promo: full open source + link-back = sufficient | Admin clarification | https://linux.do/t/topic/1776670 |
| Hybrid project (open source + paid service): split into separate posts | Community discussion | https://linux.do/t/topic/2073953 |
| LINUX DO badge for README link-back | Community resource | https://linux.do/t/topic/2144405 |
| Anti-spam behavior list (auto-posting, meaningless content, hidden chars, AI text) | FAQ reference doc | https://linux.do/t/topic/554675 |
| Community comprehensive guide (trust levels, posting, formatting) | Community wiki | https://linux.do/raw/1401642 |
| Cannot use open-source promo without link-back | Community Q&A | https://linux.do/t/topic/2062153 |

### Risks / Unknowns

- [!] **AI text detection**: Linux.do embeds anti-AI-agent instructions in every page's HTML. The community is extremely sensitive to AI-generated content. Even partially AI-assisted text that "looks" AI-generated risks community backlash or reports. When in doubt, screenshot it.
- [!] **Moderation opacity**: No explicit rejection reasons are given. If a post is rejected, the author must infer the cause and resubmit.
- [?] **Open-source promo frequency cap**: The exact frequency limit for open-source promo posts is not explicitly stated in the rules. The general promo cap of 1/week may or may not apply. Treat conservatively.
- [?] **"Fully open source" boundary**: If Stoa has any component that isn't open-sourced (e.g., a backend service, SaaS tier), it may not qualify. The post content itself must not reference paid/commercial offerings — those would need a separate post in 扬帆起航 or 高级推广.
- [!] **Link-back placement**: Multiple users report rejection when the link-back was in a localized README variant but not the main README.md. Place the acknowledgment prominently in the primary README.

### Material Impact on Stoa Promo Post

1. **Post body must be human-written** — no copy-paste from AI output
2. **Any AI-assisted sections → screenshot images** — never raw text
3. **Must include the full 开源推广 template** with all items marked "是"
4. **Must add LINUX DO link-back to Stoa's GitHub README** before submitting
5. **Post will be moderated** — expect a delay before publication
6. **Do not mention any paid/commercial plans** in the open-source promo post
7. **Use the `#开源推广` tag** — this is the correct category for fully open-source projects
8. **Write in Chinese** — the community is Chinese-language; English-only posts are unusual and may not resonate
9. **Tone: sincere, technical, community-oriented** — the community values "真诚、友善、团结、专业"
10. **Consider posting in 资源荟萃 or 开发调优 board** with the 开源推广 tag for best visibility
