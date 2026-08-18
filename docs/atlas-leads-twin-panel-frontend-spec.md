# Frontend Spec: AI Twin panel on the Lead detail (Edit Lead modal)

Status: ready for implementation
Owner: FE dev (Atlas frontend / Engagement Hub)


---

## 1. Summary

Atlas's **Leads** page (Engagement Hub → Leads) already lists and lets agents edit
leads sourced from the AI Twin — no changes needed there. The one thing missing
from the **Edit Lead modal** is the reason an agent opens a twin lead in the
first place: **the conversation the buyer had with the twin, and a ready-to-send
follow-up message.** Both already exist in the API response the modal already
fetches. This spec covers rendering them.

No new endpoints. No new write/mutation calls. No new client-side state beyond
what's needed to render. Everything below is additive — every other lead source
renders exactly as it does today.

## 2. Where this lives

Inside the existing **Edit Lead** modal, as one new section placed **after
"Interest" and before "Lead Status"** (see the modal's current section order:
Lead Details → Lead Source → Interest → Lead Status).

The new section only appears for leads sourced from the AI Twin. For every
other lead source, render nothing — the section simply doesn't exist in the
DOM.

## 3. Data contract

### Endpoint

`GET /api/v1/leads/:id` — the same show endpoint the Edit Lead modal already
calls to populate every other field. No new request, no new round trip.

### When the new keys appear

Two additional top-level keys are present in the response **only when
`source_id == 7`** (`AI_TWIN`). For any other `source_id` these keys are
simply absent from the JSON (not `null`, absent) — treat their absence as the
signal to skip rendering the new section, exactly like an optional field.

```
if (lead.ai_twin_conversation) {
  // render the section
}
```

### Full response shape

```jsonc
{
  // ...all existing Lead fields, unchanged (name, phone, email, budget,
  // purchase_timing, motivation, target_city, current_city, priority,
  // type, status, source, etc.)...

  "ai_twin_conversation": {
    "summary": "Aisha is seeking a 3-bedroom rental in Kota Kinabalu, budget around RM3,000/month, moving in 2 months.",
    "qualified": true,
    "scored_at": "2026-08-17T09:41:00Z",
    "extracted": {
      "budget": "around RM3000",
      "purchase_timing": "move in 2 months",
      "motivation": "relocating for work"
    },
    "session_count": 2,
    "messages": [
      {
        "role": "user",
        "message": "Any 3-bed rentals in KK?",
        "sent_at": "2026-08-15T03:10:00Z",
        "session_id": "sess_a1b2c3"
      },
      {
        "role": "assistant",
        "message": "Yes, I have two options under RM3,000. Could you share:\n\n- **Preferred area**\n- **Move-in date**\n- **No. of occupants**",
        "sent_at": "2026-08-15T03:10:22Z",
        "session_id": "sess_a1b2c3"
      },
      {
        "role": "user",
        "message": "Inanam, moving in 2 months, just me",
        "sent_at": "2026-08-17T09:38:05Z",
        "session_id": "sess_d4e5f6"
      }
    ]
  },

  "ai_twin_nurture": {
    "draft": "Hi Aisha, are you still looking for a 3-bedroom rental in Kota Kinabalu around RM3,000/month? I have a couple of options in Inanam that could work — happy to send details.",
    "drafted_at": "2026-08-18T02:00:00Z",
    "touch_count": 1,
    "whatsapp_url": "https://wa.me/60123456789?text=Hi%20Aisha...",
    "email_url": null
  }
}
```

`ai_twin_nurture` itself can be `null` (present as a key, value `null`) — it
stays `null` until the nightly nurture worker has drafted a follow-up for this
lead (leads younger than 24h, or already contacted, won't have one yet).

### Field reference

**`ai_twin_conversation`** (present only for AI Twin leads; never `null` once present)

| Field | Type | Notes |
|---|---|---|
| `summary` | string | 2–3 sentence AI summary. Also duplicated into the existing `initial_comments` field — this is the same text, don't treat as a second source of truth. |
| `qualified` | boolean | AI's qualification verdict at scoring time. |
| `scored_at` | ISO 8601 string | When the verdict was produced. |
| `extracted.budget` | string | May be `""`. |
| `extracted.purchase_timing` | string | May be `""`. |
| `extracted.motivation` | string | May be `""`. |
| `session_count` | integer, ≥ 1 | Number of distinct chat sessions this buyer has had with this agent. `1` = first-time visitor, `>1` = the buyer came back. |
| `messages` | array | Chronological, oldest first. Internal system/context text is already stripped server-side — every `message` string is buyer-safe to render as-is. |
| `messages[].role` | `"user"` \| `"assistant"` | `"user"` = the buyer, `"assistant"` = the twin. |
| `messages[].message` | string | May contain **Markdown** (bold, bullet lists) — the twin sends structured requirement templates this way. Render with basic Markdown support (bold + bullets at minimum) rather than as plain text, or the templates will look like a wall of asterisks. |
| `messages[].sent_at` | ISO 8601 string | |
| `messages[].session_id` | string | Opaque id, only used to detect session boundaries (see §5). |

**`ai_twin_nurture`** (present only for AI Twin leads; value is `null` until drafted)

| Field | Type | Notes |
|---|---|---|
| `draft` | string | Suggested WhatsApp/message text, grounded in the conversation. |
| `drafted_at` | ISO 8601 string | |
| `touch_count` | integer | How many nurture drafts have been sent for this lead so far (1st, 2nd follow-up, etc.). Display only if useful; not required. |
| `whatsapp_url` | string \| `null` | Full `https://wa.me/...` link, pre-filled. `null` if the lead has no phone number. |
| `email_url` | string \| `null` | Full `mailto:...` link, pre-filled subject + body. `null` if the lead has no email. |

**`ai_twin_conversation.extracted.financing`** (`null` unless the twin ran an affordability check with the buyer)

| Field | Type | Notes |
|---|---|---|
| `max_property_price` | string \| `null` | Indicative maximum property price, e.g. `"RM 610,000"`. Already formatted — render as-is. |
| `monthly_instalment` | string \| `null` | Indicative monthly repayment, e.g. `"RM 2,900"`. |

**`ai_twin_cobroke`** (present only for AI Twin leads; absent/`null` unless another agent's listing matched)

| Field | Type | Notes |
|---|---|---|
| `matched_at` | ISO 8601 string | When the match ran — which is **now**. Matching happens at request time, so these are always current listings, never a snapshot. There is no staleness to warn the agent about, so don't render an "as of…" line. |
| `listings` | array | At most 3. Ordered cheapest-first for sale leads; rental leads are ordered by listing id, since the sale-price column they sort on is zero for rentals. |
| `listings[].id` | integer | Atlas listing id — safe to deep-link to the listing page. |
| `listings[].property_name` | string | |
| `listings[].township` | string | |
| `listings[].price` | string | Pre-formatted, e.g. `"RM 450,000"` or `"RM 2,500/month"`. |
| `listings[].type` | string | `"Sale"` or `"Rental"`. |
| `listings[].agent_id` | integer | User id of the listing's owner. Needed for the co-broke request (§5c). |
| `listings[].agent_name` | string \| `null` | The agent who owns the listing. **Agent-facing only** — the buyer is never told this in chat. |
| `listings[].agent_phone` | string \| `null` | Same. Render as a `tel:`/WhatsApp link so the agent can call their colleague. |

## 4. Component 1 — "AI Twin Conversation" card

**Purpose:** let the agent read the actual conversation before calling, without leaving the modal.

**Structure:**
- Header: "AI Twin Conversation"
  - If `session_count > 1`: a small badge/pill next to the header, e.g. "Returning buyer" or "2 visits" (either is fine — use whatever pill style the modal already has for status/type badges).
  - If `qualified === false`: a small inline note under the header, e.g. "⚠ Marked not qualified by AI" (use the modal's existing warning/muted-text style, not a hard error color — this is informational, not a validation error).
- Body: chat-style transcript, scrollable container with a max height (roughly 400–500px is reasonable) so a long conversation doesn't blow out the modal.
  - One bubble/row per `messages[]` entry, oldest at top.
  - `role: "user"` → align one side (e.g. right), `role: "assistant"` → align the other (e.g. left). Match whatever left/right convention Atlas uses elsewhere for chat-style UI, if one already exists; otherwise buyer-right/twin-left is the conventional choice.
  - Render `message` with basic Markdown (bold, bullet lists at minimum — see field reference above).
  - Show `sent_at` as a small timestamp per message (relative, e.g. "2h ago", with the absolute time on hover/title if the modal already has that pattern for other timestamps).
  - **Session boundary:** walking through `messages[]` in order, whenever `session_id` changes from the previous message, insert a subtle divider before that message — e.g. a centered horizontal rule with the label "— buyer returned —". This only happens when `session_count > 1`; with a single session there's nothing to divide.
- This card is entirely read-only. No inputs, no buttons, no edit affordance.

## 5. Component 2 — "Suggested Follow-up" card

**Purpose:** give the agent a one-click way to send a grounded, ready-to-go re-engagement message.

**Render this card only when `ai_twin_nurture` is non-null.** If it's `null`, omit the card entirely — don't render an empty/placeholder state (a lead can be scored and qualified well before the nurture worker has run, and an empty box here would just be noise on every fresh lead).

**Structure:**
- Header: "Suggested Follow-up"
- Body: the `draft` text, rendered as quoted/blockquote-style text (visually distinct from the transcript above, since the agent didn't write it and hasn't sent it yet).
- Small metadata line: relative time from `drafted_at` (e.g. "Drafted 3 hours ago").
- Action button(s):
  - If `whatsapp_url` is present → primary button, label "Send on WhatsApp", `href={whatsapp_url}`, opens in a new tab (`target="_blank" rel="noopener noreferrer"`).
  - Else if `email_url` is present → primary button, label "Send by Email", `href={email_url}`.
  - If both are `null` → no button; show a small note instead, e.g. "No phone or email on file yet."
  - If both are present, WhatsApp is primary; email can be a secondary/text link next to it (e.g. "or send by email") — optional, not required for v1.
- These are **plain `<a href>` links**, not API calls. Clicking one hands off to WhatsApp Web / the OS mail client with the message pre-filled; the agent reviews and sends it themselves from their own account. Nothing is sent automatically, and there is no follow-up API call to make when the button is clicked.

## 5a. Affordability row (inside the Conversation card)

When `ai_twin_conversation.extracted.financing` is non-null, show a small highlighted row inside the Conversation card, above the transcript:

> **Affordability checked** — can support a property up to **RM 610,000** (~RM 2,900/month)

Both figures arrive pre-formatted; render them as-is. Add a short qualifier such as "indicative, not a bank approval" — the twin says this to the buyer and the agent should see the same caveat. When `financing` is `null`, render nothing (most leads won't have it).

## 5b. Component 3 — "Co-broke Matches" card

**Purpose:** when the agent has nothing suitable, show which colleagues do — turning a dead lead into a co-broke deal.

**Render only when `ai_twin_cobroke` is non-null.** Place it after the Suggested Follow-up card.

These are matched fresh on every request against currently active, co-broke-enabled stock — a listing that sells, or whose owner closes it to co-broking, drops out of this list by itself. So the set can legitimately differ between two views of the same lead, and can go from present to absent. Render whatever comes back; don't cache it client-side or treat a disappearance as an error.

**Structure:**
- Header: "Co-broke Matches", with a short subtitle: "Other IQI agents have stock matching this buyer."
- One row per `listings[]` entry: `property_name`, `township`, `price`, `type` badge.
- Each row shows the **owning agent**: `agent_name`, with `agent_phone` as a call/WhatsApp link so the agent can reach their colleague directly.
- `id` can deep-link to the existing listing page if the modal has a route for it — optional.
- Read-only. No co-broke request is created from here; the agent contacts the colleague themselves.

**Important:** these listings and the owning agents' names are **agent-facing only**. The buyer was shown the properties without any agent attribution, and was told the profile agent can arrange them through IQI's network. Nothing in this card should imply the buyer knows whose listings these are.

## 5c. "Request co-broke" button (the one write in this spec)

This is the only place the twin panel calls a mutating endpoint, and it uses the **existing** Co-broke Centre API — no new endpoint, no new workflow.

Each row in the Co-broke Matches card gets a **"Request co-broke"** button:

```
POST /api/v1/co_broke_requests
{
  "sender_id": <lead.user_id>,          // this lead's agent — already on the lead payload
  "agent_id":  <listing.agent_id>,      // the listing's owner, from §5b
  "entity_id": <listing.id>,            // the listing
  "status_id": 2,                       // SENT
  "type": "ListingCoBrokeRequest"
}
```

The backend does the rest: it re-checks the listing is open to co-broking, seeds the commission split from the listing's own `co_broke_settings`, and notifies both agents (system, push and email, honouring the listing owner's notification preferences). From there the request lives in the Co-broke Centre and follows the normal path — accept or decline, counter-offer on commission, download the agreement, conclude the deal.

**Behaviour:**
- The button is **agent-initiated only**. Never fire it automatically on page load: sending commits the agent to a commission negotiation with a colleague, so it must be a deliberate click.
- Consider a confirm step ("Send a co-broke request to {agent_name} for {property_name}?"), since it notifies another person.
- **On success** (`200`): swap the button for a "Requested" state. Optionally deep-link to the Co-broke Centre.
- **On `422`**: show the returned `message`. The two real cases are the listing owner having since closed it to co-broking, and a duplicate — the backend enforces one request per (listing, sender, agent), so a second click on an already-sent match is rejected rather than duplicated. Both are expected, not errors to log loudly.
- Requires the agent to hold the `SUBSALES_LISTINGS` update permission, same as anywhere else co-broke requests are raised. If your app already gates co-broke UI on that, gate this the same way.

## 6. Edge cases

| Case | Expected behavior |
|---|---|
| `source_id !== 7` (any non-twin lead) | `ai_twin_conversation` / `ai_twin_nurture` keys absent from the response. Render nothing new — page is byte-for-byte what it is today. |
| `ai_twin_conversation.messages` is an empty array | Should not normally happen (a lead only exists once there's at least one message), but if it does, show a small "No messages recorded" line instead of an empty box. |
| `session_count === 1` | No "Returning buyer" badge, no dividers in the transcript. |
| `qualified === false` | Show the "Marked not qualified by AI" note (§4). This is informational only — it does not change what the agent can do with the lead (status, editing, etc. all work as normal). |
| `ai_twin_nurture === null` | Omit the Suggested Follow-up card entirely (§5). |
| `ai_twin_nurture.whatsapp_url === null` but `email_url` present | Show "Send by Email" as the (only) button. |
| Both `whatsapp_url` and `email_url` are `null` | Show the follow-up card (draft text is still useful to read/copy), but no send button — just the "No phone or email on file yet" note. |
| Very long transcript | Scrollable container (§4) — the modal itself should not grow unbounded. |
| Message contains Markdown the renderer doesn't support (tables, links, etc.) | Not expected from the twin today (only bold + bullets are used), but fall back to plain text rendering rather than showing raw Markdown syntax if something unsupported appears. |
| `extracted.financing === null` | Render no affordability row (§5a). This is the common case — most buyers never run the check. |
| `ai_twin_cobroke` absent or `null` | Omit the Co-broke Matches card entirely (§5b). Also the common case. |
| The card was there earlier and is now gone | Expected, not a bug — the matching stock sold or was closed to co-broking (§5b). Just don't render the card. |
| A co-broke listing has `agent_phone === null` | Show `agent_name` as plain text with no call link, rather than a dead link. |

## 7. Non-goals (explicitly out of scope for this change)

- No new API endpoints — the lead data comes from the existing show response, and the co-broke request (§5c) uses the existing Co-broke Centre endpoint.
- Read-only apart from the one deliberate write in §5c ("Request co-broke"), which is always agent-initiated.
- No co-broke workflow rebuilt here — accepting, negotiating commission, the agreement PDF and concluding the deal all stay in the Co-broke Centre, which already does them.
- No changes to the Leads list view, filters, or any other part of the modal (Lead Details / Lead Source / Interest / Lead Status sections are untouched).
- No automatic sending of the nurture draft — the agent always sends manually via the WhatsApp/email link.
- No polling or real-time updates — the data is as fresh as whenever the modal was opened, same as every other field in it.
- No handling for `property_type` / `group_type_id` sub-type filtering — unrelated, out of scope.

## 8. QA / acceptance checklist

- [ ] Opening a non-AI-Twin lead's Edit modal looks identical to before this change.
- [ ] Opening an AI Twin lead shows the new section between Interest and Lead Status.
- [ ] Transcript renders in chronological order, correct left/right alignment by role.
- [ ] Bold text and bullet lists inside twin messages render as formatted Markdown, not raw `**`/`-` characters.
- [ ] A lead with `session_count > 1` shows the "Returning buyer" badge and a divider at the correct point in the transcript.
- [ ] A lead with `session_count === 1` shows neither.
- [ ] A lead with `qualified: false` shows the "not qualified" note; a qualified lead does not.
- [ ] A lead with `ai_twin_nurture: null` shows no Suggested Follow-up card.
- [ ] A lead with a nurture draft and a phone number shows a working "Send on WhatsApp" link that opens `wa.me` with the message pre-filled.
- [ ] A lead with a nurture draft, no phone, but an email shows "Send by Email" instead, opening the default mail client with subject/body pre-filled.
- [ ] A lead with a nurture draft and neither phone nor email shows the draft text with no send button.
- [ ] A conversation long enough to overflow scrolls inside its own container without growing the modal off-screen.
- [ ] A lead where the twin ran an affordability check shows the affordability row with both figures and the "indicative" qualifier; a lead without one shows no row.
- [ ] A lead with co-broke matches shows the card with each listing's owning agent and a working call link; a lead without matches shows no card.
- [ ] A co-broke listing whose owning agent has no phone renders the name as plain text, not a broken link.
- [ ] "Request co-broke" sends the request, both agents are notified, and it appears in the Co-broke Centre for each of them.
- [ ] Clicking it a second time on the same listing surfaces the duplicate `422` message rather than creating a second request.
- [ ] A listing whose owner has since closed it to co-broking surfaces the "not open for co-broke" `422` message.

## 9. Open questions for the FE dev (design polish, not blockers)

These don't block a first implementation — reasonable defaults are called out above — but flag if there's an existing pattern to reuse instead:

1. Does Atlas already have a chat-bubble / message-thread component anywhere else in the app (e.g. internal notes, support chat) worth reusing for the transcript, rather than building one from scratch?
2. Does the modal have an existing badge/pill component for statuses (it does, for Priority/Type/Status) — reuse that component for "Returning buyer" rather than introducing a new badge style.
3. Preferred relative-time formatting library/util, if the codebase already standardizes on one (e.g. `dayjs`, `date-fns`), for `sent_at` / `drafted_at` / `scored_at`.
