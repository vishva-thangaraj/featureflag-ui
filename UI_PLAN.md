# Dashboard UI — plan

> Answering: plan the UI for the feature-flag platform's dashboard — clean, and following established
> UI/UX principles.

## The answer

**It is a console for one job: changing what end users see, safely.** The flags list, showing each
flag's state in one environment, is the home screen. Environments, API keys, members and settings
support it, one click away in a sidebar.

**The environment is the lens, not a column.** A flag is on or off *per environment*, so every flag
screen is read through exactly one environment — chosen in the page header, carried in the URL.
Protected environments (production) look different and ask before they change.

**Friction scales with blast radius.** A change in development is instant and undoable. A change in
production confirms, in a sentence saying what will happen. A delete names what it removes. Deleting
the organization asks you to type its name.

**Every control says what an SDK will do.** The evaluation order — kill switch → deny list → allow
list → rules → rollout — is rendered as plain sentences next to the controls that change it, never as
enum names.

**The look already exists.** The "Instrument" foundations on the design canvas
(https://claude.ai/artifact/QHFhRYd1QMkBpWt2N44ipv) set type, colour, spacing and components. This plan
is the layer above: structure, behaviour, states, copy and accessibility — plus the dark theme the
canvas doesn't have yet.

### How this relates to the other plan

`platform/WEB_CLIENT_PLAN.md` owns the mechanics: the stack (React, Vite, TanStack Query, shadcn/ui),
session handling and the refresh lock, query keys, and S3. This plan owns what the user sees and does.
Where they touch, this one decides the UX and that one decides the implementation.

That plan puts the client in `platform/web/`; this directory is a separate repository. Nothing below
depends on which. What changes is the deploy wiring, and that `schema.d.ts` is generated from a running
backend (`/v3/api-docs` on the `dev`/`docker` profiles) rather than from the same commit.

---

## Part 1 — Principles, and what each one decides here

A principle that doesn't decide anything is decoration. Each row names the decision it forces.

| Principle | Decision it forces |
|---|---|
| **Visibility of system status** (Nielsen 1) | The current environment is in every flag page's header and title. Drafts show an *Unsaved changes* badge and a sticky save bar. Every write that reaches SDKs says *"SDKs pick this up on their next poll"* — the platform doesn't push, so the UI must not imply instant. |
| **Match the real world** (2) | Rules read as sentences: `country` *is one of* `IN, US`. `SEMVER_GTE` is shown as *version at least*. `enabled: true, rolloutPercentage: 0` is shown as *On · 0% → nobody*. Raw enums appear only in the SDK payload view, where they are the point. |
| **User control and freedom** (3) | Reversible changes outside protected environments are instant with a 6-second *Undo*. Targeting edits are drafts you can discard. Leaving a page with a draft asks first. |
| **Consistency and standards** (4) | One primary button per view, top-right of the page header. Red appears only on the confirming step of a destructive action, never on the row. Every list is the same table component with the same empty, loading and error states. |
| **Error prevention** (5) | Forms mirror the backend's validation as you type (key and environment name patterns, rule arity, value types, semver). Operators are filtered by value type, so an invalid pairing can't be built. Flag keys warn *"Can't be changed later"* before creation, not after. |
| **Recognition over recall** (6) | The rule attribute field suggests names already in use (`/rules/attributes`). Environments are picked, never typed. Every identifier has a copy button. |
| **Flexibility and efficiency** (7) | `⌘K` palette for flags, actions and environment switching; `/` focuses search. All view state (environment, search, filter, tab) lives in the URL, so a view can be pasted into an incident channel. |
| **Aesthetic and minimalist design** (8) | Borders, not shadows. Colour only for state. No illustrations in empty states — one sentence and one action. Rare rule options (case sensitivity, negation) sit behind *More*. |
| **Help users recover from errors** (9) | Every `409` has a specific recovery, not a toast (Part 5). A `429` turns the button into a countdown from `Retry-After`. Server errors never discard a draft. |
| **Help and documentation** (10) | The model is explained where it bites: *"All rules must match"* above the rule list, the evaluation order beside the SDK payload, what each role can do inside the invite drawer. |
| **Hick's law** | ≤ 4 environments render as a segmented control (every choice visible, one click); more become a searchable menu. |
| **Fitts's law** | The kill switch has a 44 px hit area on touch, and the whole flag row is a link apart from the switch and its menu. |
| **Progressive disclosure** | The flag page shows status, rollout, rules and overrides on one scroll; the SDK payload is collapsed. The list shows *2 rules · 3 overrides*, not the rules. |
| **Jakob's law** | The shell — org switcher top-left, sidebar nav, user menu bottom-left — is the one people already know from Vercel, Linear and LaunchDarkly. |

---

## Part 2 — Information architecture

### The shell

```
┌────────────────────┬────────────────────────────────────────────────────────────────────┐
│ [A] Acme Robotics ▾│  Flags                        development   staging  [production •]│
│     Free plan      │  8 flags · state in production         [Search flags  /] [New flag]│
│                    ├────────────────────────────────────────────────────────────────────┤
│  Flags             │                                                                    │
│  Environments      │                                                                    │
│  API keys          │                          page content                              │
│  Members           │                                                                    │
│  Settings          │                                                                    │
│                    │                                                                    │
│  SDK docs ↗        │                                                                    │
│  (JD) Jane Doe   ▾ │                                                                    │
│  jane@acme · Owner │                                                                    │
└────────────────────┴────────────────────────────────────────────────────────────────────┘
                                                      • = lock icon: a protected environment
```

- **Sidebar, 240 px.** Five items, ordered by how often they're used: Flags (daily) → Environments,
  API keys (setup) → Members, Settings (rare). A 64 px icon rail from 1024 to 1279 px; a drawer on
  phones.
- **Org switcher at the top.** Lists `GET /tenants` with your role in each, plus *Create
  organization*. Switching is navigation to `/t/:id/flags` — never a `switch-tenant` call
  (WEB_CLIENT_PLAN §4).
- **User menu at the bottom.** Account, theme, sign out.
- **The page header is the same everywhere:** title, one line of context, then the environment
  switcher (flag pages only) and the page's single primary action on the right.

### The environment switcher

- **Only on the flags list and flag detail**, where it changes what you see. On Members or Settings
  it would be a control that does nothing.
- **Segmented for ≤ 4 environments, a searchable menu above that.**
- **Creation order.** The backend has no sort field (Part 11), and teams usually create development →
  staging → production in that order.
- **In the URL as `?env=production`.** The default is the last environment you used in this org
  (`localStorage`), else the first.
- **Protected environments** get a lock icon in the switcher and confirm every change. Until the
  backend has a real setting (Part 11), "protected" is a name match on `/^prod/i`. Environments are
  not colour-coded: an amber or red "production" would compete with the colours that mean warning and
  danger.

### Routes

| Route | Screen | Who sees it |
|---|---|---|
| `/login`, `/register` | Sign in, create account | Signed out |
| `/invitations/accept?token=…` | Accept invitation — path fixed by the email template | Anyone |
| `/orgs` | Org picker — skipped when you belong to exactly one | Signed in |
| `/orgs/new` | Create organization | Signed in |
| `/t/:tenantId/flags?env=&q=&status=` | Flags list (home) | Members |
| `/t/:tenantId/flags/:featureId?env=` | Flag detail | Members |
| `/t/:tenantId/environments` | Environments | Members |
| `/t/:tenantId/api-keys?env=` | API keys | Members |
| `/t/:tenantId/members?tab=invitations` | Members, invitations | Members; the invitations tab is OWNER/ADMIN |
| `/t/:tenantId/settings` | Organization settings | Members; editing is OWNER only |
| `/account` | Your profile, theme | Signed in |

Flag detail takes the environment as `?env=` rather than WEB_CLIENT_PLAN's `/:envName` path segment,
so the switcher sets the same parameter on both flag pages and nothing else in the URL moves.

---

## Part 3 — Screens

Each screen has one job. Under each: the layout, what it shows, what you can do, and the states it has
to handle. *Writers* are OWNER and ADMIN; MEMBER and VIEWER are read-only (they have identical
permissions on the backend today).

### 3.1 Sign in and register

**Job:** get in, in the fewest fields.

- A centred 400 px card: product name, email, password, *Sign in*, a link to *Create an account*. The
  password has a show/hide button. `?next=` is honoured.
- Register: first name, last name *(optional)*, email, password — *"8 to 128 characters"* shown as
  helper text before you type, not as an error after.
- No *Forgot password?* link. There is no reset endpoint yet (Part 11), and a link that leads nowhere
  is worse than none.
- **Errors:** `401` → *"Email or password is incorrect"* at the top of the form, never saying which.
  A suspended account gets its own message. `429` → the button counts down.

### 3.2 Accept invitation

**Job:** turn an email link into a member, on one screen.

`GET /invitations/{token}` first, then:

| State | Screen |
|---|---|
| Pending, no account yet | Registration form, email locked to the invited address; submitting sends it as the body of `POST …/accept` |
| Pending, signed in as the invitee | *Join* button |
| Pending, account exists, signed out | Sign in, then back here |
| Pending, signed in as someone else | *"This invitation is for another address. Sign out to accept it."* |
| Expired, accepted or declined | Says which, and who to ask; no form |

On success the response's `authResponse` is already scoped to the new org: store it and go straight to
`/t/{tenantId}/flags`, with the toast *"You've joined Acme Robotics as Admin."*

Today the lookup returns only `message` and `status`, so the page can't say *what* you're joining. It
is designed for *"Jane invited you to join **Acme Robotics** as **Admin**"*, and falls back to *"You've
been invited to join an organization"* until the backend adds `tenantName`, `role` and `email`
(Part 11).

### 3.3 Organizations

- **0 orgs** (straight after registering) → the create form itself, not an empty list. One field:
  name.
- **1 org** → the picker is skipped.
- **2 or more** → a list: name, plan, your role, last used first.

A new org has **no environments** — creating a tenant makes none. The flags page's first-run
checklist handles that (3.4).

### 3.4 Flags list — the home screen

**Job:** see what's on in this environment, and change it.

```
Flags                                              development   staging   [production •]
8 flags · state in production                                 [Search flags   /]  [New flag]

 All 8    On 5    Off 2    Not set up 1

 FLAG                                  STATUS      ROLLOUT        TARGETING               LAST CHANGE
 ───────────────────────────────────────────────────────────────────────────────────────────────────
 checkout_v2                           [●─] On     25%  ▮▯▯▯      2 rules · 3 overrides   2 hours ago   ⋯
 New checkout flow with saved payme…
 legacy_api_shim                       [●─] On     0% · nobody    Everyone                5 days ago    ⋯
 Compatibility layer for v1 SDK cli…
 dark_mode                             [─○] Off    100%           Everyone                Sep 28        ⋯
 Theme switcher in the account menu
 search_reranker                       Not set up · Set up        —                       —             ⋯
 Vector re-ranking for global search
 ───────────────────────────────────────────────────────────────────────────────────────────────────
 Toggling a flag in production asks for confirmation. Changes reach SDKs on their next poll.
```

**Columns**
- **Flag** — the key in Plex Mono, the description beneath in caption ink, one line, full text on
  hover.
- **Status** — a switch *and* the word On or Off; state is never colour alone. A flag with no row in
  this environment says *Not set up*, with a *Set up* link to its detail page.
- **Rollout** — the percentage and a small bar. Enabled at 0% shows *0% · nobody* in warning ink,
  because it reads as on and serves no one. Muted when the flag is off.
- **Targeting** — *2 rules · 3 overrides*, or *Everyone*.
- **Last change** — relative time from the config's `lastModified`, absolute on hover. Time only: the
  backend doesn't record who (Part 11).
- **⋯** — Open, Copy key, Delete.

**Behaviour**
- **The whole row opens the flag**; the switch and the menu don't.
- **Sorted by key, A–Z.** Sorting by last change would move the row you just toggled out from under
  your cursor. *Last change* is a sortable column, for incident review.
- **Search** matches key and description, filters as you type, and is kept in the URL. The filter
  chips show counts.
- **Toggling** is optimistic. In a non-protected environment it applies at once, with an *Undo* toast;
  in a protected one it confirms first (Part 5). Read-only users see the state as a badge, not a
  disabled switch.
- **Data:** `GET /features` joined with `GET /config?envName=` on `featureKey` — two calls for the
  whole page (WEB_CLIENT_PLAN §6).

**States**
- **No environments yet** → a first-run checklist in place of the table:
  1. Create environments — one button: *Create development, staging and production*
  2. Create your first flag
  3. Turn it on in development
  4. Create an API key
  5. Connect an SDK — a `curl` against `/api/v1/sdk/config`, with a placeholder for the key: it was
     shown once, in step 4, and only its hash is stored

  Each step ticks itself from real data, and the list can be dismissed.
- **No flags** → *"Flags turn features on and off without a deploy."* and *New flag*.
- **No matches** → *"No flags match 'chekout'"* and *Clear search*.
- **Loading** → skeleton rows in the table's shape, shown only after 300 ms.

**Later — compare environments.** A matrix toggle: flags down, environments across, each cell *On 25%*,
*Off* or *—*; a cell opens that flag in that environment. One config call per environment. It answers
"is this on everywhere?" without opening each flag.

### 3.5 Create flag

A dialog — two fields don't deserve a page.

- **Key** — a mono input, checked as you type against `^[a-zA-Z][a-zA-Z0-9_.-]{0,49}$`. Helper:
  *"Used in your code. Letters, digits, _ . or -, starting with a letter. Can't be changed later."*
  Typing `Checkout V2` shows an error that offers *Use `checkout_v2`* as a one-click fix, rather than
  silently rewriting what was typed.
- **Description** — optional, up to 255 characters, with a counter after 200.
- `409` → on the key field: *"A flag with this key already exists"*, linking to it.
- **After creating:** open the flag in the current environment, with the toast *"checkout_v2 created.
  It's off everywhere until you turn it on."*

### 3.6 Flag detail

**Job:** decide exactly who gets this flag in one environment, and see that decision as a sentence.

```
Flags / checkout_v2
checkout_v2 [copy]                                                                        [⋯]
New checkout flow with saved payment methods  [edit]                            Created Sep 3

  development          staging              production •
  On · 100%            On · 50%             On · 25%
                                            ━━━━━━━━━━━━━━━━━━━━
  On for 3 allowed users, and for 25% of users who match both rules. 1 user never gets it.

  Status          [●─] Serving in production
                  Turning this off stops it for everyone, overrides included.

  Rollout         ────────●───────────────────────  [ 25 ] %
                  Of users who match the rules.

  Targeting rules · all must match                                                [Add rule]
                       country      is one of          [IN ×] [US ×]                   ⋯
                  and  appVersion   version at least   [2.4.0]                         ⋯

  User overrides · applied before rules
                  [ user id or email                ]  ( Allow | Deny )  [Add]
                  jane@acme.dev                          Allow                          ×
                  u-9                                    Deny                           ×

  ▸ What SDKs receive

━━ Unsaved changes · rollout 25% → 50% · 1 rule added ━━━━━━━━━━━━━━━ [Discard] [Review and save]
```

**Header.** The key is read-only, with a copy button — the backend can't rename it. The description
edits in place: pencil → input, Enter saves, Esc cancels. ⋯ holds *Delete flag*.

**Environment tabs.** One per environment, each showing its own state, so the cross-environment
picture survives choosing one. Selecting a tab sets `?env=`. Switching with a draft open asks whether
to discard it.

**The effect summary** is the sentence under the tabs, built from the config in SDK precedence order.
It is the most important line on the screen:

| Config | Sentence |
|---|---|
| Off | *Off for everyone in production.* |
| On, 100%, no rules, no overrides | *On for everyone in production.* |
| On, 0% | *On, but at 0% nobody gets it* — plus the allowed users, if there are any |
| On, 25%, 2 rules, 3 allowed, 1 denied | *On for 3 allowed users, and for 25% of users who match both rules. 1 user never gets it.* |
| Not set up | *Not set up in production — SDKs don't receive it. Turn it on or add a rule to start.* |

While a draft is open, the sentence describes the draft and starts *After saving:*.

**What saves when** — three models, chosen so the fast thing is fast and the careful thing is careful:

| Part | Applies | Why |
|---|---|---|
| Status (kill switch) | **At once.** Protected environments confirm | It's the emergency control; a save step would slow the one action that must be quick |
| Rollout and rules | **Draft**, saved together from the bar | Multi-step edits; the rule set is replaced by one atomic `PUT`, and one review covers both |
| Overrides | **At once, per row**; removing one offers *Undo* | Each is an independent upsert, and that's how a list is expected to behave |

The save bar appears only when rollout or rules differ from what's saved, so nobody looks for a Save
button after flipping the switch.

**Saving.** In a non-protected environment the bar's button is *Save*. In a protected one it is
*Review and save*, which opens the diff — *Rollout 25% → 50%; added: country is one of IN, US* — and a
*Save to production* button. Rollout is written first (`enable` with the *current* `enabled`, read
fresh, so a save can't undo someone else's kill switch), then `PUT …/rules`. If the second call
fails, say exactly that — *"Rollout saved. Rules weren't: …"* — and keep the rules draft.

**Concurrent edits.** There's no version number, so remember `lastModified` at load and re-read it
before saving. If it changed: *"Someone changed this flag in production since you opened it"*, with
*Reload* (discards the draft) and *Save anyway*.

**Delete flag.** *"Delete checkout_v2? This removes it and its setup in all 3 environments. SDKs stop
receiving it and fall back to the default in your code."* If it's on in a protected environment, type
the key to confirm.

### 3.7 Targeting rules

**Each rule is one readable row:** attribute → type → operator → value.

- **Attribute** — a combobox fed by `/rules/attributes`; free text is allowed and checked against
  `^[a-zA-Z][a-zA-Z0-9_.]{0,99}$`.
- **Type** — *Text · Number · True/false · Version*. Prefilled when the attribute already appears in a
  rule in the loaded config. It comes before the operator because it decides which operators exist.
- **Operator** — only those valid for the type, in words:

| Type | Operators shown (→ enum) |
|---|---|
| Text | is, is not, is one of, is not one of, contains, starts with, ends with |
| Number | is, is not, is one of, is not one of, greater than, at least, less than, at most (→ `GT` `GTE` `LT` `LTE`) |
| True/false | is, is not |
| Version | is, is not, is one of, is not one of, newer than, at least, older than, at most (→ `SEMVER_*`) |

- **Value** — matches the type: chips for *is one of* (Enter or comma adds one; pasting a list adds
  them all), a single input otherwise, a True/False segmented control for booleans, and a version
  input checked against `^\d+(\.\d+){0,3}([-+].*)?$`.
- **⋯ More** — *Case-sensitive* (Text only; off by default, shown as an `Aa` badge when on), *Negate*
  (a `NOT` badge before the row), *Pause rule* (dimmed, *Paused · not sent to SDKs*), *Delete*.
- **Reading order.** The header says *"All rules must match"*, and every row after the first starts
  with *and*. A drag handle (or Alt+↑/↓) reorders, with the note *"Order is for reading — it doesn't
  change who matches."*
- **No rules** → *"No rules. Everyone in the rollout gets this flag."* and *Add rule*.

**Validation, before the server sees it:**
- **Arity.** Switching *is one of* with three values to *is* says *"'is' takes one value — remove 2,
  or keep 'is one of'"* rather than dropping values.
- **Types and semver**, per value.
- **The contradictions `RuleValidator` rejects with `409`** — `plan is free` and `plan is pro`, both
  enabled — flagged on both rows.

Bean-validation errors arrive as `rules[1].attribute` and land on their row. `RuleValidator`'s own
`400`s and `409`s carry only a message, which goes at the top of the section (Part 11).

### 3.8 User overrides

- **The add row sits at the top of the table:** user id (mono), *Allow / Deny*, *Add*. Enter submits
  and focus returns to the input for the next one.
- **Rows:** the id, an *Allow* (success) or *Deny* (danger) badge — words, not just colour — and ×. A
  row's menu flips it (*Change to deny*). Adding an id that already exists flips it too, and says so:
  *"u-9 was denied — now allowed."*
- **Remove** takes effect at once, with *Undo* for 6 s.
- Search appears past 10 rows; pages of 50 past that.
- `externalUserId` is URL-encoded in the `DELETE` path — it's often an email.
- **Bulk:** *Import CSV* (WEB_CLIENT_PLAN Part 3 B). Each single add is one rate-limited write, at
  20 a minute.

### 3.9 What SDKs receive

Collapsed by default. It opens to:

1. **The evaluation order** with this flag's values filled in: *1 · Kill switch — on · 2 · Deny list —
   1 user · 3 · Allow list — 3 users · 4 · Rules — 2, all must match · 5 · Rollout — 25%*.
2. **The saved JSON** from `GET /config/{key}?envName=` — read-only, mono, with a copy button —
   labelled *Saved configuration* so nobody mistakes it for the draft, and noting that paused rules
   aren't sent.

### 3.10 Environments

**Job:** set up and retire the places flags run.

- **Table:** name (mono), description, active API keys, created, ⋯ (*Rename*, *Edit description*,
  *Delete*).
- **New environment** — a dialog: name (`^[a-zA-Z][a-zA-Z0-9_.-]{0,49}$`) and description. With none
  yet, the empty state offers *Create development, staging and production* in one click.
- **Rename** warns: *"Anything calling /config?envName=staging needs the new name. SDK keys keep
  working."*
- **Delete with active keys** (`409`) — the dialog doesn't fail, it shows the way through: *"Revoke 2
  API keys first"*, listing the keys with a *Revoke* button each. *Delete* enables once the list is
  empty.
- **Delete** — *"Delete staging? This removes the on/off state, rollout, 14 rules and 37 overrides of
  every flag in staging. The flags themselves stay."* The counts come from that environment's config.
  Protected environments: type the name.

### 3.11 API keys

**Job:** give SDKs a credential, and take it away without an outage.

```
API keys                                                                       [Create key]
SDKs use these to read flags. Each key reads one environment.

 Environment: All ▾      [ ] Show revoked

 NAME          ENVIRONMENT   KEY             LAST USED            EXPIRES    STATUS
 ──────────────────────────────────────────────────────────────────────────────────────────────
 web-prod      production    ffsdk_7fQa…     around 3 min ago     —          Active            ⋯
 ios-prod      production    ffsdk_k2Lm…     around 2 days ago    Nov 4      Expires in 4 days ⋯
 ci-staging    staging       ffsdk_9xTr…     Never                —          Active            ⋯
```

- **Columns:** name, environment, prefix (mono), *Last used* — always *"around…"*, because it is
  written at most every five minutes — expiry, and status (*Active* · *Expires in 4 days* in warning ·
  *Expired* · *Revoked*).
- **Revoked keys are hidden by default.** They're kept for the audit trail, not the working set.
- **Create** — a dialog: name, environment, expiry (*No expiry* · 30 · 90 · 365 days · a date). The
  default is *No expiry*: a key that expires inside a shipped app is an outage, and keys that do expire
  are flagged in the list well before.
- **Key created** — the only time the key is visible:
  - the full key in mono, with *Copy*;
  - a ready-made `curl -H "X-API-Key: …" …/api/v1/sdk/config`;
  - an *"I've stored this key somewhere safe"* checkbox that enables *Done*. Closing without ticking it
    asks *"You won't be able to see this key again. Close anyway?"* — a warning, not a trap.
- **Revoke** — *"Revoke web-prod? Apps using it stop receiving flags on their next request. This can't
  be undone."* → *Revoke key*.
- **Rotate** — a three-step dialog:
  1. *Create the replacement* — same environment, name prefilled.
  2. *Deploy it* — waits for the new key's `lastUsedAt` to appear (*"Seen around 2 minutes ago ✓"*,
     with a note that it can take five).
  3. *Revoke the old key.*

  The usual way to rotate a key is to break something first. This order makes the safe path the
  default one.

### 3.12 Members

Two tabs: **Members (6)** · **Invitations (2)**.

- **Members:** person (name and email; *You* on your own row), role, status, ⋯ *Remove*.
  - **Role** is an inline select for writers, offering only roles up to your own rank
    (`RoleGrantPolicy` — an ADMIN can't make an OWNER). The OWNER's row is locked, with the reason on
    hover.
  - Read-only users see the same table without the controls.
- **Invite** — a side drawer, so the list stays in view: email, then the role as radio cards with one
  line each:
  - **Admin** — *Change flags, environments, API keys and members*
  - **Member** — *View everything, change nothing*
  - **Viewer** — *View everything, change nothing*

  MEMBER and VIEWER do the same thing today, and the copy says so rather than inventing a difference
  (Part 11).
- **Invite `409`** (one is already pending) → inline: *"jo@acme.dev already has a pending
  invitation"*, with *Resend it* and *Cancel it and invite again*.
- **Invitations** (writers only): email, role, invited by, sent, expires, ⋯ *Resend* / *Cancel*. The
  list reports `EXPIRED` for rows still stored as pending — show them, and lead with *Resend*. Resend
  confirms: *"A new link will be sent. The previous one stops working."*

### 3.13 Settings

- **General:** the name (OWNER edits it; everyone else sees text), the plan as a read-only badge, and
  the organization id with a copy button, for support and scripts.
- **Logo** — WEB_CLIENT_PLAN Part 3 A.
- **Danger zone** (OWNER only; hidden from everyone else): *Delete organization*. The dialog lists
  what goes, with live counts — *8 flags, 3 environments, 5 API keys (SDKs using them stop
  immediately), 6 members, 2 pending invitations* — says *"This can't be undone"*, and enables the
  button only once the org's name is typed. Afterwards: `/orgs`.

### 3.14 Account

Name and email (read-only — there's no profile endpoint yet), theme (*System · Light · Dark*), and
*Sign out*.

### 3.15 Command palette

`⌘K` / `Ctrl K`, anywhere inside an org.

- **Flags** — fuzzy match on key and description → open.
- **Actions** — *New flag*, *Create API key*, *Invite member*, *Switch environment ›*, *Switch
  organization ›*.
- **Toggles** — *"Turn off checkout_v2 in production"*. Same confirmation as everywhere else: the
  palette saves navigation, not care.

---

## Part 4 — The journeys that matter, with targets

| Journey | Path | Target |
|---|---|---|
| **Kill a flag in production** | Flags → switch → *Turn off* | 3 interactions, under 10 s from the home screen, **on a phone too** — this is the 2 a.m. case |
| **First run → first SDK read** | Register → name the org → *Create development, staging and production* → new flag → on in development → create key → copy the `curl` | Under 5 minutes, guided by the checklist |
| **Roll out gradually** | Flag → production → rollout 10% → *Review and save* → 25 → 50 → 100 | One drag and one confirm per step; the summary always says who has it |
| **Target a segment** | Flag → *Add rule* → `plan` *is one of* `pro, enterprise` → save → *What SDKs receive* | Built without knowing an enum name |
| **Join a team** | Email link → set a password → land in the org's flags | One screen, no separate sign-in |
| **Rotate a key without an outage** | API keys → ⋯ → *Rotate* → three steps | Nobody revokes before the new key has been seen |
| **Retire an environment that still has keys** | Environments → *Delete* → revoke the listed keys → *Delete* | Never a dead-end error |

These are the scenarios to test first (Part 10): on the canvas prototype before code, in Playwright
after.

---

## Part 5 — Patterns used everywhere

### Page anatomy

Title (24/600) and one line of context; a filter row; the content. Forms and settings cap at 720 px;
tables use the full width inside the 40 px gutter.

### The friction ladder

| Change | Example | Treatment |
|---|---|---|
| Reversible, not protected | Toggle in development; remove an override | Instant, with an *Undo* toast for 6 s |
| Reversible, protected | Toggle or save in production | A confirm dialog whose button is a verb (*Turn off*, *Save to production*), and a sentence saying the effect |
| Irreversible | Delete a flag; revoke a key; remove a member; delete an environment | A confirm dialog naming the object and what goes with it; the button is red |
| Irreversible and wide | Delete the organization; delete a flag or environment that's live in production | As above, and type the name to confirm |

Confirm dialogs never ask *"Are you sure?"* — they say what happens. Focus starts on *Cancel* for
irreversible actions and on the action for reversible ones, so Enter is quick only where a mistake is
cheap.

### Feedback

- **Optimistic where safe.** Switches and override adds change at once and roll back, with an error
  toast, if the call fails.
- **Toasts** confirm finished actions: bottom-right (bottom-centre on phones), 4 s, 6 s when they carry
  *Undo*. Error toasts stay until dismissed. Form errors are never toasts — they go on the form.
- **Buttons in flight** show a spinner, keep their width, and can't be pressed twice.
- **Latency is stated, not hidden:** writes that reach SDKs say *"on their next poll"*.

### Loading

- First load: skeletons shaped like the content, after a 300 ms delay so fast loads don't flash.
- Refetches (window focus, after a mutation) keep showing the current data — no skeleton, no spinner.

### Empty states

One sentence and one action, in three kinds: **first use** (what this is for, and create one), **no
results** (*Clear filters*), and **no permission** (*"Only owners and admins can see invitations"*).

### Errors

| Response | UI |
|---|---|
| `400` with `fieldErrors` | On each field; a `null` field at the top of the form; focus moves to the first |
| `401` | Refresh under the lock and retry once (WEB_CLIENT_PLAN §5); failing that, `/login?next=` |
| `403` on a page | *"You don't have access to this organization"*, with your other orgs |
| `403` on an action | Roles are re-read per request, so yours may have changed mid-session: refetch `/tenants`, re-render, toast *"Your role in Acme Robotics is now Viewer"* |
| `404` | A not-found page that names the thing (*"This flag was deleted or never existed"*), with a way back |
| `409` | The specific recovery: environment delete → the keys to revoke; invite → resend or cancel; rules → both rows; flag key taken → a link to it |
| `429` | The button becomes *"Try again in 6 s"*, counted from `Retry-After`, and re-enables itself |
| `5xx`, offline | An inline banner with *Retry*; drafts are kept |

### Permissions

The server decides; the UI only avoids offering what will fail. Two rules:

- **Hide what your role can never do.** Read-only users don't get a page of disabled buttons. They get
  one quiet line under the title — *"View only. Ask an admin to make changes."* — and switches become
  On/Off badges.
- **Disable, with the reason, what's unavailable right now:** *Delete* on an environment with active
  keys; *Done* before the key is stored.

One helper, `can(tenant, action)`, fed by `GET /tenants` (WEB_CLIENT_PLAN §4).

### Forms

Label above, helper below, and the error replaces the helper. Validate on blur, then on every
keystroke once a field has shown an error. The submit button stays enabled: pressing it shows every
error and focuses the first. Fields are required by default; optional ones say *(optional)*.

### Words

Sentence case everywhere. Buttons are verbs that name the object: *Create flag*, *Revoke key*, *Save
to production*. Name the thing, not its type: *"Delete checkout_v2?"*, not *"Delete this item?"*.

| Instead of | Write |
|---|---|
| Submit | Create flag |
| Are you sure? | Revoke web-prod? Apps using it stop on their next request. |
| Error 409: Conflict | Revoke these 2 keys before deleting staging. |
| SEMVER_GTE | version at least |
| enabled: true, rollout: 0 | On · 0% → nobody |
| Invalid input | Start with a letter; use letters, digits, _ . or - |

### Time and numbers

Relative times (*2 hours ago*) with the absolute time on hover, in the viewer's time zone. Tabular
numerals for every count and percentage. Percentages are whole numbers — the backend takes integers.

### Keyboard

| Key | Does |
|---|---|
| `⌘K` / `Ctrl K` | Command palette |
| `/` | Focus search |
| `g` then `f` `e` `k` `m` `s` | Go to Flags, Environments, API keys, Members, Settings |
| `[` / `]` | Previous / next environment, on flag pages |
| `n` | New flag, on the flags list |
| `⌘S` / `Ctrl S` | Save the draft, on flag detail |
| `Esc` | Close a dialog or drawer; cancel an inline edit |
| `?` | List these |

Single-key shortcuts never fire while typing in an input.

---

## Part 6 — Visual design

### Inherited from the Instrument foundations

| | |
|---|---|
| Type | IBM Plex Sans for the interface; IBM Plex Mono for every identifier — flag keys, ids, API key prefixes, JSON |
| Scale | Page title 24/600 · section 16/600 · label 14/500 · body 14/400 at 1.45 · caption 13 · mono 13/500 |
| Ground | `#F4F4F6` page · `#FFFFFF` surface · `#F7F7F9` code |
| Lines | `#E3E3E8` card · `#EEEEF2` row · `#D4D4DC` control |
| Ink | `#16161A` text · `#4B4B57` secondary · `#6B6B78` caption |
| Accent | `#2E5BE8`, hover `#2449C4` — the only accent: primary actions, links, focus, selection |
| State | Success `#166534` on `#DCFCE7` · warning `#92400E` on `#FEF3C7` · danger `#991B1B` on `#FEE2E2`; danger button `#B91C1C` |
| Spacing | 4 px grid: 4 icon to label · 8 between controls · 12 table cells · 16 list padding · 24 card padding · 40 page gutter |
| Shape | Radii 6 control · 8 chip · 10 card · pill. Controls 36 px (28 dense, 44 touch) |
| Depth | Borders separate; the only shadow is on dialogs and menus, `0 10px 30px rgba(20,20,26,.12)` |

### Added by this plan

**Dark theme.** The same roles with new values. Every text pair is measured at 4.5:1 or better against
its background:

| Role | Light | Dark | Dark contrast |
|---|---|---|---|
| Ground · surface · code | `#F4F4F6` · `#FFFFFF` · `#F7F7F9` | `#0F0F12` · `#17171C` · `#1D1D23` | — |
| Lines: card · row · control | `#E3E3E8` · `#EEEEF2` · `#D4D4DC` | `#2A2A32` · `#24242B` · `#6B6B78` | control 3.4 on surface |
| Text · secondary · caption | `#16161A` · `#4B4B57` · `#6B6B78` | `#EDEDF1` · `#B4B4C0` · `#9A9AA8` | 15.3 · 8.7 · 6.4 on surface |
| Accent text, links | `#2E5BE8` | `#7C9BFF` | 6.8 |
| Primary button | white on `#2E5BE8` | white on `#3D63E0` | 5.2 |
| Success · warning · danger text | as above | `#4ADE80` on `#14261B` · `#FBBF24` on `#2A2010` · `#F87171` on `#2D1515` | 9.1 · 9.6 · 6.2 |
| Danger button | white on `#B91C1C` | white on `#DC2626` | 4.8 |

It follows the system setting; *Account* overrides it. Tokens are CSS variables consumed by the Tailwind
theme, so no component names a hex value. In the dark, depth comes from lighter surfaces rather than
shadows: dialogs and menus sit on `#1D1D23` with a `#3A3A44` border. The primary button darkens to
`#3D63E0` → `#3557C9` on hover (6.3:1 with white).

**Control borders in the light theme.** Instrument's control border `#D4D4DC` (1.5:1 on white) and
off-switch track `#C9C9D2` (1.6:1) are below the 3:1 that WCAG 1.4.11 asks of the parts that identify a
control. Proposed: `#8A8A96` for both — 3.4:1 on white, 3.1:1 on the page ground. Card and row lines
stay as they are; they separate content rather than identify a control.

**Focus.** A 2 px accent outline at a 2 px offset on every focusable element, shown for keyboard focus
(`:focus-visible`) and never removed.

**Motion.** 120 ms for hover and press, 180 ms for dialogs and drawers, ease-out. Nothing moves that
doesn't need to. Under `prefers-reduced-motion`, fades only.

**Icons.** Lucide (it ships with shadcn/ui): 16 px in controls, 20 px in the nav, 1.5 stroke. An
icon-only button always has an `aria-label` and a tooltip with the same text.

**Tables.** Rows are 52 px when they carry a description (the flags list) and 44 px otherwise. Headers
are 13/600 in caption ink and stick on scroll.

---

## Part 7 — Components

shadcn/ui provides the primitives. These are the product components on top, each built once and used
everywhere it appears.

| Component | Built from | Where |
|---|---|---|
| `AppShell`, `Sidebar`, `OrgSwitcher`, `UserMenu` | Sheet, DropdownMenu | Every org page |
| `PageHeader` | — | Every page: title, context line, actions |
| `EnvSwitcher` | ToggleGroup / Command | Flags list, flag detail |
| `DataTable` | TanStack Table | Every list; owns sorting and the empty, loading and error states |
| `FlagSwitch` | Switch | List, detail, palette — owns the optimistic update, the protected confirm and the undo |
| `EffectSummary` | — | Flag detail. A pure function from config to sentence, unit-tested against every row of the table in 3.6 |
| `RolloutControl` | Slider + Input | Flag detail |
| `RuleBuilder`, `RuleRow`, `ValueChipsInput` | Combobox, Select, Badge | Flag detail |
| `OverrideTable` | DataTable | Flag detail |
| `SaveBar` | — | Flag detail drafts |
| `ConfirmDialog`, `TypeToConfirm` | AlertDialog | Every destructive or protected action |
| `KeyRevealDialog`, `RotateKeyDialog` | Dialog | API keys |
| `RoleSelect` | Select | Invite drawer, members table; capped at the caller's rank |
| `CopyButton`, `Mono`, `RelativeTime`, `StatusBadge` | Tooltip, Badge | Everywhere |
| `EmptyState`, `ErrorState`, `Skeleton` | — | Everywhere |
| `CommandPalette` | Command (cmdk) | Global |
| `Toaster` | Sonner | Global, with an *Undo* slot |

---

## Part 8 — Accessibility

The target is **WCAG 2.2 AA**. The parts that are easy to get wrong in this product:

- **Switches have full names.** A flags-list switch is announced as *"checkout_v2 in production, on"*,
  not *"switch, on"*.
- **State never relies on colour.** On/Off, Allow/Deny and Active/Revoked are always words; colour
  reinforces them.
- **The rule builder works by keyboard alone:** comboboxes follow the ARIA pattern, Backspace removes a
  chip, and Alt+↑/↓ reorders rows as well as dragging does.
- **Live regions:** toasts and the save bar's status are announced politely, errors assertively.
- **Dialogs** trap focus, return it to whatever opened them, and close on Esc — except the key-reveal
  dialog before *I've stored it*, which asks first.
- **Targets** are at least 24 px on desktop (WCAG 2.5.8) and 44 px on touch.
- **Contrast** is 4.5:1 for text and 3:1 for control borders and focus rings, in both themes.
- **Reflow** at 320 px and 200% zoom with no horizontal page scroll; wide tables scroll inside their
  own box.
- **Checked in CI:** `@axe-core/playwright` on every route in both themes, and a keyboard-only run of
  the seven journeys in Part 4 before each phase is called done.

---

## Part 9 — Responsive

| Width | Layout |
|---|---|
| ≥ 1280 | Full sidebar; every table column |
| 1024–1279 | The sidebar becomes a 64 px icon rail |
| 768–1023 | Rail; tables move *Targeting* and *Last change* into the row's second line |
| < 768 | A top bar with a menu button; the environment switcher becomes a full-width select; tables become stacked cards; dialogs become bottom sheets; controls are 44 px |

**What the phone is for:** checking state and pulling the kill switch, from a card that shows the key,
the switch, the rollout and the targeting summary. Every screen works on a phone, but the rule builder
is designed for a keyboard and lays out one field per line there, rather than pretending to be
comfortable.

---

## Part 10 — Build order

This follows WEB_CLIENT_PLAN's phases, and says what UI each one ships and how we'll know it's right.

| Phase | UI | Done when |
|---|---|---|
| **1 · Skeleton** | Tokens in both themes, the shell, sign in and register, create and pick an org, `DataTable`, `EmptyState`, `ConfirmDialog`, toasts | A new user lands on the first-run checklist, and axe passes on every route |
| **2 · Flags & environments** | Flags list, create flag, `FlagSwitch` with confirm and undo, flag detail status, rollout and `EffectSummary`, environments | The kill-switch journey takes 3 interactions or fewer, and works at 375 px |
| **3 · Targeting** | `RuleBuilder`, overrides, the save bar and review, the SDK payload panel | In a hallway test, people build *"plan is pro or enterprise, and app version at least 2.4"* unaided, and the payload matches |
| **4 · Team & keys** | API keys with reveal and rotate, members, the invite drawer, invitations, the accept page | Invite → accept → the right org and role, by keyboard alone |
| **5 · Object storage** | Logo upload; CSV import with progress and an error report | A 500-row import shows progress and offers a report of the bad rows |
| **6 · Polish** | Command palette, shortcuts, compare view, a dark-theme review | The seven journeys pass in Playwright, in both themes |

**Before any code:** walk journeys 1–3 on the canvas prototype with three or four people who would use
it, and change the design wherever they hesitate. It is the cheapest point at which to be wrong.

---

## Part 11 — What the UI needs from the backend

None of these block phases 1 and 2. Each row says what the UI does until it lands.

| Gap | Why the UI wants it | Until then |
|---|---|---|
| A **protected** setting on environments | Confirmations and the lock icon should follow a deliberate choice, not a name | Match `/^prod/i` |
| `GET /invitations/{token}` returning `tenantName`, `role` and `email` | The accept page should say what you're joining, and lock the email | Generic copy; the email is typed, and checked by the server |
| **Password reset** | Real users forget | No link on the sign-in page |
| An environment **sort order** | Show the pipeline in order, not in creation order | Creation order |
| **Who** changed a flag, and a change history | *Last change* should say by whom; incidents need a log | Time only. A history needs a Kafka consumer and a store first |
| A **profile** update endpoint | People need to fix a typo in their own name | A read-only account page |
| A real difference between **MEMBER and VIEWER** | Two roles that do the same thing make the invite drawer confusing | The copy says they're the same today |
| `RuleValidator` errors that **name the rule** | Put a `400` or `409` on the row that caused it | Mirror the checks in the browser; show the server's message at the top of the rules section |
| **Live updates** (REALTIME_CONFIG_PLAN) | Two people on one flag should see each other's changes | Refetch on focus, and the `lastModified` check before saving |

`GET /features` isn't paginated either. That's fine into the hundreds; virtualize the table past
about 200 rows.
