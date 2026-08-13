# AI Twin — Lead Capture Design

Status: agreed direction, not yet implemented. Scope spans three repos: `atlas-api` (Rails), `agent-x` (FastAPI/Agno), and this repo (public-facing React app).

## Problem

Agents run Meta/Instagram ad campaigns that send cold inbound to a WhatsApp number. IQI Pilot — **IQI's own paid product for agents** (not a third-party vendor, corrected 2026-08-13) — answers those messages with AI. Per business ops, those conversations **are stored in a CRM**, and a tech lead has long wanted to import them into Atlas but never got the time. So the precise gap is: conversation data exists as raw CRM records, disconnected from Atlas, with no processing — no qualification scoring, no structured extraction, no agent-pipeline placement, no nurture. Moving the rows was never the hard part; there was no engine in Atlas to receive them. That engine is what this project builds — and it is deliberately channel-agnostic, so the stalled CRM import becomes a thin phase-2 feeder into the same pipeline the web Twin uses.

## Decision

Ship the AI Twin free to every agent, on their public IQI profile page. No entitlement/subscription gating — earlier freemium and Pilot-subscriber-gating ideas were considered and retired once the goal was clarified as "make Twin valuable on its own," not "fence leads behind Pilot."

The differentiator is lead visibility for IQI, not conversation quality: every Twin conversation that captures contact info becomes a real `Lead` record in Atlas. Pilot has no equivalent.

**Accepted tradeoff**: Pilot and Twin do overlap in function (both are "AI answers on an agent's behalf" for cold inbound) and the business chose to ship anyway, given the lead-visibility gap Pilot doesn't fill. Ad campaigns redirecting to the Twin's public profile page (instead of, or alongside, a WhatsApp number) is how this actually reaches the same ad-driven traffic Pilot serves today — confirmed acceptable by business ops. A web chat session doesn't persist the way a WhatsApp thread does, which is why contact capture is designed as the qualifying trigger, not an idle-timeout — the lead's info needs to be captured before they close the tab.

**Explicitly out of scope for v1**: WhatsApp-channel parity. The pipeline (see below) is channel-agnostic — only the transport (web POST vs. WhatsApp webhook) would need to change if this becomes a hard requirement later. Not needed now since ad-redirect-to-web-profile was confirmed acceptable.

## Architecture

```
Browser (agent's public profile page, this repo's UI)
   ▼
atlas-api — new public endpoint under /api/web (rack-attack gated)
   │  - mints session_id server-side
   │  - new TwinSession model (anonymous, not tied to a real User)
   │  - calls agent-x via the same server-to-server service-token
   │    pattern atlas-api already uses for the internal "Atlas Agent"
   │    staff chat (see app/services/ai/atlas_agent/service.rb)
   ▼
agent-x — new Twin-scoped Agent + route
   │  - never internet-facing; only atlas-api calls it
   │  - restricted toolset: this agent's own public listings
   │    (via Api::Web::Agents#show) + generic calculators — nothing
   │    from Aini's ERP/cross-agent toolset
   │  - new guardrail variant (twin-scoped "self" identity, since
   │    the existing mobile_number_guardrail.py's trust anchor —
   │    the caller's own JWT identity — doesn't exist for anonymous
   │    sessions)
   ▼
atlas-api — Api::Web::LeadsController#create (existing, extended)
   │  - new Lead::SOURCES constant: AI_TWIN (alongside ATLAS = 6)
   │  - agent resolved server-side by email, same as existing flow
   │  - structured fields (budget, purchase_timing, motivation,
   │    listing_id) populated by an LLM extraction step over the
   │    transcript; full transcript + extraction also stored in
   │    `payload` (already a catch-all column on Lead)
```

## Why atlas-api stays the front door

Confirmed from `chat_session_manager.rb`/`service.rb`: the existing internal "Atlas Agent" staff chat already works this way — atlas-api authenticates the real user, generates `session_id` server-side, and only then calls `agent-x` with a static service credential. `agent-x` itself has no real request-level auth (JWT signature isn't verified, though a JWT-shaped header is required) and no rate limiting — that's tolerable today only because nothing but atlas-api ever calls it directly. Giving `agent-x` its own public endpoint would have reopened that gap (anonymous traffic reaching Aini's full toolset, not just the Twin). Keeping `agent-x` backend-only and reusing the existing calling convention avoids that entirely.

## Lead qualification flow

1. atlas-api mints `session_id`, opens a grounded, scoped chat via `agent-x` (context = this one agent's public listings).
2. Twin answers from real listing data.
3. When the visitor shows intent, the twin asks for name + contact — conversationally, not a form gate.
4. On capture, the lead is created immediately (so it's never lost), then an async worker runs an LLM pass over the full transcript: qualification verdict (qualified → stays `NEW`; unqualified → `NOT_QUALIFIED`, both existing statuses) + extraction into `Lead`'s existing structured columns (`budget`, `purchase_timing`, `motivation`, `listing_id`). A scoring failure can never cost the lead itself.
5. POST to `Api::Web::LeadsController#create`'s existing pattern — server-resolved `agent_email`, new `AI_TWIN` source, `initial_comments` = prose summary, `payload` = full transcript.
6. No lead fires if a name is never captured — that's just a browse.

**Contact capture rules** (enforced in the Twin flow, not by changing the `Lead` model — its own validation already matches: only `buyer_name` is required):

- The lead fires as soon as the buyer's name is captured. Nothing else is required — matching Atlas's own `Lead` validation.
- After firing, the lead is enriched in place as the conversation continues: phone/email are appended to the existing record when the visitor shares them (update, not a second lead), and the scoring worker re-runs on session end so the final transcript is what gets scored.
- Phone-preferred soft prompt: the twin asks for a phone number — framed as "so {agent} can reach you directly on WhatsApp" — because phone is the channel agents actually follow up on (and the nurture `wa.me` link needs it). Soft means: ask once, accept refusal gracefully, never block the conversation on it.
- This lives in the Twin agent's instructions (agent-x) plus the atlas-api controller (create-on-name, enrich-on-update).

## Rate limiting

- Per-IP: new `rack-attack` throttle, same shape as the existing `ai_insights` rule (`config/initializers/rack_attack.rb`).
- Per-session: message count cap (~30–50) and max characters per message, enforced in the new atlas-api controller — this is the real lever against cost abuse, IP throttling alone misses a single session hammering the LLM.

## Guardrails

- Primary control: tool scoping (the restricted registry above) — even a successful prompt injection can't reach data outside this agent's public listings.
- Basic system-prompt hardening as defense-in-depth (ignore embedded instructions that try to change role/data source).
- Output scrub before returning to the browser, same spirit as the existing narrow Slack PII-redaction precedent in the Claim Agent.
- Audit logging (interactions minus sensitive content) — listed in `docs/CLAUDE_SECURITY.md`'s checklist today but unimplemented; add for this feature.

## Web chat implementation plan (atlas-api)

### Storage: new tables, NOT reusing `chat_sessions`/`chat_messages`

Decided 2026-08-13. The existing tables serve the internal staff chat and can't absorb anonymous
sessions cleanly:

1. `chat_sessions.user_id` is `null: false` with a DB-level FK, and `ChatSession belongs_to :user`
   is required — anonymous rows would force relaxing both, weakening integrity for the staff flow.
2. Semantics: in `chat_sessions`, `user_id` = the person chatting. A twin session's user is the
   *represented agent*, who never typed anything. Same column, different meaning per row.
3. Existing consumers assume staff ownership — `ChatChannel`'s `find_by(session_id:, user_id:)`
   lookup, `ChatMessageFeedback`, ransack interfaces. Twin rows would leak into all of them.
4. Different lifecycle and PII posture: buyer contact info from anonymous visitors, token-based
   public access, expiry/finalization, and purge for sessions that never became leads.

New tables mirror the existing column shape (`role`/`message`/`metadata`/`tools_used`/`run_id`)
so serializer/service patterns port over:

- **`twin_chat_sessions`** — `agent_id` (FK users; the represented agent), `session_id`
  (server-minted UUID, unique), `lead_id` (nullable FK), `status` (active/finalized/expired),
  `buyer_name`/`buyer_phone`/`buyer_email` (staging area — phone can arrive before name, and no
  lead can exist until name does), `message_count`, `last_activity_at`, `started_at`/`ended_at`,
  `metadata` (jsonb).
- **`twin_chat_messages`** — `twin_chat_session_id` FK, `role`, `message`, `metadata`,
  `tools_used`, `run_id`, `token_count`.

### Request flow

1. **Open session**: `POST /api/web/twin_chats` with `agent_slug`. Rack-attack throttled. Finds
   the active agent by slug, creates the session, returns a signed token (Rails MessageVerifier
   over the session UUID, ~24h expiry — UUID alone is unguessable; signing adds expiry and
   tamper-proofing).
2. **Messaging: WebSocket via Action Cable on AnyCable, mirroring the staff chat's two-leg
   transport** (decided 2026-08-13; atlas-api already runs `anycable-rails ~> 1.6` with the
   `any_cable` adapter in production — confirmed in Gemfile + `config/cable.yml`). Browser ↔
   atlas-api over a new `TwinChatChannel` (a sibling of `ChatChannel`, not a modification);
   atlas-api ↔ agent-x unchanged — same service-bearer HTTP + SSE streaming and
   chunk-rebroadcast pattern as `Ai::AtlasAgent::Service`. Connection identification:
   `ApplicationCable::Connection` gains an alternate path — a valid signed twin session token
   (MessageVerifier) identifies the connection; no token and no staff JWT → rejected as today.
   **AnyCable constraint**: connection identifiers round-trip through the Go server via RPC, so
   identify by the session UUID string (`identified_by :twin_session_id`), not the AR record —
   channels load the record per action. Anonymous-connection scale is handled by the Go server,
   so public traffic poses no thread-pool concern. **Caps (~40 messages/session, ~1,000 chars/message) and message-rate limits are
   enforced inside the channel action** — WebSocket messages bypass Rack middleware, so
   rack-attack never sees them; HTTP-level throttling applies only at session creation, which is
   why that stays a plain POST. **Atlas builds the grounding context into the agent-x payload**
   (compact listing summaries: name, price, sale/rent, township, beds/baths) so agent-x needs no
   callbacks to Atlas. Fallback under time pressure: a sync `POST /messages` endpoint works with
   the identical UI (typing indicator, then full reply) — swap to cable after.
3. **Contact capture**: the twin agent exposes a `capture_contact(name, phone, email)` tool.
   agent-x reports tool calls in response metadata (existing `tools_used` pattern); atlas-api
   inspects them: name captured + no lead yet → create Lead (`AI_TWIN` source, transcript-to-date
   in `payload`) and link `lead_id`; lead already exists → enrich in place. Lead creation goes
   through an internal service (`Leads::CreateFromTwin`), not the web controller — so no
   param-permitting concerns.
4. **Dedup**: on capture with phone/email, look for an open lead (`NEW`/`CONTACTED`) for the same
   agent + same contact within 30 days → attach this session to it and re-score instead of
   creating a duplicate. Closed or out-of-window → new lead. Name-only sessions can't be deduped
   reliably (two "Ahmad"s), so they stay one-lead-per-session.
5. **Finalization + scoring**: a `sidekiq_scheduler.yml` entry expires sessions idle >30 min →
   status `finalized` → if a lead is linked, enqueue the scoring worker: LLM pass over the full
   transcript → qualification verdict (`NEW` stays / `NOT_QUALIFIED`) + `budget` /
   `purchase_timing` / `motivation` / `listing_id` + prose summary into `initial_comments`.
6. **PII retention**: sessions that never produced a lead are purged after N days (precedent:
   `Ocrs::BookingFormScanPurgeWorker`).

### Rack-attack changes

- **Carve `/api/web/twin_chats*` out of the production IP allowlist/blocklist** — buyer browsers
  come from arbitrary IPs; without this exemption the endpoints are unreachable in production.
- New throttles (precedent: `ai_insights`): session create ~5/hr/IP, messages ~60/hr/IP — on top
  of the per-session caps above.

### agent-x side

- New twin route/agent with the restricted toolset: listing context from the request payload,
  generic calculators, `capture_contact`. Never internet-facing; only atlas-api calls it with the
  service bearer token.

## Open items to resolve during implementation

- Exact cap values (messages/session, chars/message, throttle rates) — placeholders above; tune
  during build.
- Purge window (N days) for lead-less sessions.
- ~~agent-x outbound IP allowlisting~~ — no longer needed: Atlas passes grounding context in the
  payload, agent-x makes no callbacks.
- ~~`Leads#create` param permitting~~ — no longer relevant: lead creation happens via an internal
  service, not the web controller.

## Explicitly not doing (for now)

- Pilot entitlement/subscription gating — retired; goal is Twin's own value, not funneling to Pilot.
- WhatsApp channel support — pipeline is channel-agnostic if this becomes a requirement later, but not scoped into v1.
- A "leads generated via Twin" reporting dashboard for leadership — worth considering later if the visibility story needs to be made tangible, not scoped now.
