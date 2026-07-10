# Propago — Definitive Design & Behavior Spec (Claude Code implementation contract)

**Read this before writing any frontend code.** This document is the single source of truth for making the production app **look and act exactly like the design prototype** at `design/Propago Dashboard.dc.html` (open it in a browser — it is fully interactive). Where this document and any other file disagree, **the prototype wins for UI/UX** and **CLAUDE-era architecture rules (README "Architecture rules honored") win for backend behavior**.

- **Fidelity: HIGH.** The prototype is a pixel-accurate mock with final colors, type, spacing, copy and interactions. Recreate it 1:1 in the React + Tailwind frontend (`frontend/src/`), using exact hex values and the copy strings in this doc. Do not restyle, "improve", rename, or reorganize screens.
- The prototype file is a **design reference, not production code**. Do not ship or import it; rebuild its screens as React components. It uses a small template runtime (`design/support.js`) — ignore that mechanism entirely.
- The prototype **simulates** the backend in-browser (timers, localStorage, fake data). §12 maps every simulation to its real production behavior. Everything else — layout, colors, copy, control placement, state transitions as seen by the user — must match verbatim.

---

## 1. Design tokens

Implement as CSS custom properties on `:root`, swapped by theme (see §11 Theming). These are the **exact** values from the prototype's `THEMES` object. Do not round, rename, or substitute Tailwind palette colors — extend Tailwind config to point at these variables.

### 1.1 Light theme (default)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f4f2ed` | app background |
| `--bg2` | `#fbfaf6` | header bar, modal body, inputs |
| `--card` | `#ffffff` | cards, table container |
| `--bg3` | `#f8f6f0` | row hover, keyword chips, inactive filter pills |
| `--bg4` | `#f7f5ef` | code/mono info boxes, PDF preview well |
| `--bg5` | `#f1efe7` | button hover, queue chip bg, pending badge bg |
| `--line` | `#e7e4da` | card borders |
| `--line2` | `#f0ede4` | row separators, dashed dividers |
| `--line3` | `#ece9df` | inner boxes, job cards |
| `--line4` | `#e4e1d7` | header border, chip borders, quote bars |
| `--line5` | `#d8d4c8` | input borders, secondary button borders |
| `--line6` | `#c9c4b4` | "PDF" tag border |
| `--seg` | `#e4e0d3` | pending pipeline segment |
| `--dot` | `#d9d5c7` | pending stage dot |
| `--skip` | `#c6c1b2` | skipped segment |
| `--tx` | `#1a1d20` | primary ink |
| `--tx1` | `#3a3e44` | body text |
| `--tx2` | `#5c6470` | secondary text |
| `--tx3` | `#8a8578` | muted labels (uppercase mono labels) |
| `--tx4` | `#bdb8a9` | faint text, placeholders |
| `--grn` | `#137a5b` | primary green (buttons, done, success) |
| `--grnH` | `#0e5f47` | green hover |
| `--amb` | `#b45309` | amber (running status text, warnings) |
| `--ambH` | `#d97706` | amber highlight (active segments, pulse dots) |
| `--amb2` | `#a16207` | partial status |
| `--vio` | `#5b4fc2` | violet (review gate, avatars, badges) |
| `--red` | `#b3261e` | red (failed, reject) |
| `--redH` | `#8e1b15` | red hover |
| `--cyn` | `#0e7490` | cyan (distribution gate) |
| `--redT` | `#faf1f0` | red tint bg (error boxes) |
| `--redL` | `#e4c7c5` | red border (reject buttons, error boxes) |

### 1.2 Dark theme

```
--bg #101214   --bg2 #16191d   --card #1b2025   --bg3 #22262c   --bg4 #15181c   --bg5 #262b32
--line #2b3038 --line2 #262b32 --line3 #2b3038  --line4 #303640 --line5 #3c434d --line6 #4a515b
--seg #333941  --dot #3f464f   --skip #4c535c
--tx #e8e6e1   --tx1 #c6c4be   --tx2 #9aa0aa    --tx3 #7c828e   --tx4 #575d67
--grn #1f9d76  --grnH #27b489  --amb #e0913c    --ambH #eca84f  --amb2 #cfa14a
--vio #9187ea  --red #e0625a   --redH #eb7a72   --cyn #38b2d2
--redT rgba(224,98,90,.12)     --redL #5c3936
```

The **sidebar does not theme** — it is always `#15181B` bg / `#E9E7E1` text (see §3.1).

### 1.3 Typography

Google Fonts import (exact):
`https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap`

- **Body**: `'IBM Plex Sans', system-ui, sans-serif`, base **13.5px**, color `var(--tx)`.
- **Display** (page titles, big numbers, card titles, blog H1s in-dashboard): `'Space Grotesk', sans-serif`, weight 600–700.
- **Mono** (labels, ids, timestamps, chips, code boxes): `'IBM Plex Mono', monospace`. Uppercase micro-labels are 9–9.5px, `letter-spacing: .1em`, `text-transform: uppercase`, color `var(--tx3)`.
- The **blog preview** (§9.2) uses **Arial** exclusively — it renders the client website's theme, not the dashboard's.

### 1.4 Shape & effects

- Cards: `border-radius: 10px`, `border: 1px solid var(--line)`, bg `var(--card)`. Modals: 12px radius. Inputs/buttons: 7–8px. Pills/badges: `border-radius: 99px`.
- Modal shadow `0 24px 60px rgba(15,13,10,.4)`; login card `0 10px 30px rgba(20,18,12,.08)`; toast `0 10px 28px rgba(20,18,12,.28)`.
- Pulse animation (active dots/segments): `@keyframes nfPulse { 0%,100%{opacity:1} 50%{opacity:.3} }`, `1.4s ease-in-out infinite`.
- Toast entry: fade + 8px drop-in, .25s ease.
- Scrollbars: 10px, thumb `var(--line5)` radius 6 with 2px `var(--bg)` border, transparent track. Placeholder color `var(--tx4)`.

### 1.5 Status vocabulary (run-level)

| status | Label | Text color | Pill bg |
|---|---|---|---|
| `running` | `Running` | `var(--amb)` | `rgba(180,83,9,.11)` |
| `review` | `In review` | `var(--vio)` | `rgba(91,79,194,.11)` |
| `distreview` | `Dist. review` | `var(--cyn)` | `rgba(14,116,144,.11)` |
| `failed` | `Failed` | `var(--red)` | `rgba(179,38,30,.09)` |
| `complete` | `Complete` | `var(--grn)` | `rgba(19,122,91,.11)` |
| `rejected` | `Rejected` | `var(--tx3)` | `rgba(130,130,140,.12)` |

Status pills: mono 9.5px uppercase, `letter-spacing:.06em`, padding `3px 8–9px`, radius 99px.

### 1.6 Stage-status colors (segments, dots, job badges)

| stage status | color | badge tint bg |
|---|---|---|
| `done` | `var(--grn)` | `rgba(19,122,91,.12)` |
| `active` / `retry` | `var(--ambH)` (pulsing) | `rgba(217,119,6,.14)` |
| `gate` | `var(--vio)` (pulsing) | `rgba(91,79,194,.14)` |
| `pending` | segment `var(--seg)`, dot `var(--dot)`, badge bg `var(--bg5)`, text `var(--tx3)` |
| `failed` | `var(--red)` | `rgba(179,38,30,.12)` |
| `partial` | `var(--amb2)` | `rgba(161,98,7,.14)` |
| `skipped` | `var(--skip)` | `rgba(128,133,128,.14)` |
| `rejected` | `var(--tx3)` | `rgba(130,130,140,.16)` |

Badge labels: `Done`, `Running`, `Retrying`, `In review`, `Pending`, `Failed`, `Partial`, `Skipped`, `Rejected`.

### 1.7 Named string constants (verbatim — do not "fix" spelling)

- `ACCT_STATUS = "Ready for Accountant Revi"` — the Karbon work-item status name, truncated at 25 chars by Karbon. Rendered verbatim everywhere it appears (Archive gateway pill, archive filter chip, audit lines `Flagged "Ready for Accountant Revi" — paused for human review…`, approve toast `(was "Ready for Accountant Revi")`).
- `FAIL_LOG = "Automation Issue - Manual"` — audit line prefix when a run parks after exhausted retries: `Automation Issue - Manual — WF-1039 parked after retries exhausted; flagged for manual intervention`.
- Trigger stage display: `Work item → "Marketing Content — Ready"`.

---

## 2. The pipeline (12 stages)

Every WorkflowRun renders as this fixed 12-stage sequence. Segments, strips, stage lists, and the job-log modal all derive from it.

| # | key | Label | Strip | System caption | Queue (job modal) |
|---|---|---|---|---|---|
| 01 | `trigger` | Trigger | TRG | `Karbon webhook` | `content-pipeline` |
| 02 | `research` | Research | RES | `Web search + ChatGPT extract` | `content-pipeline` |
| 03 | `draft` | Generate | GEN | `ChatGPT Business API · 90s` | `content-pipeline` |
| 04 | `seo` | SEO score | SEO | `Internal scorer` | `content-pipeline` |
| 05 | `review` | Review | REV | `Human gate` | `human-gate` |
| 06 | `deploy` | Deploy | DEP | `WordPress REST` | `wordpress` |
| 07 | `distgen` | Dist. gen | GEN | `OpenAI GPT-4o` | `content-pipeline` |
| 08 | `distreview` | Dist. review | DRV | `Human gate` | `human-gate` |
| 09 | `ads` | Ads | ADS | `Meta Marketing API` | `meta-ads · 10 req/10s` |
| 10 | `email` | Email | EML | `ActiveCampaign` | `activecampaign · 5 req/s` |
| 11 | `social` | Social | SOC | `LinkedIn · FB · IG` | `social` |
| 12 | `callback` | Callback | CBK | `Karbon Timeline API` | `karbon` |

### 2.1 Flow rules (must behave exactly like this)

1. **Trigger** — a verified webhook (or simulate button / scheduler) creates **exactly 3 runs** (`RUNS_PER_TRIGGER = 3`, one WorkflowRun per content set). Stage note: `Karbon webhook verified (HMAC ✓) — topic, keywords, tone extracted`.
2. **Research** — web search + ChatGPT extract ONE pain point. **Levenshtein guard**: similarity vs. prior research > 0.7 ⇒ duplicate ⇒ re-extract (registry row `duplicate-blocked`, method `Levenshtein research guard`). Unique ⇒ saved. Note: `Web search + ChatGPT pain-point extraction · Levenshtein {n} vs nearest — unique, saved to research registry`.
3. **Generate** — OpenAI produces 1000+ word post + lead magnet + captions. **Uniqueness Registry check**: all 5 assets (blog, linkedin, facebook, instagram, magnet) are SHA-256 hashed; TF-IDF cosine vs registry `≥ 0.82` ⇒ asset rejected, loop back to **research/generate** and regenerate (registry row `duplicate-blocked`; audit: `Uniqueness Registry: TF-IDF cosine {n} ≥ 0.82 — asset rejected, regenerating (no repeat content permitted)`). Success note: `ChatGPT Business API 200 OK in {n}s — {words}-word post + LinkedIn/FB/IG + lead magnet · registry: SHA-256 + TF-IDF unique`.
4. **SEO score** — internal scorer (§8.1). If `total < threshold` and auto-SEO loop count < **3**: increment loop, log applied suggestions, regenerate (stage 03 becomes active again with note `Regenerating with {n} SEO fixes (auto-loop {k}): {first suggestion}`). If `total ≥ threshold` (or 3 loops exhausted): pause at **Review** with `status='review'`, stage 05 = `gate`. Audit: `Flagged "Ready for Accountant Revi" — paused for human review (threshold {th}, auto-approve {on|off})`.
5. **Review (gate 1)** — human actions: Approve / Edit draft / Request revision / Remake / Reject (§8.2). Auto-approve (if enabled and score ≥ threshold) clears this gate ONLY, after a short hold, logged as `Auto-approved — SEO {n} ≥ threshold {th}`.
6. **Deploy** — WordPress REST. On failure: retries with exponential backoff (`retry` status, note `POST /wp-json/wp/v2/posts → 502 Bad Gateway · retry 1/3 in 2s (exponential backoff)`); success `POST /wp-json/wp/v2/posts → 201 Created · live URL stored`; sets `blogUrl` (`elementaccounting.ca/blog/{slug}`) and `magnetUrl` (`elementaccounting.ca/downloads/{slug3}-checklist.pdf`). 3 failures ⇒ run `failed`, "Workflow Failed" note posted to Karbon timeline, manual **Retry now** button appears (§6).
7. **Dist. gen** — GPT-4o generates ad + email + 3 captions (brand voice in system prompt), then pauses at **Dist. review** (`status='distreview'`, stage 08 = `gate`). Toast: `{RUN} distribution payloads ready for review`. Audit: `Paused — distribution review gate (human approval required; auto-approve never applies here)`.
8. **Dist. review (gate 2)** — ALWAYS human. Publish jobs are enqueued only on **Approve & Publish All** (§8.3).
9. **Ads / Email / Social** — each honors the adapter toggles in Settings: a disabled adapter's stage is `skipped` with note `Skipped — adapter disabled in Settings`; downstream stages still run. Social failures are per-platform and **non-blocking**: expired IG token ⇒ stage `partial`, note `LinkedIn ✓ · Facebook ✓ · Instagram ✕ (token expired) — non-blocking, flagged in Connections`, run still completes.
10. **Callback** — Karbon Timeline note: `Karbon Timeline API: note posted to {KB-…} — links + completion summary (custom fields untouched)`. Run `complete`; final audit `Workflow complete — all jobs succeeded` (+ ` (1 partial)` when social was partial).

**Slug rule** (`slugOf`): lowercase topic, strip non `[a-z0-9 ]`, first 5 words joined with `-`. Magnet/UTM slug = first 3 words of that.

---

## 3. App shell

Full-viewport flex row, `height: 100vh; overflow: hidden`.

### 3.1 Sidebar — 218px fixed, never themes

- bg `#15181B`, text `#E9E7E1`, padding `18px 12px 14px`, column flex.
- **Logo block** (bottom border `rgba(255,255,255,.08)`): 26px square radius-6 tile bg `var(--grn)`, glyph `N` (Space Grotesk 700 13px, color `#F4F2ED`); wordmark `Propago` (Space Grotesk 700 14.5px); underneath in mono 9px uppercase ls .14em color `#8B8FA0`: `marketing ops`.
- **Nav** (8 items, mono 2-digit index + label):
  `01 Runs · 02 Orchestrator · 03 Review queue · 04 Archive · 05 Lead magnets · 06 Registry · 07 Connections · 08 Settings`
  Item: 9px 10px padding, radius 7. Inactive: label `#A7ABB8` w400, number `#5A5F6E`. Active (also when viewing a Run detail, "Runs" stays active): bg `rgba(255,255,255,.1)`, label `#F4F2ED` w600, number `#2FBF8F`. Hover: bg `rgba(255,255,255,.08)`.
  **Badges** (violet pill, white mono 10px): on **Review queue** = count of runs in `review` + `distreview`; on **Archive** = count in `review` only. Hidden at 0.
- **Sandbox note** (dashed `rgba(255,255,255,.18)` border, radius 8): line 1 mono 9.5px uppercase color `#D9A03F`: `● sandbox mode`; line 2 10.5px `#8B8FA0`: `Meta Ads + Karbon webhook run against sandbox until app review clears.`
- **Identity row** (bg `rgba(255,255,255,.04)`, radius 7): 24px violet circle with initials; name 11.5px w500 ellipsized; role line 9.5px `#8B8FA0` = `Marketing · {role}`; `log out` ghost button (mono 8.5px uppercase, border `rgba(255,255,255,.22)`, text `#A7ABB8`).

### 3.2 Header — 58px, bg `var(--bg2)`, bottom border `var(--line4)`

- Left: page title (Space Grotesk 16px w600) + subtitle (11px `var(--tx3)`). Exact pairs:

| View | Title | Subtitle |
|---|---|---|
| Runs | `Workflow runs` | `Karbon-triggered pipelines · click a run for its BullMQ job log` |
| Run detail | `Run detail` | `Stage-by-stage saga state, artifacts and audit trail` |
| Orchestrator | `Prompt & Orchestrator` | `Master research prompt, target pain point and the auto-runner schedule` |
| Review queue | `Review queue` | `Auto-SEO loop → two human gates: content draft, then distribution` |
| Archive | `Content archive` | `Every asset the system has produced · final review gateway` |
| Lead magnets | `Lead magnets` | `Every downloadable PDF the system has produced · preview, live URL and leads captured` |
| Registry | `Uniqueness registry` | `SHA-256 exact + TF-IDF cosine · no repeat content is ever permitted` |
| Connections | `Connected accounts` | `Adapter credentials · tokens encrypted at rest (AES-256-GCM)` |
| Settings | `Settings` | `Gates, brand voice, trigger config and adapters` |

- Right cluster: **queue chip** (mono 10.5px, bg `var(--bg5)`, border `var(--line4)`): `BullMQ · active {n}` (n = runs currently `running`); **theme toggle** 34px square (`☾` in light, `☼` in dark, tooltip `Toggle dark mode`); **`Simulate Karbon trigger`** primary green button (12.5px w600, padding 9px 16px, radius 7, hover `var(--grnH)`), tooltip: `Posts a signed webhook — each trigger queues exactly 3 content sets (blog + lead magnet + distribution)`.

### 3.3 Content area

`flex:1; overflow:auto; padding: 22px 24px 40px`.

### 3.4 Toast

Fixed top-center (`top:14px`), z-60, bg `#15181B`, text `#E9E7E1`, radius 8, padding 10px 18px, border `rgba(255,255,255,.14)`, 7px green (`#2FBF8F`) dot, message in mono 11.5px. Auto-dismisses (~4–5s). Full catalog of messages in §10.

---

## 4. Login screen (full-viewport overlay when signed out)

Centered 400px column on `var(--bg)`:

- Logo lockup (34px `N` tile + `Propago` 19px + mono tagline `marketing ops · team sign-in`).
- Card: `Email` + `Password` labeled inputs (mono uppercase 9.5px labels; inputs bg `var(--bg2)`, border `var(--line5)`, radius 7). Enter key submits. Inline error text 11.5px `var(--red)`.
- Full-width green `Sign in` button.
- Divider: `demo accounts` (mono 9px uppercase between hairlines).
- One row per user: 24px violet initials circle, name, role in mono colored by role (admin `var(--grn)`, reviewer `var(--vio)`, editor `var(--amb)`). Click pre-fills the form.
- Footnote 10px `var(--tx4)`: `Invite-only — only accounts an admin has added can sign in; there is no open sign-up. Pick a demo account; any password works. Production build: bcrypt hashes, JWT sessions, /api/auth middleware on every route.` → in production replace last sentence with nothing; auth is real (§12).

Errors (verbatim):
- Unknown email: `Invite-only — that email hasn't been invited. Ask an admin to add you in Settings → Team.`
- Empty password: `Enter your password (any password works in the prototype).` → production: `Enter your password.`
- Production adds: wrong password ⇒ `Incorrect email or password.`

Sign-in toast: `Signed in as {handle} · role: {role} · session active`.

**Seed users** (schema.sql already seeds them; handles = `j.mercer`, `d.okafor`, `m.reyes`):
Jude Mercer / JM / jmercer@elementaccounting.ca / admin · Dana Okafor / DO / dokafor@ / reviewer · Marcus Reyes / MR / mreyes@ / editor.

---

## 5. Runs page (`01 Runs`)

### 5.1 Stat cards — 4-col grid, gap 12

`Active runs` (value amber; sub `BullMQ · content-pipeline`) · `Awaiting review` (violet; `content + distribution gates`; counts review+distreview) · `Failed / parked` (red when >0 else ink; `manual retry available`) · `Completed` (green; `Karbon notified`). Card: mono uppercase label, Space Grotesk 25px value, 10.5px sub.

### 5.2 Runs table

One card, horizontal scroll ≥740px. Grid columns exactly: `100px minmax(200px,1fr) 128px 96px 40px 68px 12px`, gap 12, padding 11–13px 18px. Mono uppercase header row: `Run · Topic · client · Pipeline · Status · SEO · Updated · (blank)`.

Row cells: ① run id (mono 12 w600) over Karbon id (mono 10 `--tx3`); ② topic (13px w500, ellipsis) over client (11px `--tx3`); ③ **pipeline strip** — 12 segments 8×6px radius 2, colored per §1.6, active/retry/gate pulse; ④ status pill (§1.5); ⑤ SEO score mono 12.5 w600 (green if ≥ threshold, amber if below, `—` in `--tx4` if none); ⑥ relative time (`just now`, `{n}m ago`, `{n.n}h ago`); ⑦ `→` in `--tx4`. Row hover bg `var(--bg3)`.

**Sort**: status priority `review(0) → distreview(1) → running(2) → failed(3) → complete(4) → rejected(5)`, then newest `createdAt` first.

**Click a row ⇒ opens the audit-trail modal (§9.1), NOT the detail page.** ("Open full run →" inside the modal navigates to Run detail.)

### 5.3 Legend (below table, mono 10px)

`■ done` green · `■ running` `--ambH` · `■ review gate` violet · `■ partial` `--amb2` · `■ failed` red · `■ pending/skipped` `--skip`.

---

## 6. Run detail page

- `← all runs` mono back link (hover green).
- **Header card**: run id + karbon id + status pill; right `created {ago}`; topic (Space Grotesk 19 w600); meta line `{client} · tone: {tone} · {no revisions | n revision(s)}`; keyword chips (mono 10px, bg `--bg3`, border `--line4`); **12-segment strip** with mono 8.5px uppercase labels under each segment (`TRG RES GEN SEO REV DEP GEN DRV ADS EML SOC CBK`), colored/pulsing per stage.
- **Two-column grid `1fr 336px`, gap 14.**
- **Left — Saga stages card**, header `Saga stages · durable via BullMQ + Postgres`. One row per stage: `01`-style number, 8px status dot (pulse when live), label w600 + system caption (11px `--tx3`), meta (mono 10px: `{n} attempts · {dur}` — duration formats: `<1s → {n}ms`, `<90s → {n.n}s`, else `{n}m`), status badge (96px wide, §1.6). Failed stage on a failed run gets red **`Retry now`** button → re-activates the stage, increments attempts, logs `Manual retry — deploy attempt {n}`. Note block (mono 10.5px on `--bg4`) when a stage has a note or is `In progress…`.
- **Right — Artifacts card** (6 fixed rows: label 10.5px + mono value; green when live, `--tx4` placeholder when pending):
  `Blog post (WordPress)` → url or `— pending deploy` · `Lead magnet PDF` → url or `— pending deploy` · `Meta ads (sandbox)` → `camp_… · adset_… · ad_… (sandbox)` or `— pending` · `ActiveCampaign` → `cmp_… — sent to 1,842 contacts` or `— pending` · `Social posts` → `LinkedIn ✓ · Facebook ✓ · Instagram ✕/✓` or `— pending` · `Karbon timeline note` → `{KB-…} — timeline note posted (links + summary)` or `— on completion / terminal failure`.
- **Right — Audit trail card** (scroll, max-height 340): rows `{HH:MM:SS}` (mono 9.5 `--tx4`, 52px) + actor (mono 9.5, 56px; human handles violet, `api` green, `system` `--tx3`) + message (11px). Newest first.

---

## 7. Review queue page (`03 Review queue`)

### 7.1 Empty state (no runs in review/distreview)

Centered: mono uppercase `queue clear`; Space Grotesk 19 `0 drafts awaiting review`; 12px body: `Runs pause here twice — once for the blog draft after SEO scoring, and again for ad, email and social payloads before anything publishes.`

### 7.2 Card strip

Label `Awaiting review · {n}`. Horizontal scroll of 242px cards: run id + **gate badge** (`content` violet on `rgba(91,79,194,.1)` / `distribution` cyan on `rgba(14,116,144,.1)`) + SEO `84/100` right-aligned (green/amber); draft title (12px w500); `{client} · waiting {12m}`. Selected card: green border + `0 2px 8px rgba(19,122,91,.12)`; hover border green.

### 7.3 Main grid `minmax(0,1fr) 300px`

**Peer-viewing banner** (only content gate, when another session has the item open): amber tint `rgba(217,119,6,.1)` box, pulsing dot, text: `{handle} is viewing this draft right now — approvals are first-come, and you'll be notified if it moves.`

**Tabs**: `Blog post · Meta Ads · Email · Social` (12.5px; active w600 ink + 2px green underline). Ads/Email/Social tabs show a 5px amber dot when that channel payload has unsaved manual edits. Selecting a distribution-gate card defaults to the `Meta Ads` tab; content gate defaults to `Blog post`.

#### Blog post tab
- Chip `draft` (violet tint) at gate 1 / `approved` (green tint) at gate 2 + `{1,264 words} · {first draft | revision n}` + run id right.
- Title (Space Grotesk 21 w600), meta description (12.5px, 2px left border `--line4`).
- Black-on-ink button **`Preview whole blog + lead magnet →`** ⇒ opens preview modal (§9.2).
- Keyword chips; divider; 2 intro paragraphs (13px/1.7); `Section outline` label; H2 rows (`H2` in green mono + heading, dashed separators); **lead magnet row** (bg `--bg4`): `PDF` tag, magnet name + caption `Lead magnet · generated by ChatGPT Business API · deploys with the post`, `Preview PDF`/`Hide preview` toggle button revealing an inline PDF mock: header `lead-magnet.pdf · by ChatGPT Business API · 38 KB` + URL (`{magnetUrl}` green when live, else `URL assigned at deploy`), white sheet (max 500px) with `Element Accounting · client resource` eyebrow, magnet title, 5 numbered checklist items (`01…05`, dashed rules), footer `+ 7 more items · page 1 of 3`.
- **Edit mode** (from right-rail `Edit draft`): `Title` input; `Meta description` textarea with live counter `{n}/155` (red past 155); `Save edits` (green) + `Cancel`. Save logs `Draft edited — title + meta description updated`.

#### Meta Ads tab (distribution)
- Pending (gate 1): dashed placeholder — mono `payloads pending` + `Ad creative is generated right after content approval and WordPress deploy, then pauses here at the distribution gate for your review.`
- Ready: badge `meta ads · sandbox` (amber tint) + caption `LEADGEN objective · queue meta-ads · limiter 10 req/10s`; `Reset to generated` ghost button appears only when edited.
- Fields with live counters (counter red past limit): **Ad headline** `{n}/40`; **Primary text** `{n}/125` (4-row textarea); **Destination link** (mono input) + helper `ActiveCampaign sign-up form — the ad's lead destination. Counters go red past Meta's recommended limits.`
- UTM row: `utm enforced at publish` + code chip `?utm_source=meta_ads&utm_medium=paid_social&utm_campaign={slug3}`.

#### Email tab
- Badge `activecampaign` (#265B8F on `rgba(38,91,143,.12)`) + `Subscribers (1,842) + ad-leads segment · limiter 5 req/s`; reset button when edited.
- **Subject line** input, counter `{n}/60`; **Body** 11-row textarea; helper `The first_name token is an ActiveCampaign merge tag — resolved per contact at send.`
- UTM chip: `?utm_source=activecampaign&utm_medium=email&utm_campaign={slug3}`.

#### Social tab
- Badge `organic social` (violet tint) + `3 adapters · independent, non-blocking failures`; reset button when edited; UTM chip `?utm_source={platform}&utm_medium=organic_social&utm_campaign={slug3}`.
- Three platform boxes, each with 24px logo tile, name, scope caption, counter, textarea:
  - **LinkedIn** — tile `LI` `#0A4D77`/`#C6E2F2`; `company page · w_organization_social`; counter `{n} chars`; 4 rows.
  - **Facebook** — `FB` `#1B4C8C`/`#CBDDF5`; `page token · pages_manage_posts`; `{n} chars`; 3 rows.
  - **Instagram** — `IG` `#7A2E5C`/`#F2CFE4`; `instagram_content_publish`; counter `{n}/2200`; 4 rows; helper `Captions can't carry links — the CTA reads "link in bio".`

### 7.4 Right rail — Gate 1 (content)

**SEO score card**: label + right `threshold {th} · auto {on|off}`; score Space Grotesk 40 w700 (green ≥ th, amber below) + verdict `≥ threshold {th}` / `below threshold {th}`; if the run passed via auto-SEO loop: green tint note `Passed after {n} automatic SEO regeneration(s) — suggestions fed back to ChatGPT until ≥ {th}` and, when present, `Suggestions applied on regeneration` ✓-list. Four bars — `Keyword density`, `Readability`, `Heading structure`, `Meta tags` — 5px track `--line2`, fill % = value, color: ≥80 green, ≥60 amber, else red. `Suggestions` list with amber `→` markers.

**Actions card** (buttons full-width, 8px gaps):
1. `Approve → deploy` (green primary)
2. `Edit draft` (ghost)
3. Row: `Remake` (ghost, 50%) + `Reject` (red-border ghost; hover fills red, 50%)
4. `Request revision` (red-border ghost) ⇒ swaps to: 3-row textarea placeholder `What should the model change? e.g. tighten keyword usage in intro, trim meta description` + `Send back to generation` (red primary) + `Cancel`.

Footer note (10.5px `--tx3`), by state:
- editor: `Signed in as editor — you can edit drafts and payloads, but approve/publish needs an admin or reviewer. Every action is logged with your user id.`
- auto on: `Auto-approve is ON — drafts scoring ≥ {th} clear the content gate after a short hold. The distribution gate that follows always needs a human.`
- default: `Approval deploys the post, then ad, email and social payloads pause at a distribution gate — nothing publishes without a second sign-off.`

**Editor visual state**: Approve/Publish/bulk-approve buttons render at opacity .45 with `cursor: not-allowed` for editors (still clickable — click shows the role toast; server also enforces 403).

### 7.5 Right rail — Gate 2 (distribution)

**Distribution gate card**: cyan mono label `Distribution gate`; body `Generated from the approved post. Publish jobs are not enqueued until you approve below.`; 3 channel rows (click switches tab): `Meta Ads` / `ActiveCampaign` / `Organic social`, sub captions `LEADGEN campaign · sandbox · limiter 10 req/10s` / `1,842 subscribers + ad-leads segment · limiter 5 req/s` / `LinkedIn · Facebook · Instagram · non-blocking`; right state `will publish` (green) or `skipped — off` (`--tx4`) per Settings toggles; amber `edited` pill when overridden.

**Publish card**: `Approve & Publish All` (green primary; editor-dimmed) + note `Nothing is enqueued to the adapters until this approval. Edits are saved as manual overrides and logged to the audit trail.`

Behavior: editing any field marks that channel edited (deep-compare vs. generated original); `Reset to generated` restores + logs `{Meta Ads|Email|Social} payload reset to generated version`. Publish logs (in order): `Manual overrides saved — {channels}` (if any) → `Distribution approved — publish jobs enqueued (meta-ads · activecampaign · social)` → `UTM enforcement — channel parameters appended to all outbound links (meta_ads · activecampaign · linkedin · facebook)`. Stage-08 note: `Approved & published by {handle} · overrides: {channels}` or `· payloads unchanged`.

---

## 8. Remaining pages

### 8.1 SEO scorer (backend contract feeding §7.4)

Subscores `kw, read, head, meta` (0–100); `total = round(kw*.3 + read*.3 + head*.2 + meta*.2)`. Suggestion strings (emit when applicable, verbatim style):
`Primary keyword missing from the first 100 words — add to intro paragraph.` · `Keyword density 0.6% — target 1–1.5% for "{kw}".` · `Meta description is 172 chars — trim to ≤155 so it doesn't truncate.` · `Readability: 4 sentences exceed 28 words — split them.` · `Add the secondary keyword to at least one H2.` · fallback `Add an internal link to the services page in the closing section.`

### 8.2 Gate-1 role & conflict matrix (client UX + server enforcement)

| Action | admin | reviewer | editor | Conflict (already handled) toast |
|---|---|---|---|---|
| Approve | ✓ | ✓ | ✕ toast `Editor role can't approve — admin or reviewer required` | `{RUN} was already approved by {who} — nothing overwritten` |
| Edit draft | ✓ | ✓ | ✓ (logged) | — |
| Request revision | ✓ | ✓ | ✕ (server 403; prototype allows the textarea but confirm-blocks stale runs) | `{RUN} was already approved by {who} — revision not sent` |
| Remake | ✓ | ✓ | **✓** (any role) | `{RUN} was already handled by {who} — remake not sent` |
| Reject | ✓ | ✓ | ✕ toast `Editor role can't reject — admin or reviewer required` | `{RUN} was already handled by {who} — nothing overwritten` |
| Publish All (gate 2) | ✓ | ✓ | ✕ toast `Editor role can't publish — admin or reviewer required` | `{RUN} was already published by {who} — nothing overwritten` |

Conflicts come from the server as **409** (guarded `UPDATE … WHERE status = expected`); the client renders the toast — never a silent overwrite. Success actions: **Approve** ⇒ stage 05 done, deploy starts; **Revision** ⇒ `revisions+1`, stages 03–05 reset, back to generation, audit `Revision requested — "{note}" · looping back to generation`; **Remake** ⇒ `remakes+1`, draft discarded, audit `Remake requested — draft discarded, regenerating article from scratch`; **Reject** ⇒ terminal `rejected`, stage 05 `rejected` with note `Draft rejected at content gate by {who} — run discarded, nothing published`, audit `Draft rejected — run discarded, no content published or distributed`. Rejection posts **no** Karbon failure note.

### 8.3 Orchestrator page (`02 Orchestrator`)

Layout: grid `minmax(0,1fr) 340px`; then a 2-col row; then a full-width card.

**Master research prompt card** (left):
- Header `Master research prompt` + transient green `saved ✓` on edits. Body: `Extracts one underserved pain point per run — sent to the ChatGPT Business API, must return strict JSON.`
- **Preset row**: label `pain point preset`, `<select>` of presets (custom ones suffixed ` · custom`), `+ New preset` toggle button (label flips to `Close`).
- **New-preset form** (collapsible, bg `--bg4`): header `New pain point preset — saved into the dropdown`; inputs `Preset name (e.g. Dental practices)`, `Region (optional)`, `Target pain point — the underserved group to research`, `Audience (optional)`; `Save to dropdown` (green) + `Cancel`; inline msg `Added "{label}" and made it active.` (green) or validation `Preset name and target pain point are both required.` / `A preset with that name already exists.` (amber). Saving makes it the active preset.
- **Two dropdown+input pairs**: `Target pain point` and `Audience` — select of known values, plus free-text input `…or write a new pain point` / `…or write a new audience` with a `Save`/`Saved ✓` chip button (green when the typed value is new).
- Label `Prompt sent to ChatGPT` + transient `saved ✓ · applies to next run`; 12-row mono textarea with the prompt; buttons `Rebuild from pain point + audience` and `Copy prompt` (`Copied ✓` for 2s).
- **Prompt template** (verbatim, `{niche}`/`{audience}` interpolated):

```
ROLE: You are a market researcher for a financial advisory firm serving businesses with under-served pain points.

TARGET PAIN POINT: {niche}
AUDIENCE: {audience}

TASK: Scan recent local news, community forums and industry reports. Extract ONE concrete, underserved pain point this audience faces around money, tax, compliance or growth.

RETURN STRICT JSON: { "pain_point": "...", "source_insight": "..." }

RULES: The pain point must be specific enough to anchor a 1000+ word blog post and a lead magnet. No generic advice. Do NOT repeat any pain point already in the research registry — Levenshtein similarity > 0.7 counts as a duplicate; fetch another.
```

- **Built-in presets** (locked, `built-in` tag): `hs` — label `Health & Safety (UK)`, niche `UK health & safety advisory & consultancy firms`, audience `Owner-managers of H&S consultancies, aged 35–60`, region `United Kingdom`. `yyc` — label `Calgary small business (28–65)`, niche `Calgary-based small business owners`, audience `Small business owners aged 28–65`, region `Calgary, AB`. Each preset carries a topic pool the runner cycles through (see prototype `TOPICS` / `TOPICS_YYC` for the 4+4 seeded topics/clients/keywords/pain points).

**Automatic runner card** (right): `Bi-weekly scheduler` toggle — on: sub `Every 2 weeks · next: Mon 08:00`, note `Auto-runner posts a signed webhook on schedule — runs start with no manual trigger, gated by max concurrency.`; off: `Paused` / `Auto-runner paused. Use "Run pipeline now" or the header's Simulate Karbon trigger.` Code chip `POST /api/webhooks/karbon · signed HMAC-SHA256 · idempotency-keyed`. Green **`Run pipeline now`** (same fan-out as Simulate). Footnote `Each trigger queues exactly 3 content sets (blog + lead magnet + distribution payloads).` Scheduler-fired toast: `Auto-runner fired {RUN} — scheduled webhook, no manual trigger`.

**Pipeline order card**: `Research (pain point) → Generate → Uniqueness Registry → Auto-SEO loop → Ready for Accountant Revi (violet) → Deploy → Distribution review → Publish`.

**Extracted pain points · research registry card**: note `Levenshtein guard rejects anything > 0.7 similar to prior research.`; feed rows (latest 8 pain-point registry entries): text; status `unique — saved` (green) / `duplicate — skipped` (red); meta `Levenshtein {n}` (red ≥ 0.7) · run id · time; `source: {insight}`.

**Form capture → ActiveCampaign card**: note `Lead-magnet forms map to contact-level custom fields only — never deal or work-item fields.`; lead rows: name + email + `synced ✓` (green) / `syncing…` (amber); chips `cf_pain_point: {…}` + `cf_lead_source: {meta_ads|organic_social|email}` + time. Footer `After capture, a 3-email nurture sequence is drafted (GPT-4o) and saved as ActiveCampaign drafts.`

**Pain point presets card** (full width): header + `{n} presets`; body `Each preset bundles a target pain point, audience and region and drives the auto-runner's topic pool. Pick one from the dropdown above; built-in presets are locked, custom ones can be deleted.`; rows: label + green `active` pill + sub `{niche} · {audience} · {region}`; custom rows get a red-text `Delete` button; built-ins a `built-in` tag. Footer: `Add a new preset with + New preset beside the dropdown at the top of this page — it saves straight into the dropdown and becomes the active preset.`

### 8.4 Archive page (`04 Archive`)

**Final review gateway card** (top): violet mono label `Final review gateway` + violet pill `Ready for Accountant Revi`; right: auto-approve toggle mirroring Settings (label `Auto-approve & distribute` / `Manual review (default)`; note `Auto-approve ON — content scoring ≥ {th} clears this gate automatically. The distribution gate always needs a human.` / `Manual review ON — every item waits for a human. Toggle to auto-approve above the SEO threshold.`).
- Empty: `No items in "Ready for Accountant Revi" — nothing awaiting accountant sign-off.`
- Else: `Select all`/`Clear all` ghost + green `Manual Approve selected` / `Manual Approve ({n})` + caption `Bulk or individual — every approval is logged with your user id.`; rows: 19px checkbox (green when checked), draft title, `{RUN} · {client} · {passed SEO on first pass | passed after n auto-SEO loop(s)}`, score, waited time, buttons `Remake` (ghost) / `Reject` (red ghost) / `Approve` (green outline, fills on hover). Bulk toast: `{n} item(s) approved → deploy queued`. Single approve toast: `{RUN} approved (was "Ready for Accountant Revi") → deploy queued`.

**Filters + search row**: pills `All · Ready for Accountant Revi · Published · In progress · Failed` (active = ink bg, bg2 text); right search input placeholder `Search topic, client, pain point…` (matches topic/client/pain/title). Empty result: `No content matches.`

**Cards grid** `repeat(auto-fill, minmax(340px,1fr))`: run id + status pill (review runs show `Ready for Accountant Revi` as label); draft title; client; pain point (left-border quote); `SEO {n}/100` (colored) · `{1,342} words` (or `not generated`) · updated; channels line (`LinkedIn ✓ · Facebook ✓ · Instagram ✕` or `blog · LinkedIn · FB · IG · magnet` or `—`). Click ⇒ audit modal.

### 8.5 Lead magnets page (`05 Lead magnets`)

Stats (3-col): `Lead magnets` (amber; `PDF resources generated`) · `Live on site` (green; `downloadable at elementaccounting.ca`) · `Leads captured` (violet; `name + email → ActiveCampaign`). Filter pills `All · Live · Pending · Failed`; right caption `delivered as a PDF on sign-up · name + email → ActiveCampaign`. Empty: `No lead magnets match.`

Cards (vertical stack): `PDF` tag; magnet short name + status pill `Live` (green) / `Pending deploy` (amber) / `Deploy failed` (red); `{RUN} · {client}`; pain-point quote; `{n} lead(s) captured` (violet) + URL (green when live, else `— URL assigned at deploy`); buttons `Preview PDF`/`Hide preview` + `Run log` (⇒ audit modal). Preview expands the same PDF sheet as §7.3 with header `lead-magnet.pdf · by ChatGPT Business API · 38 KB` and footer `delivered as a downloadable PDF on sign-up`.

**Checklist content sets** (magnet preview items pick by magnet-name match): `R&D Relief`, `Retainer Pricing`, `Financial Health` — use the 5-item lists verbatim from the prototype (`magnetItems()`), numbered `01…05`.

### 8.6 Registry page (`06 Registry`)

Stats (4-col): `Registered assets` (ink) · `Unique · saved` (green) · `Regenerated` (amber) · `Duplicates blocked` (red). Caption `enforce: SHA-256 + TF-IDF cosine ≥ 0.82` + filter pills `All · Blog · Social · Magnets · Pain points · Blocked`.

Table (min 840px; grid `92px minmax(220px,1fr) 156px 156px 128px 74px`): `Type · Asset · SHA-256 · Similarity · Status · Run`. Type colors: blog green, magnet amber, painpoint cyan, social platforms violet. Hash rendered `sha256:{12 hex}…`. Similarity: `TF-IDF cosine {n}` for assets, `Levenshtein {n}` for pain points (red when ≥ 0.82 / ≥ 0.7). Status pills: `unique` (green) / `regenerated` (amber) / `duplicate — blocked` (red). Empty filter: `No assets of this type yet.` Footer: `Every asset is fingerprinted before finalisation. Exact matches (SHA-256) and fuzzy near-duplicates (TF-IDF cosine ≥ 0.82) are rejected and regenerated automatically — no repeat content is ever permitted.`

### 8.7 Connections page (`07 Connections`)

Grid `repeat(auto-fill, minmax(310px,1fr))`. Card: 33px glyph tile (custom bg/fg per provider), name + `{category} · {phase}`, status pill `Connected` (green) / `Sandbox` (amber) / `Action needed` (red); masked credential in mono box; scope pills; footer `Verified {…}` + `Test` ghost button. **Test behavior**: button shows `pinging…` then `✓ 200 OK · {180–580}ms` for ~2.7s.

Seed the 9 providers verbatim (glyph / tile colors / name / category / phase / cred / scopes / verified):
1. `KB` `#1E3A5F`/`#BFD6EE` — Karbon — `Trigger source · Phase 3 live` — `whk_secret ••••••••9d41` — `work-item webhooks, timeline:write, HMAC + idempotency` — `Verified 2m ago · HMAC-SHA256`
2. `AI` `#15181B`/`#E9E7E1` — ChatGPT Business API — `Content + distribution · GPT-4o · Phase 1` — `sk-proj ••••••••7f2a · gpt-4o · org-verified` — `chat.completions, research + generation, distribution copy` — `Verified 2m ago · 412ms`
3. `WS` `#3A5F1E`/`#D6EEBF` — Web Search / News — `Research source · Phase 2` — `serp ••••••••2c7a · 1k/day` — `news, local business` — `Verified 5m ago`
4. `WP` `#1F4E5F`/`#CDE8F0` — WordPress — `CMS · PublisherAdapter · Phase 1` — `elementaccounting.ca · app-pw ••••x2m8` — `posts:write, media:write` — `Verified 8m ago`
5. `MM` `#2547A8`/`#CBD8F7` — Meta Marketing — `Ads · AdPlatform · Phase 3` — **Sandbox** — `EAAG ••••••••kt3B · act_884012` — `ads_management, pages_read_engagement, instagram_basic` — `Sandbox account · app review pending`
6. `AC` `#265B8F`/`#CFE2F5` — ActiveCampaign — `Email · EmailProvider · Phase 2` — `elementaccounting.api-us1.com · key ••••41aa` — `contacts, campaigns, forms` — `Verified 12m ago · list: Subscribers (1,842)`
7. `LI` `#0A4D77`/`#C6E2F2` — LinkedIn — `Social · SocialPublisher · Phase 2` — `org: Element Accounting · tok ••••8c02` — `w_organization_social` — `Verified 1h ago`
8. `FB` `#1B4C8C`/`#CBDDF5` — Facebook Page — `Social · SocialPublisher · Phase 2` — `page: Element Accounting · tok ••••m41q` — `pages_manage_posts` — `Verified 1h ago`
9. `IG` `#7A2E5C`/`#F2CFE4` — Instagram — `Social · SocialPublisher · Phase 2` — **Action needed** — `ig-business: @elementaccounting · tok expired` — `instagram_content_publish` — `Token expired 2d ago — publishes fail non-blocking`

**Instagram reconnect flow**: red `Reconnect` button (only while broken) ⇒ status becomes `Connected`, cred `ig-business: @elementaccounting · tok ••••fresh`, verified `Reconnected just now`, toast `Instagram token refreshed — future runs post 3/3`; subsequent runs post `Instagram ✓` (stage no longer partial).

Page footer: `All tokens are AES-256-GCM encrypted at rest with a master key from the environment — never stored in plaintext. Instagram's expired token demonstrates the non-blocking failure path: social publishing continues on LinkedIn + Facebook and flags IG for reconnection.`

### 8.8 Settings page (`08 Settings`)

Two-column grid (max 980px). **Left column:**

**Workflow gates card**: `SEO auto-approve threshold` + big green number; range slider 50–100 step 1 (accent green) with `50`/`100` endpoints. Divider. `Auto-approve above threshold` + toggle (38×22 pill, 16px white knob, knob left 3px→19px, green track when on); note switches: on ⇒ `On — runs scoring ≥ {th} skip the content gate (logged as auto-approved). Distribution review still requires a human.` (amber), off ⇒ `Off — every draft pauses for human review regardless of score. Distribution payloads always need a human.` Divider. `Max concurrent workflows` (`BullMQ worker concurrency per queue`) with `–`/`+` steppers, clamp 1–10, default 3. Divider. `Retry policy` code box: `3 attempts · backoff 2s → 4s → 8s · terminal failure posts "Workflow Failed" to Karbon timeline`. Divider. `Queue rate limits` (`BullMQ limiters on strict APIs — prevents HTTP 429`) code box: `meta-ads · 10 req / 10s  ·  activecampaign · 5 req / s`.

**Global brand voice card**: caption `Injected into every generation request — sent to the ChatGPT Business API generation call and prepended to the GPT-4o system prompt for distribution copy.`; 5-row textarea; footer `{n} chars` + transient green `saved ✓ · applies to next run`. **Default value** (seed):
`Write for owner-managers of health & safety businesses. Lead with financial mechanics — figures, thresholds, deadlines. Plain UK English. No hype, no filler, no exclamation marks. Every paragraph must help the reader price, plan or claim something; cut anything that does not.`
Below divider — `UTM enforcement`: `Adapters append channel parameters to every outbound link at publish — manual edits can't strip them.` + code box:
`meta_ads · paid_social` / `activecampaign · email` / `linkedin | facebook · organic_social` / `utm_campaign = run slug — all channels`.

**Right column:**

**Karbon trigger card**: `Webhook endpoint` code box `POST /api/webhooks/karbon` + `Copy` button (copies the full public URL, e.g. `https://propago.up.railway.app/api/webhooks/karbon`; label `Copied ✓` 2s); caption `HMAC middleware verifies signature before body parse · binds 0.0.0.0:$PORT on Railway`. `HMAC signing secret (SHA-256)`: masked `whk_ ••••••••••••` with `Reveal`/`Hide` (demo reveal `whk_4f2c9a81d7e35b60`). `Idempotency` box: `Redis SETNX idem:{workItemId}:{stageId} · TTL 24h — duplicate deliveries ignored`. `Trigger stage` box: `Work item → "Marketing Content — Ready"`. Amber note: `Live webhook is Phase 3 — until then, use "Simulate Karbon trigger" which posts an identical signed payload.` + `Each delivery fans out to exactly 3 content sets (blog + lead magnet + distribution payloads) — one WorkflowRun per set.`

**Active adapters card**: 3 toggle rows — `Meta Ads` (`Phase 3` amber pill; `Lead-gen campaign per post · sandbox until review · limiter 10 req/10s`), `ActiveCampaign email` (`Phase 2` violet; `Campaign to subscribers + ad leads · limiter 5 req/s`), `Organic social` (`Phase 2` violet; `LinkedIn · Facebook · Instagram announcements`); state text `active` (green) / `skipped` (`--tx4`). Footer: `Disabled adapters are skipped by the saga — downstream stages still run. WordPress is the active CMS adapter; Ghost + Webflow ship later via the same PublisherAdapter interface.`

**Team & access card**: header + green `invite-only` pill; note `Only invited accounts can sign in — there is no open sign-up.` + (admin) `As an admin you can invite teammates below; new accounts default to editor.` / (other) `Ask an admin to invite new teammates.`; member rows (28px initials circle on `--bg5`, name, email mono, role pill: admin green / reviewer violet / editor amber). **Admin-only invite form**: First/Last name, email placeholder `name@elementaccounting.ca`, role select — options verbatim `Editor — draft only, can't approve/publish` / `Reviewer — approve content + distribution` / `Admin — full access` — + green `Invite`. Messages: `Invited {first} as {role} — they can now sign in (any password).` (green; production: `— they can sign in once they set a password`, see §12) / `First name and email are required.` / `Enter a valid email address.` / `That email is already on the team.` (amber).

---

## 9. Modals

Both: fixed overlay `rgba(12,11,9,.46–.5)`, centered, backdrop click closes, inner click doesn't, `✕` ghost close button 28px.

### 9.1 Audit-trail / job-log modal (opened by clicking any run row, archive card, or `Run log`)

780px × max 86vh. Header: run id (mono 13 w600) + karbon id + status pill + right label `audit trail · bullmq jobs`.

Body — **12 job cards** (one per stage): number, status dot, stage label w600, queue name (§2 table), right job id `jb_{run#}_{stage#}` (e.g. `jb_1040_03`), status badge (88px). Meta row (mono 10px, indented 27px): `start {HH:MM:SS}` · `end {HH:MM:SS}|running|—` · duration (`queued` when pending, `<1s` floor) · `{n} attempt(s)`. **Error block** when the job failed/partial: red-tinted mono box (`--redT` bg, `--redL` border, pre-wrap) showing the **verbatim HTTP error body** — seed examples:

WordPress 502 (WF-1039 deploy):
```
POST https://elementaccounting.ca/wp-json/wp/v2/posts → HTTP 502 Bad Gateway
{"code":"http_502","message":"upstream timed out (edge-cache)","request_id":"wp_7f31c2"}
attempt 1 → 502 · attempt 2 (+2s) → 502 · attempt 3 (+4s) → 502 — retries exhausted · parked · "Workflow Failed" → Karbon timeline
```
Instagram OAuth 190 (WF-1038 social):
```
POST graph.facebook.com/v19.0/17845/media_publish → HTTP 400
{"error":{"type":"OAuthException","code":190,"message":"Error validating access token: session has expired"}}
non-blocking — LinkedIn ✓ Facebook ✓ · reconnect Instagram in Connections
```
Note block (plain 11px) when the job has a note.

Below jobs: `Audit log` label + full audit list (same row format as §6). Footer: left `Timestamps from BullMQ job lifecycle events · error bodies verbatim from adapter responses`, right green **`Open full run →`** ⇒ Run detail page.

### 9.2 Content preview modal (`Preview whole blog + lead magnet →`)

880px × max 88vh. Header: `{RUN} · {KB}` + pill `Published` (green) when the blog URL exists / `Draft — not yet live` (violet); when live, right link `↗ {blogUrl}` (green mono, opens in new tab). Tabs: `Full blog post` / `Lead magnet PDF`.

**Full blog post tab** renders the post inside a 1:1 mock of the **Element Accounting website theme** (700px sheet, white border/shadow). This is also the exact spec for `services/blogHtml.ts` + the WP theme (README rule 12):
- **Header bar** (white): Element logo (`design/assets/element-logo.png`, 30px tall); nav Arial 11px `#597363`: `What We Do · Packages · About · Blog (bold) · Resources`; copper button `#BC7C54`, white Arial 9.5px bold ls .05em: `LET'S WORK TOGETHER`.
- **Hero**: gradient `linear-gradient(158deg, #79836F 0%, #5A6350 55%, #454E3D 100%)` (placeholder — production uses the featured image; prototype stamps mono 7.5px note `FEATURED IMAGE — SET FROM MEDIA LIBRARY AT DEPLOY`); title Arial 31px bold white with soft text-shadow; meta line Arial 11px bold white: `In {Category} • {Month D, YYYY} • {N} Minutes` (Category = first keyword title-cased; Minutes = words/250, min 1).
- **Body** on greige `#E1DBD6`, padding 36px 48px: intro paragraphs Arial 13px, line-height 1.85, color `#3F3A3B`, justified; section headings Arial 21px bold `#597363` (ending in the prototype's copy style); section content as disc-bullet rows (bullet + justified paragraph).
- **Footer CTA band** `#3C4C3C`: `We'd love to start a conversation with you!` (Arial 20 bold white, max-width 240px); copper `CONTACT US` button; three columns `Quick Links` (What We Do/Packages/About/Blog) / `Our Services` (Bookkeeping/Payroll/Year-End & Tax/Advisory) / `Get In Touch` (info@elementaccounting.ca / elementaccounting.ca) — white 11px bold headers, `rgba(255,255,255,.72)` 10.5px links; copyright `© 2026 Element Accounting` at `rgba(255,255,255,.45)`.
- Below the sheet: `SEO meta description` label + quoted meta; keyword chips + `{1,264 words} · theme preview — deploys to elementaccounting.ca/blog`.

**Lead magnet PDF tab**: caption row `PDF` tag + `lead-magnet.pdf · delivered on sign-up` + URL (green when live); white sheet: eyebrow `Element Accounting · client resource`, magnet title (Space Grotesk 20 w700), 5 numbered items, footer `Delivered as a downloadable PDF the moment someone submits the sign-up form — the name and email flow straight to ActiveCampaign.`

---

## 10. Toast catalog (verbatim)

- Simulate/Run now: `Webhook received · HMAC ✓ → 3 content sets queued (WF-… · WF-… · WF-…) — one WorkflowRun per set`
- Duplicate delivery (double-fire): `Duplicate delivery → idem:{KB-…}:mkt-ready already set · batch NOT re-triggered`
- Scheduler: `Auto-runner fired {RUN} — scheduled webhook, no manual trigger`
- Dist payloads ready: `{RUN} distribution payloads ready for review`
- Approve: `{RUN} approved by {handle} → deploy queued` · Archive approve: `{RUN} approved (was "Ready for Accountant Revi") → deploy queued` · Bulk: `{n} item(s) approved → deploy queued`
- Revision: `{RUN} → revision loop · regenerating draft` · Remake: `{RUN} → draft discarded · regenerating from scratch` (archive variant `{RUN} sent back — regenerating from scratch`) · Reject: `{RUN} rejected by {handle} — run discarded`
- Publish: `{RUN} → publish jobs enqueued (meta-ads · activecampaign · social)`
- Role blocks + conflicts: see §8.2 table
- Teammate action (live update): `d.okafor approved {RUN} from the review queue — moved to deploy`
- IG fix: `Instagram token refreshed — future runs post 3/3`
- Sign-in: `Signed in as {handle} · role: {role} · session active`

---

## 11. Theming (rule 9 parity)

- Header toggle switches light/dark; persisted (`localStorage['nf-theme'] = 'light'|'dark'`); default light; apply by setting every §1 token on `document.documentElement`. Re-applies on load before first paint (no flash). All components read only `var(--*)` — no hardcoded theme colors outside the token sheet, the sidebar, the toast, and the blog/social brand hexes listed above.

## 12. Prototype simulation → production translation

| Prototype behavior | Production behavior |
|---|---|
| Timer-driven stage progression (`tick()` every 900ms, per-stage `dur`) | Real BullMQ jobs; dashboard reflects truth via polling (~2s on active views) or SSE/WebSocket. Pipeline strips/pills/notes update live without reload. |
| All state in component memory + localStorage | Postgres + Redis (schema.sql). localStorage keeps ONLY: theme, JWT/session token. Brand voice, threshold, auto-approve, concurrency, adapter toggles, presets, pain points, audiences, master prompt, scheduler state → `app_settings` / new tables via API. |
| Any password accepted | bcrypt verify; JWT + Redis session; invited users get a temporary password set by admin (return it once in the invite response) or a set-password flow. Roles enforced server-side (403) AND mirrored client-side (§8.2 toasts). |
| `d.okafor` auto-reviews odd-numbered runs (peer banner after ~7s, approval after ~22s) | Real concurrency: "being viewed by X" from presence (Redis key per open reviewer, TTL ~30s heartbeat); approvals by other users arrive via polling and surface the same toast; 409 on stale actions. The demo teammate loop itself is **not** shipped. |
| Random SEO scores, canned drafts/dist payloads, `hash8()` fake hashes | Real scorer (§8.1 formula + suggestion strings), real OpenAI outputs, real SHA-256 hex (show first 12 chars + `…`), real TF-IDF cosine & Levenshtein values. |
| Simulate button spawns runs client-side | `Simulate Karbon trigger` / `Run pipeline now` call a real endpoint (`POST /api/simulate-trigger`, admin/reviewer) that signs a synthetic payload with `KARBON_WEBHOOK_SECRET` and POSTs it to the live webhook — full HMAC + idempotency path exercised. Double-click within the idempotency window must produce the duplicate toast (server returns `{duplicate:true}`). |
| Deploy 502 / IG 190 seeded failures | Keep as **DB seed data** (§13) so the dashboard demos identically on first boot; real failures produce the same UI through `job.failed` events persisting verbatim response bodies. |
| Bi-weekly scheduler = 55-tick timer | BullMQ repeatable job (`every 2 weeks`, next-run shown from the repeatable job's `next` timestamp), gated by max-concurrency setting. |
| `Test` button fake ping | Real adapter health-check endpoint per provider (HEAD/GET cheap call), same `pinging… → ✓ 200 OK · {n}ms` UI. |
| IG `Reconnect` flips a flag | Launches the real OAuth reconnect (Phase 2+); in stub mode, updates the stored credential + status identically to the prototype. |

## 13. Backend deltas required for parity (beyond current `src/`)

The bundle's Express/BullMQ skeleton already covers auth, webhook (HMAC + idempotency + 3-run fan-out), gates, settings, magnets. To reach full prototype parity, ADD:

1. **Research step** — a distinct BullMQ job (queue `content-pipeline`) running inside the `generating` DB status, between webhook acceptance and draft generation: web search + OpenAI pain-point extraction, Levenshtein(>0.7) guard against `content_registry` pain points, retry-on-duplicate. No `run_status` enum change — the 12 UI stages render from `stage_state` (item 3), not from the enum.
2. **`content_registry` table** — `id, workflow_run_id, asset_type ('blog'|'linkedin'|'facebook'|'instagram'|'magnet'|'painpoint'), title, sha256, tfidf_cosine NUMERIC NULL, levenshtein NUMERIC NULL, status ('unique'|'regenerated'|'duplicate-blocked'), method, created_at`. Enforcement in the generation worker: SHA-256 exact match OR cosine ≥ 0.82 ⇒ block + regenerate. Endpoints: `GET /api/registry?type=&status=` + stats.
3. **`stage_state` JSONB on `workflow_runs`** — the 12-element array `{status, attempts, ms, note, err, startedAt, endedAt}` powering strips, stage lists and the job modal exactly as specced. Update it from worker lifecycle events in the same transaction as audit writes.
4. **Presets / pain points / audiences / master prompt / scheduler** — store in `app_settings` (keys: `presets` JSONB incl. the two built-ins flagged `builtin:true`, `active_preset`, `custom_pain_points`, `custom_audiences`, `master_prompt`, `scheduler_enabled`) + CRUD under `PUT /api/settings/:key`; deletes of built-ins rejected.
5. **`captured_leads` table** (+ `GET /api/leads`, `POST /api/leads` public form endpoint) — name, email, magnet_id, cf_pain_point, cf_lead_source, synced flag, timestamps; sync worker pushes to ActiveCampaign **contact-level custom fields only**.
6. **Team invites** — `POST /api/users` (admin) with role enum; duplicate-email 409; list `GET /api/users`.
7. **Run list/detail payloads** must include everything §5–§6 render: karbon ids, topic, client, tone, keywords[], pain_point, source_insight, seo breakdown + suggestions + applied-on-loop list, seo_loop count, revisions, remakes, draft (title/meta/magnet/words), dist payloads + originals + per-channel edited flags, artifacts (6 fields), stage_state, audit rows (`who` = handle | `api` | `system`).
8. **Retry endpoint** — `POST /api/runs/:id/retry` (failed runs; re-enqueues the failed stage job, increments attempts, logs `Manual retry — {stage} attempt {n}`).
9. **Simulate endpoint** — §12. **Health checks** — `GET /api/connections` + `POST /api/connections/:id/test` + `POST /api/connections/:id/reconnect`.
10. **Frontend routes** (React Router): `/login`, `/runs`, `/runs/:id`, `/orchestrator`, `/review`, `/archive`, `/magnets`, `/registry`, `/connections`, `/settings` — sidebar per §3.1; guard all but `/login` behind AuthContext.
11. **Demo seed script** (`npm run db:seed-demo`) reproducing the prototype's four showcase runs so the first boot looks like the prototype: WF-1038 (complete, partial social + IG 190 error + full artifacts), WF-1039 (failed deploy, 502 error body, Karbon "Workflow Failed" note), WF-1040 (in review, SEO 84: kw 78/read 88/head 92/meta 71, 3 suggestions, 1 auto-SEO loop, draft "Financial Planning for Health & Safety Consultancies: The 2026 Guide"), WF-1041 (running at Generate) — plus the registry rows, 4 captured leads, and connection statuses (IG expired) from the prototype's seed functions. Karbon ids KB-2208/09/11/14; new simulated runs number upward from WF-1042/KB-2215.

## 14. Ship checklist (verify before handing back)

1. `docker compose up` → login as each seeded role → all 10 routes render with light AND dark themes, zero console errors.
2. Simulate trigger ⇒ exactly 3 new runs appear at top, toast correct; immediate second click ⇒ duplicate toast, still 3 runs.
3. A run flows: research → generate (watch registry gain 5 unique rows) → SEO (force a low score to see the auto-loop, max 3) → review gate. Approve as reviewer ⇒ deploy ⇒ dist gen ⇒ dist gate. Edit ad headline past 40 chars ⇒ red counter + `edited` pill + tab dot; Reset restores. Publish All ⇒ ads/email/social/callback complete; UTM params present on every outbound link even after manual edits.
4. Editor account: approve/reject/publish blocked with exact toasts + 403s; edit/remake succeed and are audit-logged with user id.
5. Two browsers on one review item ⇒ peer banner; approving in A then B ⇒ B gets the 409 conflict toast.
6. Kill WordPress creds ⇒ deploy fails 3× with backoff, run parks `failed`, `Retry now` shown, Karbon timeline note recorded (stub logs in Phase 1), audit shows `Automation Issue - Manual …`.
7. Disable an adapter in Settings ⇒ that stage `skipped`, downstream continues. IG expired ⇒ social `partial`, run still completes; Reconnect ⇒ next run 3/3.
8. PPTX/PDF-style print not required; blog preview matches §9.2 including Arial + exact hexes.
9. `npm run build` clean; Railway deploy per README §GitHub → Railway; `/healthz` green with plugins attached.
