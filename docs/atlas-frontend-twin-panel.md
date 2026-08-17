# Atlas frontend handoff: Twin Conversation panel on the lead detail

> Superseded by the full spec: [`atlas-leads-twin-panel-frontend-spec.md`](./atlas-leads-twin-panel-frontend-spec.md).
> This doc is kept for the original context/rationale; hand the FE dev the spec.

The AI Twin lead engine reuses Atlas's existing Leads page wholesale — list,
filters, Edit Lead modal, statuses, WhatsApp/Call buttons all work unchanged,
and the twin's extracted fields land in columns the modal already renders
(budget, purchase timing, motivation, target location, current location,
language, summary → Initial Comments).

After the current `lead-engine` deploy, two more existing columns fill in with
no frontend work:

- **Priority** — Urgent / High / Normal / Low (rule-based, set at scoring)
- **Type** — Rental / Resale instead of generic Enquiry, when the conversation
  makes the intent clear

One panel is missing, and it is the reason an agent would open a twin lead:
**the conversation itself, and the ready-to-send follow-up.** Both are already
in the API; nothing renders them.

## Where the data is

`GET /api/v1/leads/:id` (the existing show endpoint the modal uses). Two keys
appear **only when `source_id == 7` (AI Twin)** — for every other lead source
the response is unchanged, so the panel simply doesn't render:

```jsonc
"ai_twin_conversation": {
  "summary": "Aisha is seeking a 3-bedroom rental in Kota Kinabalu…",
  "qualified": true,
  "scored_at": "2026-08-17T09:41:00Z",
  "extracted": { "budget": "around RM3000", "purchase_timing": "move in 2 months", "motivation": "…" },
  "session_count": 2,          // >1 = the buyer came back
  "messages": [                 // chronological, internal context pre-stripped
    { "role": "user",      "message": "Any 3-bed rentals in KK?", "sent_at": "…", "session_id": "…" },
    { "role": "assistant", "message": "Yes, two under RM3,000.",  "sent_at": "…", "session_id": "…" }
  ]
},
"ai_twin_nurture": {            // null until the nurture worker has drafted
  "draft": "Hi Tan Wei, are you still looking for a 3-bedroom in KK? …",
  "drafted_at": "2026-08-18T02:00:00Z",
  "touch_count": 1,
  "whatsapp_url": "https://wa.me/60123456789?text=…",  // null if no phone
  "email_url": "mailto:…?subject=…&body=…"             // null if no email
}
```

## What to build (one section in the Edit Lead modal)

Render only when `ai_twin_conversation` is present.

1. **"AI Twin Conversation" card** below Interest:
   - Chat-style transcript from `messages` (buyer right / twin left, or any
     house style), `sent_at` timestamps. `session_count > 1` → show a
     "Returning buyer" badge; a session boundary between differing
     `session_id`s can render as a subtle "— buyer returned —" divider.
   - `qualified: false` → small "Marked not qualified by AI" note so the agent
     knows why the lead sits at that status.
2. **"Suggested follow-up" card** when `ai_twin_nurture` is non-null:
   - The `draft` as quoted text, `drafted_at` relative time.
   - Primary button → `whatsapp_url` ("Send on WhatsApp"), falling back to
     `email_url` ("Send by Email") when whatsapp_url is null. These are plain
     hrefs — prefilled, the agent sends from their own account.

No new endpoints, no write calls, no state. Estimated at an hour or two for
someone who knows the modal.

## Nice-to-have (only if trivial in the list view)

The list already shows Source "AI Twin"; a filter chip for it is just the
existing ransack query `q[source_id_eq]=7`.
