# Design: Affordability Check + Co-broke Matchmaker

Two additions to the AI Twin lead engine, both aimed squarely at GMV:
screening out Malaysia's #1 deal-killer (loan rejection) before the first
call, and converting demand one agent can't serve into co-broke transactions
another IQI agent can.

Repos touched: `agent-x` (branch `lead-engine`), `atlas-api` (branch
`lead-engine`). No new endpoints; no frontend work in this spec (the lead
modal additions ride on the existing FE spec as optional cards).

---

## Feature A — Affordability Check (loan pre-qualification)

### Buyer experience

- Trigger: buying intent is clear — the buyer stated a budget, discussed a
  specific sale listing, or filled the BUY requirements template. Rentals
  never trigger it.
- The twin offers **once**, opt-in, softly:
  > "Want a quick check on roughly what loan amount you'd likely qualify
  > for? I just need your monthly take-home income and any existing loan
  > commitments — no documents needed."
- If declined or ignored: never raised again (same etiquette as the
  phone-number ask).
- If accepted: the twin collects monthly net income and existing monthly
  commitments (a range or approximation is fine — the twin never demands
  exact figures), optionally outstanding credit card balance, then calls
  the eligibility calculator and replies with:
  - maximum loan amount
  - maximum property price
  - estimated monthly installment
  - an explicit disclaimer that this is indicative and banks assess
    differently
  - if a target property/budget is known: whether it fits under the max
    ("the RM480k unit you asked about sits comfortably within this").

### Build — agent-x

- New tool `check_loan_eligibility` in `tools/twin_calculators.py`:
  - Calls the existing public `POST /api/web/calculate/eligibility`
    (unauthenticated, same pattern as `calculate_mortgage`).
  - Inputs: `monthly_net_income` (required), `existing_monthly_loan_repayment`
    (default 0), `outstanding_credit_card_balance` (default 0),
    `loan_tenure_years` (default 35), `interest_rate` (default matches the
    mortgage tool's default).
  - Returns formatted text: max loan, max property price (loan / 0.9),
    monthly installment. On HTTP/network error, returns an apologetic
    fallback string; the twin moves on (fail-soft).
- Register in `tools/twin_toolkit.py` `TWIN_TOOLS`.
- New prompt rule `AFFORDABILITY CHECK` in `prompts/twin_instructions.py`:
  - When to offer (buy intent only), offer once, opt-in, accept ranges,
    always disclaim "indicative — banks assess differently", never present
    the result as approval or a promise.
  - Results always come from the tool, never from memory (consistent with
    the `MARKET FIGURES — NEVER FROM MEMORY` rule).

### Build — atlas-api

- `Ai::Twin::LeadScorer::SCORING_INSTRUCTION` and agent-x's
  `TWIN_SCORER_INSTRUCTIONS` gain a `financing` object in the JSON verdict:
  ```json
  "financing": {"checked": false, "max_property_price": "", "monthly_instalment": ""}
  ```
  `checked` is true only when an affordability check actually ran in the
  conversation; the other fields carry the figures in the buyer's terms.
- `apply_verdict`:
  - Stores `financing` inside `payload["twin_scoring"]` (falls out of the
    existing "store the whole verdict" behavior — verify, don't rebuild).
  - If `lead.budget` is blank and `financing.checked` with a
    `max_property_price`, fill `budget` with
    `"up to ~RM<max> (affordability check)"`. Consequence: `TwinPriority`
    sees a budget and grades the lead HIGH with **zero changes to the
    priority rules**.
- `LeadSerializer#ai_twin_conversation`: include `financing` under
  `extracted` (null/absent when never checked).

### Not doing

- No storing of raw income/commitment figures on the Lead — they live only
  in the transcript and the derived `max_property_price`.
- No bank recommendations or rate comparisons (regulated territory; out of
  scope).
- No change to `TwinPriority` rules.

---

## Feature B — Co-broke Matchmaker (cross-agent demand matching)

### Buyer experience

- The twin always searches the profile agent's **own** inventory first —
  existing behavior, untouched.
- Only when the agent's own inventory has no match does the twin search
  network-wide, and frames results as the agent's reach:
  > "Stev doesn't currently list a 3-bed in Luyang, but through IQI's
  > network he can arrange these two: …"
- The owning agent's identity is **never** shown to the buyer. The profile
  agent keeps the lead.

### Build — agent-x

- `tools/twin_listing_search.py`: new tool `search_network_listings` with
  the same filters as `search_agent_listings` (location keyword, price,
  bedrooms, category, sort, rent/buy) but **without the profile-agent
  filter**, excluding the profile agent's own listings from results.
  Result formatting strips/omits agent identity.
- New prompt rule `OWN INVENTORY FIRST, THEN THE NETWORK`:
  - Network search is only allowed after an own-inventory search returned
    nothing suitable.
  - Present network options as "{agent} can arrange through IQI's network".
  - Never name, or let slip, the listing agent.

### Build — atlas-api

- New service `Leads::CobrokeMatcher`:
  - Input: a scored lead (needs the scorer's `target_city`,
    `property_category`, `budget`, `intent` already applied).
  - Query: `Listing` active + `published_to_iqi`, excluding
    `user_id == lead.user_id`, filtered by target city/state (ransack, same
    scoping as the public subsales endpoint), category (via the existing
    category-id mapping), listing type matching rent/buy intent, and price
    within budget when a numeric budget can be parsed (skip the price filter
    when it can't).
  - Output: top 3 matches stored in `payload["cobroke"]`:
    ```json
    {"matched_at": "...", "listings": [
      {"id": 1, "title": "...", "price": "...", "area": "...",
       "agent_name": "...", "agent_phone": "..."}]}
    ```
  - No matches → stores nothing (key absent), never an empty shell.
  - Runs at scoring time, invoked after `apply_verdict` in the scorer flow.
    Failure is caught and logged; scoring still succeeds (fail-soft).
- Agent notification: when matches exist, the assigned/return notification
  mentions the count ("2 co-broke matches found").
- `LeadSerializer`: new `ai_twin_cobroke` key, same guards as the other two
  (`ai_twin?` + `view_as == :show`), null/absent when no matches stored.

### Why server-side matching

The twin's in-chat network search is for the buyer's experience. The
matches recorded on the lead come from `CobrokeMatcher` re-running the
match deterministically against the scorer's structured extraction — not
from parsing what the twin happened to display. Deterministic, testable,
and it works even when the buyer never asked for a search.

### Not doing

- No co-broke workflow automation (agreements, commission splits, intros) —
  the lead just shows who has the stock; the agent picks up the phone.
- No buyer-facing marketplace browsing of network inventory.
- No new listing API endpoints (network search uses `/api/web/subsales`
  as-is).

---

## Error handling (both features)

Fail-soft everywhere, matching the existing scorer posture:
- Tool call fails in-chat → twin apologizes briefly and continues; never
  blocks the conversation.
- `CobrokeMatcher` raises → rescued and logged; lead scoring completes
  without co-broke data.
- Scorer returns malformed/missing `financing` → treated as not checked.

## Testing

- **atlas-api unit tests**: `Leads::CobrokeMatcherTest` (matching by
  city/category/intent/budget, excludes own listings, top-3 cap, absent-key
  on no match, budget-parse fallback); scorer tests for `financing` →
  budget fill and payload storage; serializer test for `ai_twin_cobroke`.
- **agent-x live conversation tests** (curl against local agent-x, as done
  all session):
  - Affordability: offer appears on buy intent, not for rentals; opt-out
    respected; figures match Atlas's own calculator output.
  - Network search: own-inventory-first ordering; agent identity never
    leaked in replies; framing uses the "{agent} can arrange" language.

## Demo script (hackathon)

1. Buyer asks for a property the profile agent doesn't have → twin offers
   network options ("through IQI's network").
2. Buyer shows buy intent → twin offers the affordability check → buyer
   gives rough income → instant max-property-price answer.
3. Open the lead in Atlas: priority HIGH (budget auto-filled from the
   check), co-broke matches with owning agents' contacts, transcript
   showing it all happen.
4. Pitch lines: "The agent opens the lead already knowing the buyer can
   afford it" / "Demand that died at one agent's inventory limit now finds
   supply across 50,000 agents."
