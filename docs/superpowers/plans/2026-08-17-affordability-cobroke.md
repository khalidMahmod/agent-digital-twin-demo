# Affordability Check + Co-broke Matchmaker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI Twin pre-qualify a buyer's loan affordability using Atlas's own eligibility calculator, and surface cross-agent ("co-broke") inventory matches on the lead when the profile agent has nothing suitable.

**Architecture:** Two independent features across two repos. In `agent-x`, two new tools plus prompt rules govern what the twin does in conversation. In `atlas-api`, the scorer records a `financing` verdict field and a new deterministic `Leads::CobrokeMatcher` re-derives matches server-side from the scorer's structured extraction — the lead's co-broke data never depends on what the twin happened to display in chat. Both features fail soft: a calculator or matcher failure costs enrichment, never the lead.

**Tech Stack:** Rails 7 (atlas-api, Minitest, fixtures), Python 3 / Agno (agent-x, pytest, httpx).

## Global Constraints

- Both repos work on branch `lead-engine`. `agent-x`'s local checkout defaults to `main` and carries a pre-existing uncommitted `uv.lock` version-bump diff that is **not ours** — `git stash` it before `git checkout lead-engine`, and `git stash pop` after returning to `main`.
- agent-x twin tools call Atlas's **public** `/api/web/*` endpoints directly via `httpx`, never through `utils.atlas_client` (which requires a JWT twin visitors do not have). Follow the existing pattern in `tools/twin_calculators.py`.
- Twin tools are **not** registered in `tools/tool_scoping.py`'s `DOMAIN_TOOL_NAMES` — that registry covers Aini's `_ALL_TOOLS` only, and the twin agent receives `tools=TWIN_TOOLS` separately (`agno_agent.py:771`). Do **not** add twin tools there; `build_tool_domains` raises on unknown names but never sees them.
- Never log buyer PII (income, phone, email) in agent-x. Log field *names* only, as `capture_contact` does.
- The twin must never reveal the owning agent of a network listing to the buyer.
- atlas-api: run tests with `bin/rails test <path>`. agent-x: `uv run --with pytest pytest tests/ -v`.
- Scorer JSON schema is declared in **two** places that must stay identical: `atlas-api` `Ai::Twin::LeadScorer::SCORING_INSTRUCTION` and `agent-x` `prompts/twin_instructions.py::TWIN_SCORER_INSTRUCTIONS`.

## Decisions taken during planning (deviations from the spec)

1. **Co-broke matching respects `Listing#open_for_internal_co_broke`.** Research found Atlas already has a co-broke subsystem (`Listing.open_for_co_broke` scope, `ListingCoBrokeRequest`, `Api::V1::CoBrokeRequestsController`). Surfacing a listing whose owning agent opted **out** of internal co-broking would expose stock they never offered to share. Both the matcher and the twin's network search filter on it. This was not in the spec; it is a correctness requirement.
2. **The agent notification does NOT mention the co-broke count.** The spec asked for it, but ordering makes it near-dead code: `Leads::CreateFromTwin` notifies at lead-create time, while `CobrokeMatcher` runs later at scoring time — so no matches exist when the first notification fires. `app/views/notifications/leads/assign.html.erb` is also shared by every lead source. Co-broke matches surface in the lead modal via `ai_twin_cobroke` instead.
3. **Do not use `q[combined_search]`.** `tools/twin_listing_search.py` sends it, but no such ransacker exists anywhere in atlas-api and Ransack silently ignores unknown conditions — so the existing `keyword` argument is a **no-op today** (pre-existing bug, out of scope for this plan, flagged to the user). New code uses real ransackable attributes only.

## File Structure

**atlas-api** (branch `lead-engine`)

| File | Responsibility |
|---|---|
| `app/services/leads/budget_parser.rb` *(new)* | Free-text budget → integer MYR ceiling, or nil |
| `test/services/leads/budget_parser_test.rb` *(new)* | Parser cases |
| `app/services/leads/cobroke_matcher.rb` *(new)* | Deterministic cross-agent listing match from a scored lead |
| `test/services/leads/cobroke_matcher_test.rb` *(new)* | Matching, exclusions, caps, fallbacks |
| `test/fixtures/listings.yml` *(modify)* | Co-broke fixture listings |
| `app/services/ai/twin/lead_scorer.rb` *(modify)* | `financing` field, budget fill, matcher invocation |
| `test/services/ai/twin/lead_scorer_test.rb` *(new)* | financing → budget fill, matcher wiring |
| `app/serializers/lead_serializer.rb` *(modify)* | `ai_twin_cobroke` key, `extracted.financing` |

**agent-x** (branch `lead-engine`)

| File | Responsibility |
|---|---|
| `tools/twin_calculators.py` *(modify)* | `check_loan_eligibility` tool |
| `tools/twin_listing_search.py` *(modify)* | `search_network_listings` tool + shared helpers |
| `tools/twin_toolkit.py` *(modify)* | Register both new tools in `TWIN_TOOLS` |
| `tests/test_twin_tools.py` *(new)* | Pure-logic tests: formatting, agent-identity redaction |
| `prompts/twin_instructions.py` *(modify)* | `AFFORDABILITY CHECK`, `OWN INVENTORY FIRST`, scorer `financing` |

---

### Task 1: `Leads::BudgetParser`

Turns the scorer's free-text budget ("around RM500k", "RM 3,000/month") into an integer MYR ceiling the matcher can filter on. Takes the **largest** number found, because a budget is used as a maximum and stray small numbers ("2 bedrooms under RM500k") must not win.

**Files:**
- Create: `atlas-api/app/services/leads/budget_parser.rb`
- Test: `atlas-api/test/services/leads/budget_parser_test.rb`

**Interfaces:**
- Consumes: nothing.
- Produces: `Leads::BudgetParser.myr(String) -> Integer | nil`. Task 2 depends on this exact signature.

- [ ] **Step 1: Write the failing test**

Create `atlas-api/test/services/leads/budget_parser_test.rb`:

```ruby
require "test_helper"

module Leads
  class BudgetParserTest < ActiveSupport::TestCase
    test "plain amounts" do
      assert_equal 500_000, BudgetParser.myr("500000")
      assert_equal 3_000, BudgetParser.myr("RM 3,000/month")
    end

    test "k and million suffixes" do
      assert_equal 500_000, BudgetParser.myr("around RM500k")
      assert_equal 1_200_000, BudgetParser.myr("RM1.2 million")
      assert_equal 1_500_000, BudgetParser.myr("1.5 juta")
      assert_equal 800_000, BudgetParser.myr("RM800K")
    end

    # A budget is a ceiling, so a range takes its top end.
    test "ranges take the upper bound" do
      assert_equal 500_000, BudgetParser.myr("RM400k-500k")
      assert_equal 500_000, BudgetParser.myr("between RM400,000 and RM500,000")
    end

    # "2 bedrooms" must not beat "RM500k".
    test "incidental small numbers do not win" do
      assert_equal 500_000, BudgetParser.myr("2 bedrooms under RM500k")
      assert_equal 3_000, BudgetParser.myr("RM3,000/month, moving in 2 months")
    end

    # The string LeadScorer writes after an affordability check.
    test "affordability-check phrasing" do
      assert_equal 610_000, BudgetParser.myr("up to ~RM610k (affordability check)")
    end

    test "no parsable amount" do
      assert_nil BudgetParser.myr("")
      assert_nil BudgetParser.myr(nil)
      assert_nil BudgetParser.myr("not sure yet")
      assert_nil BudgetParser.myr("RM0")
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/khalid/Work/atlas-api && bin/rails test test/services/leads/budget_parser_test.rb
```
Expected: FAIL — `NameError: uninitialized constant Leads::BudgetParser`

- [ ] **Step 3: Write the implementation**

Create `atlas-api/app/services/leads/budget_parser.rb`:

```ruby
# frozen_string_literal: true

module Leads
  # Turns the budget the scorer extracted in the buyer's own words ("around
  # RM500k", "RM 3,000/month") into a number something can filter on.
  #
  # Takes the LARGEST amount in the string on purpose. A budget is a ceiling,
  # so a range should resolve to its top end, and incidental numbers a buyer
  # mentions alongside it ("2 bedrooms under RM500k", "moving in 2 months")
  # must never be mistaken for the budget itself.
  class BudgetParser
    SCALES = {
      "k" => 1_000,
      "juta" => 1_000_000,
      "million" => 1_000_000,
      "mil" => 1_000_000,
      "m" => 1_000_000
    }.freeze

    # Longest scale words first — otherwise "million" matches as "m".
    AMOUNT = /(\d[\d,]*(?:\.\d+)?)\s*(juta|million|mil|m|k)?\b/i

    def self.myr(text)
      new(text).call
    end

    def initialize(text)
      @text = text.to_s
    end

    def call
      amounts = @text.scan(AMOUNT).map do |digits, scale|
        (digits.delete(",").to_f * SCALES.fetch(scale.to_s.downcase, 1)).round
      end

      amounts.reject(&:zero?).max
    end
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/khalid/Work/atlas-api && bin/rails test test/services/leads/budget_parser_test.rb
```
Expected: PASS (7 runs, 0 failures)

- [ ] **Step 5: Commit**

```bash
cd /Users/khalid/Work/atlas-api
git add app/services/leads/budget_parser.rb test/services/leads/budget_parser_test.rb
git commit -m "Parse a buyer's stated budget into a number we can filter on"
```

---

### Task 2: `Leads::CobrokeMatcher`

Finds up to three listings from **other** IQI agents that fit this lead's extracted requirements, honouring each owning agent's co-broke opt-in.

**Files:**
- Create: `atlas-api/app/services/leads/cobroke_matcher.rb`
- Create: `atlas-api/test/services/leads/cobroke_matcher_test.rb`
- Modify: `atlas-api/test/fixtures/listings.yml`

**Interfaces:**
- Consumes: `Leads::BudgetParser.myr` (Task 1).
- Produces: `Leads::CobrokeMatcher.for(lead) -> Array<Hash>`, each hash with **string** keys `"id" "property_name" "township" "price" "type" "agent_name" "agent_phone"`. Task 3 stores this array under `lead.payload["cobroke"]["listings"]`.

- [ ] **Step 1: Add fixtures**

Append to `atlas-api/test/fixtures/listings.yml`. `sales_type` (existing, owned by `niel_kingston`) is reused as the "own agent" listing.

```yaml
cobroke_kk_condo:
  user: rea_agent
  status_id: 1
  auction: false
  type_id: 1
  category_id: 1
  group_type_id: <%= GroupType.find_or_create_by!( name: 'Condo/Serviced Residence' ).id %>
  property_type_id: <%= PropertyType.find_or_create_by!( name: 'Condomium' ).id %>
  open_for_internal_co_broke: true
  published_to_iqi: true
  property_name: Riverson Suites
  country_id: 1
  state_id: 1
  township: Kota Kinabalu
  address: Jalan Coastal
  hidden_address: ''
  measurement_id: 1
  asking_price_cents: 45000000
  asking_price_currency: MYR
  bedrooms: 3
  bathrooms: 2
  tenure_id: 1
  title_type_id: 1
  furnishing_status_id: 1
  occupancy_id: 1
  unit_type_id: 1

cobroke_kk_expensive:
  user: rea_agent
  status_id: 1
  auction: false
  type_id: 1
  category_id: 1
  group_type_id: <%= GroupType.find_or_create_by!( name: 'Condo/Serviced Residence' ).id %>
  property_type_id: <%= PropertyType.find_or_create_by!( name: 'Condomium' ).id %>
  open_for_internal_co_broke: true
  published_to_iqi: true
  property_name: Jesselton Twin Towers
  country_id: 1
  state_id: 1
  township: Kota Kinabalu
  address: Jalan Tuaran
  hidden_address: ''
  measurement_id: 1
  asking_price_cents: 200000000
  asking_price_currency: MYR
  bedrooms: 4
  bathrooms: 3
  tenure_id: 1
  title_type_id: 1
  furnishing_status_id: 1
  occupancy_id: 1
  unit_type_id: 1

cobroke_kk_opted_out:
  user: rea_agent
  status_id: 1
  auction: false
  type_id: 1
  category_id: 1
  group_type_id: <%= GroupType.find_or_create_by!( name: 'Condo/Serviced Residence' ).id %>
  property_type_id: <%= PropertyType.find_or_create_by!( name: 'Condomium' ).id %>
  open_for_internal_co_broke: false
  published_to_iqi: true
  property_name: Private Listing KK
  country_id: 1
  state_id: 1
  township: Kota Kinabalu
  address: Jalan Lintas
  hidden_address: ''
  measurement_id: 1
  asking_price_cents: 40000000
  asking_price_currency: MYR
  bedrooms: 3
  bathrooms: 2
  tenure_id: 1
  title_type_id: 1
  furnishing_status_id: 1
  occupancy_id: 1
  unit_type_id: 1

cobroke_kk_rental:
  user: rea_agent
  status_id: 1
  auction: false
  type_id: 2
  category_id: 1
  group_type_id: <%= GroupType.find_or_create_by!( name: 'Condo/Serviced Residence' ).id %>
  property_type_id: <%= PropertyType.find_or_create_by!( name: 'Condomium' ).id %>
  open_for_internal_co_broke: true
  published_to_iqi: true
  property_name: Inanam Court
  country_id: 1
  state_id: 1
  township: Inanam
  address: Jalan Inanam
  hidden_address: ''
  measurement_id: 1
  rental_price: 2500
  asking_price_cents: 0
  asking_price_currency: MYR
  bedrooms: 3
  bathrooms: 2
  tenure_id: 1
  title_type_id: 1
  furnishing_status_id: 1
  occupancy_id: 1
  unit_type_id: 1
```

- [ ] **Step 2: Write the failing test**

Create `atlas-api/test/services/leads/cobroke_matcher_test.rb`:

```ruby
require "test_helper"

module Leads
  class CobrokeMatcherTest < ActiveSupport::TestCase
    setup do
      @agent = users(:test_agent)
      @other_agent = users(:rea_agent)
    end

    def lead(**attrs)
      Lead.create!(
        {
          buyer_name: "Tan Wei",
          buyer_phone_number: "60123456789",
          type_id: Lead::RESALE,
          status_id: Lead::NEW,
          source_id: Lead::AI_TWIN,
          user_id: @agent.id,
          target_city: "Kota Kinabalu"
        }.merge(attrs)
      )
    end

    test "matches another agent's listing in the target city" do
      matches = CobrokeMatcher.for(lead)
      names = matches.map { |m| m["property_name"] }

      assert_includes names, "Riverson Suites"
    end

    test "never returns the lead's own agent's listings" do
      own = listings(:sales_type)
      own.update!(township: "Kota Kinabalu", user_id: @agent.id,
                  open_for_internal_co_broke: true, published_to_iqi: true)

      matches = CobrokeMatcher.for(lead)

      assert_empty matches.select { |m| m["id"] == own.id }
    end

    # The owning agent opted this listing out of internal co-broking; showing
    # it would be sharing stock they never offered to share.
    test "excludes listings whose agent opted out of co-broke" do
      names = CobrokeMatcher.for(lead).map { |m| m["property_name"] }

      refute_includes names, "Private Listing KK"
    end

    test "excludes inactive and unpublished listings" do
      listings(:cobroke_kk_condo).update!(status_id: ::Listing::INACTIVE)

      names = CobrokeMatcher.for(lead).map { |m| m["property_name"] }

      refute_includes names, "Riverson Suites"
    end

    test "respects a parsable budget as a ceiling" do
      names = CobrokeMatcher.for(lead(budget: "around RM500k")).map { |m| m["property_name"] }

      assert_includes names, "Riverson Suites"       # RM450,000
      refute_includes names, "Jesselton Twin Towers" # RM2,000,000
    end

    test "an unparsable budget skips the price filter rather than matching nothing" do
      names = CobrokeMatcher.for(lead(budget: "not sure yet")).map { |m| m["property_name"] }

      assert_includes names, "Riverson Suites"
    end

    test "a rental lead matches rentals, not sales" do
      names = CobrokeMatcher.for(
        lead(type_id: Lead::RENTAL, target_city: "Inanam")
      ).map { |m| m["property_name"] }

      assert_includes names, "Inanam Court"
      refute_includes names, "Riverson Suites"
    end

    test "returns at most three matches" do
      assert_operator CobrokeMatcher.for(lead).size, :<=, CobrokeMatcher::MAX_MATCHES
    end

    test "returns nothing when there is no location to match on" do
      assert_empty CobrokeMatcher.for(lead(target_city: "", target_state: ""))
    end

    test "carries the owning agent's contact details for the agent to act on" do
      match = CobrokeMatcher.for(lead).find { |m| m["property_name"] == "Riverson Suites" }

      assert_equal @other_agent.display_name, match["agent_name"]
      assert_equal @other_agent.mobile_contact_number, match["agent_phone"]
    end
  end
end
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/khalid/Work/atlas-api && bin/rails test test/services/leads/cobroke_matcher_test.rb
```
Expected: FAIL — `NameError: uninitialized constant Leads::CobrokeMatcher`

- [ ] **Step 4: Write the implementation**

Create `atlas-api/app/services/leads/cobroke_matcher.rb`:

```ruby
# frozen_string_literal: true

module Leads
  # Finds listings from OTHER IQI agents that fit what this lead is looking
  # for, so demand one agent cannot serve does not simply die with them.
  #
  # Runs server-side off the scorer's structured extraction rather than off
  # whatever the twin happened to show the buyer in chat: deterministic,
  # testable, and it still works when the buyer never asked for a search.
  #
  # open_for_internal_co_broke is load-bearing. Every listing here belongs to
  # another agent who chose to open it to internal co-broking; surfacing one
  # that opted out would be sharing stock its owner never offered to share.
  class CobrokeMatcher
    MAX_MATCHES = 3

    # Buyers say "condo" and "shop lot", not "Residential". Deliberately
    # mirrors CATEGORY_SYNONYMS in agent-x's tools/twin_listing_search.py —
    # the two run in different languages against the same category ids, so
    # they are kept in step by hand.
    CATEGORY_SYNONYMS = {
      ::Listing::RESIDENTIAL => %w[
        residential home house housing condo condominium apartment flat soho
        landed terrace terraced semi-d bungalow townhouse villa studio duplex
        penthouse serviced
      ],
      ::Listing::COMMERCIAL => %w[commercial shop shoplot shophouse retail office mall sofo business],
      ::Listing::INDUSTRIAL => %w[industrial factory warehouse workshop plant],
      ::Listing::AGRICULTURAL => %w[agricultural agriculture farm plantation orchard]
    }.freeze

    def self.for(lead)
      new(lead).call
    end

    def initialize(lead)
      @lead = lead
    end

    def call
      return [] if @lead.target_city.blank? && @lead.target_state.blank?

      matches = fetch(@lead.target_city)
      # One deliberate widening: nothing in the city, but the state is known.
      # An agent would search wider rather than give up, so we do too.
      matches = fetch(@lead.target_state) if matches.empty? && @lead.target_state.present?

      matches.map { |listing| describe(listing) }
    end

    private

      def fetch(place)
        return [] if place.blank?

        scope = base_scope
        scope = filter_place(scope, place)
        scope.limit(MAX_MATCHES).to_a
      end

      def base_scope
        scope = ::Listing.open_for_co_broke
                         .where(published_to_iqi: true)
                         .where.not(user_id: @lead.user_id)
                         .includes(:user)

        scope = scope.where(type_id: listing_type) if listing_type
        scope = scope.where(category_id: category_id) if category_id
        filter_price(scope)
      end

      # township is the closest thing the listing carries to "where"; address
      # and property_name catch the cases where the area name lives there
      # instead ("Jalan Coastal, Kota Kinabalu", "Inanam Court").
      def filter_place(scope, place)
        term = "%#{ActiveRecord::Base.sanitize_sql_like(place.to_s.strip)}%"
        scope.where(
          "listings.township ILIKE :term OR listings.address ILIKE :term OR listings.property_name ILIKE :term",
          term: term
        )
      end

      def filter_price(scope)
        ceiling = ::Leads::BudgetParser.myr(@lead.budget)
        return scope if ceiling.nil?

        if listing_type == ::Listing::RENT
          scope.where("listings.rental_price > 0 AND listings.rental_price <= ?", ceiling)
        else
          # asking_price is monetized, so the column is in cents.
          scope.where("listings.asking_price_cents > 0 AND listings.asking_price_cents <= ?", ceiling * 100)
        end
      end

      def listing_type
        case @lead.type_id
        when ::Lead::RENTAL then ::Listing::RENT
        when ::Lead::RESALE then ::Listing::SALE
        end
      end

      def category_id
        wanted = @lead.property_category.to_s.downcase
        return nil if wanted.blank?

        CATEGORY_SYNONYMS.find { |_id, words| words.any? { |word| wanted.include?(word) } }&.first
      end

      def describe(listing)
        {
          "id" => listing.id,
          "property_name" => listing.property_name,
          "township" => listing.township,
          "price" => price_label(listing),
          "type" => ::Listing::TYPES[listing.type_id],
          "agent_name" => listing.user&.display_name,
          "agent_phone" => listing.user&.mobile_contact_number
        }
      end

      def price_label(listing)
        if listing.type_id == ::Listing::RENT
          "RM #{listing.rental_price.to_i.to_fs(:delimited)}/month"
        else
          "RM #{(listing.asking_price_cents.to_i / 100).to_fs(:delimited)}"
        end
      end
  end
end
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/khalid/Work/atlas-api && bin/rails test test/services/leads/cobroke_matcher_test.rb
```
Expected: PASS (10 runs, 0 failures)

- [ ] **Step 6: Commit**

```bash
cd /Users/khalid/Work/atlas-api
git add app/services/leads/cobroke_matcher.rb test/services/leads/cobroke_matcher_test.rb test/fixtures/listings.yml
git commit -m "Match a twin lead against other agents' co-broke inventory"
```

---

### Task 3: Wire the matcher into scoring and expose it on the lead

**Files:**
- Modify: `atlas-api/app/services/ai/twin/lead_scorer.rb`
- Modify: `atlas-api/app/serializers/lead_serializer.rb`

**Interfaces:**
- Consumes: `Leads::CobrokeMatcher.for(lead)` (Task 2).
- Produces: `lead.payload["cobroke"] = {"matched_at" => iso8601, "listings" => [...]}`, and serializer key `ai_twin_cobroke` (Task 4's serializer edit touches a different method in the same file).

- [ ] **Step 1: Write the failing serializer test**

Create `atlas-api/test/serializers/lead_serializer_cobroke_test.rb`:

```ruby
require "test_helper"

class LeadSerializerCobrokeTest < ActiveSupport::TestCase
  def twin_lead(payload)
    Lead.create!(
      buyer_name: "Tan Wei",
      buyer_phone_number: "60123456789",
      type_id: Lead::RESALE,
      status_id: Lead::NEW,
      source_id: Lead::AI_TWIN,
      user_id: users(:test_agent).id,
      payload: payload
    )
  end

  def rendered(lead)
    LeadSerializer.new(lead, view_as: :show).as_json.deep_stringify_keys
  end

  test "co-broke matches are exposed on a twin lead" do
    lead = twin_lead(
      "cobroke" => {
        "matched_at" => "2026-08-17T09:41:00Z",
        "listings" => [{ "id" => 1, "property_name" => "Riverson Suites",
                         "agent_name" => "Amy Lee", "agent_phone" => "60111111111" }]
      }
    )

    assert_equal 1, rendered(lead).dig("ai_twin_cobroke", "listings").size
    assert_equal "Amy Lee", rendered(lead).dig("ai_twin_cobroke", "listings", 0, "agent_name")
  end

  test "no key when nothing matched" do
    assert_nil rendered(twin_lead({}))["ai_twin_cobroke"]
  end

  test "not rendered for non-twin leads" do
    lead = twin_lead("cobroke" => { "listings" => [{ "id" => 1 }] })
    lead.update!(source_id: Lead::DIGITAL_MARKETING)

    assert_nil rendered(lead)["ai_twin_cobroke"]
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/khalid/Work/atlas-api && bin/rails test test/serializers/lead_serializer_cobroke_test.rb
```
Expected: FAIL — `ai_twin_cobroke` is nil in the first test

- [ ] **Step 3: Add the serializer key**

In `atlas-api/app/serializers/lead_serializer.rb`, extend the existing twin block (around line 71):

```ruby
  show_if ->(model, options) { options[:view_as] == :show && model.ai_twin? } do
    serialize :ai_twin_conversation
    serialize :ai_twin_nurture
    serialize :ai_twin_cobroke
  end
```

Then add the method next to `ai_twin_nurture`:

```ruby
  # Listings from OTHER agents that fit this buyer, found by
  # Leads::CobrokeMatcher at scoring time. Carries the owning agent's contact
  # details — this side is for the agent, not the buyer, who is never told
  # whose listing it is.
  def ai_twin_cobroke
    cobroke = model.payload.is_a?(Hash) ? model.payload["cobroke"] : nil
    return nil unless cobroke.is_a?(Hash) && cobroke["listings"].present?

    {
      matched_at: cobroke["matched_at"],
      listings: cobroke["listings"]
    }
  end
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/khalid/Work/atlas-api && bin/rails test test/serializers/lead_serializer_cobroke_test.rb
```
Expected: PASS (3 runs, 0 failures)

- [ ] **Step 5: Invoke the matcher from the scorer**

In `atlas-api/app/services/ai/twin/lead_scorer.rb`, at the end of `apply_verdict`, after the existing priority update:

```ruby
          returning = @lead.twin_chat_sessions.count > 1
          @lead.update!(priority_id: ::Leads::TwinPriority.for(@lead.reload, returning: returning))

          match_cobroke_inventory
```

And add the private method:

```ruby
        # Runs after the verdict has landed, so it matches on the target city,
        # category and budget this pass just extracted. Failure here costs the
        # agent a nice-to-have, never the scoring that preceded it.
        def match_cobroke_inventory
          matches = ::Leads::CobrokeMatcher.for(@lead.reload)
          return if matches.empty?

          payload = @lead.payload.is_a?(Hash) ? @lead.payload : {}
          @lead.update!(
            payload: payload.merge(
              "cobroke" => { "matched_at" => Time.current.iso8601, "listings" => matches }
            )
          )
        rescue StandardError => e
          Rails.logger.error("[Ai::Twin::LeadScorer] Lead #{@lead.id}: co-broke match failed: #{e.message}")
        end
```

- [ ] **Step 6: Run the full twin-related suite**

```bash
cd /Users/khalid/Work/atlas-api && bin/rails test test/services/leads test/services/ai/twin test/serializers
```
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
cd /Users/khalid/Work/atlas-api
git add app/services/ai/twin/lead_scorer.rb app/serializers/lead_serializer.rb test/serializers/lead_serializer_cobroke_test.rb
git commit -m "Record co-broke matches on a scored twin lead"
```

---

### Task 4: Scorer records the affordability verdict

The scorer reports whether an affordability check happened and what it produced; when the buyer never stated a budget, the derived maximum becomes one. That alone lifts the lead's priority to HIGH through the **existing** `TwinPriority` rules — no priority-rule changes.

**Files:**
- Modify: `atlas-api/app/services/ai/twin/lead_scorer.rb`
- Modify: `atlas-api/app/serializers/lead_serializer.rb`
- Create: `atlas-api/test/services/ai/twin/lead_scorer_financing_test.rb`

**Interfaces:**
- Consumes: verdict key `financing` — `{"checked" => bool, "max_property_price" => String, "monthly_instalment" => String}`. Task 8 adds the identical field to agent-x's scorer instructions.
- Produces: `lead.budget` filled as `"up to ~RM<n> (affordability check)"`; `payload["twin_scoring"]["financing"]`; serializer `ai_twin_conversation.extracted.financing`.

- [ ] **Step 1: Write the failing test**

Create `atlas-api/test/services/ai/twin/lead_scorer_financing_test.rb`:

```ruby
require "test_helper"

module Ai
  module Twin
    class LeadScorerFinancingTest < ActiveSupport::TestCase
      def lead(**attrs)
        Lead.create!(
          {
            buyer_name: "Tan Wei",
            buyer_phone_number: "60123456789",
            type_id: Lead::RESALE,
            status_id: Lead::NEW,
            source_id: Lead::AI_TWIN,
            user_id: users(:test_agent).id
          }.merge(attrs)
        )
      end

      def apply(lead, financing)
        scorer = LeadScorer.allocate
        scorer.instance_variable_set(:@lead, lead)
        scorer.instance_variable_set(:@errors, [])
        scorer.send(:apply_verdict, {
          "qualified" => true, "summary" => "Wants a condo in KK.",
          "financing" => financing
        })
        lead.reload
      end

      test "an affordability check fills a missing budget" do
        result = apply(lead, { "checked" => true, "max_property_price" => "RM610,000",
                               "monthly_instalment" => "RM2,900" })

        assert_equal "up to ~RM610,000 (affordability check)", result.budget
      end

      # That derived budget is what lifts the lead through the existing rules.
      test "the derived budget lifts priority to high" do
        result = apply(lead, { "checked" => true, "max_property_price" => "RM610,000",
                               "monthly_instalment" => "RM2,900" })

        assert_equal Lead::HIGH, result.priority_id
      end

      test "a budget the buyer stated themselves is never overwritten" do
        result = apply(lead(budget: "around RM400k"),
                       { "checked" => true, "max_property_price" => "RM610,000" })

        assert_equal "around RM400k", result.budget
      end

      test "no check means no budget invented" do
        result = apply(lead, { "checked" => false, "max_property_price" => "" })

        assert_predicate result.budget, :blank?
      end

      test "the verdict is kept for the agent to see" do
        result = apply(lead, { "checked" => true, "max_property_price" => "RM610,000",
                               "monthly_instalment" => "RM2,900" })

        assert_equal "RM610,000", result.payload.dig("twin_scoring", "financing", "max_property_price")
      end

      test "a missing financing key is treated as no check" do
        result = apply(lead, nil)

        assert_predicate result.budget, :blank?
      end
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/khalid/Work/atlas-api && bin/rails test test/services/ai/twin/lead_scorer_financing_test.rb
```
Expected: FAIL — budget stays blank

- [ ] **Step 3: Extend the scoring instruction**

In `atlas-api/app/services/ai/twin/lead_scorer.rb`, update `SCORING_INSTRUCTION`'s JSON shape and add its description. Replace the schema line and append the explanation:

```ruby
      SCORING_INSTRUCTION = <<~PROMPT
        Score this property-enquiry conversation between a buyer and a real
        estate agent's AI assistant. Reply with ONLY a JSON object:
        {"qualified": true/false, "budget": "", "purchase_timing": "",
         "motivation": "", "listing_id": null, "target_city": "",
         "target_state": "", "target_country": "", "property_category": "",
         "language": "", "intent": "",
         "financing": {"checked": false, "max_property_price": "",
                       "monthly_instalment": ""},
         "summary": ""}
        qualified: does the buyer show genuine, actionable intent?
        budget/purchase_timing/motivation: extract if stated, else "".
        listing_id: the numeric id of the listing discussed, if identifiable.
        target_city/target_state/target_country: where they want to BUY or
        RENT, not where they live. Fill state/country when they follow clearly
        from the city; otherwise "".
        property_category: the kind of property sought, in their own words
        (e.g. condominium, landed house, industrial land, shop lot), else "".
        language: the language the buyer wrote in, else "".
        intent: "rent" if they want to rent, "buy" if they want to purchase,
        else "".
        financing: set checked to true ONLY if an affordability or loan
        eligibility check actually ran in this conversation. When it did,
        copy the maximum property price and monthly instalment figures the
        assistant gave, as written. Otherwise leave checked false and the
        figures "".
        summary: 2-3 sentences an agent can act on.
      PROMPT
```

- [ ] **Step 4: Apply the financing verdict**

In the same file, inside `apply_verdict`, immediately before the `payload` merge:

```ruby
          # An affordability check is the only place a budget may be derived
          # rather than quoted: it is the buyer's own figures run through
          # Atlas's calculator, and it is labelled so nobody mistakes it for
          # something the buyer said. Downstream, TwinPriority reads it like
          # any other budget — which is the point.
          financing = verdict["financing"]
          if @lead.budget.blank? && financing.is_a?(Hash) &&
             financing["checked"] && financing["max_property_price"].present?
            updates[:budget] = "up to ~#{financing['max_property_price']} (affordability check)"
          end
```

- [ ] **Step 5: Expose it on the serializer**

In `atlas-api/app/serializers/lead_serializer.rb`, inside `ai_twin_conversation`'s `extracted` hash:

```ruby
      extracted: {
        budget: model.budget.presence,
        purchase_timing: model.purchase_timing.presence,
        motivation: model.motivation.presence,
        financing: twin_financing
      },
```

And add the private helper beside `twin_messages_for`:

```ruby
  # Only present once an affordability check actually ran — the frontend
  # renders the panel on presence, so an unchecked lead must return nil
  # rather than an empty shell.
  def twin_financing
    scoring = model.payload.is_a?(Hash) ? model.payload["twin_scoring"] : nil
    financing = scoring.is_a?(Hash) ? scoring["financing"] : nil
    return nil unless financing.is_a?(Hash) && financing["checked"]

    {
      max_property_price: financing["max_property_price"].presence,
      monthly_instalment: financing["monthly_instalment"].presence
    }
  end
```

- [ ] **Step 6: Run tests**

```bash
cd /Users/khalid/Work/atlas-api && bin/rails test test/services/ai/twin test/serializers test/services/leads
```
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
cd /Users/khalid/Work/atlas-api
git add app/services/ai/twin/lead_scorer.rb app/serializers/lead_serializer.rb test/services/ai/twin/lead_scorer_financing_test.rb
git commit -m "Record the twin's affordability check on the lead"
```

---

### Task 5: `check_loan_eligibility` tool (agent-x)

**Files:**
- Modify: `agent-x/tools/twin_calculators.py`
- Modify: `agent-x/tools/twin_toolkit.py`

**Interfaces:**
- Consumes: existing `_post(endpoint, payload)` helper in `twin_calculators.py`.
- Produces: `check_loan_eligibility` (Agno tool), exported in `TWIN_CALCULATOR_TOOLS`. Task 7 registers it in `TWIN_TOOLS`; Task 8's prompt rule governs when it is called.

- [ ] **Step 1: Switch to the branch**

```bash
cd /Users/khalid/Work/agent-x
git status --short          # expect only the pre-existing uv.lock diff
git stash -u                # it is not ours to carry onto lead-engine
git checkout lead-engine
```

- [ ] **Step 2: Add the endpoint constant**

In `agent-x/tools/twin_calculators.py`, beside the existing endpoints:

```python
MORTGAGE_ENDPOINT = "/api/web/calculate/mortgage"
RENTAL_YIELD_ENDPOINT = "/api/web/calculate/rental_yield"
ELIGIBILITY_ENDPOINT = "/api/web/calculate/eligibility"
```

- [ ] **Step 3: Add the tool**

Append to `agent-x/tools/twin_calculators.py`, before the `TWIN_CALCULATOR_TOOLS` list:

```python
@tool(
    name="check_loan_eligibility",
    description=(
        "Estimate how large a home loan a buyer could qualify for, using "
        "Atlas's official eligibility calculator — the same one on IQI's "
        "website. Use it ONLY when the buyer has agreed to an affordability "
        "check and has given their monthly take-home income. Approximate "
        "figures are fine; never press for exact ones."
    ),
)
async def check_loan_eligibility(
    monthly_net_income: float,
    existing_monthly_loan_repayment: float = 0.0,
    outstanding_credit_card_balance: float = 0.0,
    annual_interest_rate: float = DEFAULT_INTEREST_RATE,
    tenure_years: int = DEFAULT_ELIGIBILITY_TENURE_YEARS,
) -> str:
    """
    Indicative maximum loan and property price for a buyer.

    Args:
        monthly_net_income: Take-home pay per month in MYR.
        existing_monthly_loan_repayment: Car, personal and other loan
            repayments per month in MYR.
        outstanding_credit_card_balance: Outstanding card balance in MYR.
        annual_interest_rate: Annual rate as a percentage.
        tenure_years: Loan tenure in years.

    Returns:
        Maximum loan, maximum property price and monthly instalment, with the
        assumptions and the caveat that a bank's own assessment governs.
    """
    result = await _post(
        ELIGIBILITY_ENDPOINT,
        {
            "monthly_net_income": float(monthly_net_income),
            "existing_monthly_loan_repayment": float(existing_monthly_loan_repayment),
            "outstanding_credit_card_balance": float(outstanding_credit_card_balance),
            "interest_rate": float(annual_interest_rate),
            "loan_tenure_years": int(tenure_years),
        },
    )

    if not result:
        return (
            "I couldn't reach the affordability calculator just now. Offer to "
            "have the agent work it through with them instead."
        )

    max_loan = result.get("maximum_loan_amount") or 0
    max_property = result.get("maximum_property_amount") or 0
    instalment = result.get("monthly_instalment_amount") or 0

    if max_loan <= 0:
        return (
            "On those figures the existing commitments already absorb the "
            "income a bank would lend against, so this calculator returns no "
            "borrowing capacity. Say so gently and without judgement, avoid "
            "any suggestion they were rejected — this is not a bank decision "
            "— and offer to have the agent talk options through with them."
        )

    return (
        f"On RM {float(monthly_net_income):,.0f}/month take-home with "
        f"RM {float(existing_monthly_loan_repayment):,.0f} of monthly "
        f"commitments, over {int(tenure_years)} years at {annual_interest_rate}% "
        f"p.a.: indicative maximum loan **RM {max_loan:,.0f}**, which supports "
        f"a property of about **RM {max_property:,.0f}**, at roughly "
        f"**RM {instalment:,.0f} per month**. "
        "Present these as indicative only — the bank's own assessment of their "
        "income, commitments and credit history is what actually decides, and "
        "you are not offering financial advice or an approval."
    )
```

Add the tenure default beside the existing defaults near the top of the file:

```python
DEFAULT_TENURE_YEARS = 30
# Eligibility is usually quoted on the longest tenure a buyer can take, since
# that is what maximises the figure a bank will lend.
DEFAULT_ELIGIBILITY_TENURE_YEARS = 35
```

And extend the export at the bottom:

```python
TWIN_CALCULATOR_TOOLS = [calculate_mortgage, calculate_rental_yield, check_loan_eligibility]
```

- [ ] **Step 4: Register the tool**

In `agent-x/tools/twin_toolkit.py`, update the import and the list:

```python
from tools.twin_calculators import calculate_mortgage, calculate_rental_yield, check_loan_eligibility
```

Add to `TWIN_TOOLS` after `calculate_rental_yield`:

```python
    calculate_rental_yield,
    # Screens the deal-killer before the agent ever picks up the phone: a
    # buyer whose loan will not clear costs an agent months. Calls Atlas's own
    # eligibility calculator, so the figure matches IQI's website.
    check_loan_eligibility,
```

- [ ] **Step 5: Verify the tool loads and the endpoint answers**

```bash
cd /Users/khalid/Work/agent-x
uv run python -c "
from tools.twin_toolkit import TWIN_TOOLS
names = [t.name for t in TWIN_TOOLS]
assert 'check_loan_eligibility' in names, names
print('registered:', names)
"
```
Expected: prints the list including `check_loan_eligibility`

```bash
curl -s -X POST https://atlas-api-8.staging.iqiglobal.com/api/web/calculate/eligibility \
  -H 'Content-Type: application/json' \
  -d '{"monthly_net_income":8000,"existing_monthly_loan_repayment":1200,"outstanding_credit_card_balance":0,"interest_rate":4.0,"loan_tenure_years":35}' \
  | python3 -m json.tool | head -20
```
Expected: JSON containing `maximum_loan_amount`, `maximum_property_amount`, `monthly_instalment_amount`

- [ ] **Step 6: Commit**

```bash
cd /Users/khalid/Work/agent-x
git add tools/twin_calculators.py tools/twin_toolkit.py
git commit -m "Let the twin check what a buyer could borrow"
```

---

### Task 6: `search_network_listings` tool (agent-x)

**Files:**
- Modify: `agent-x/tools/twin_listing_search.py`
- Modify: `agent-x/tools/twin_toolkit.py`
- Create: `agent-x/tests/test_twin_tools.py`

**Interfaces:**
- Consumes: `_resolve_twin_agent_id`, `_resolve_category`, `_format_price`, `SUBSALES_ENDPOINT`, `SALE`, `RENT` (all existing in `twin_listing_search.py`).
- Produces: `search_network_listings` (Agno tool) and pure helper `_format_network_listing(listing: dict) -> str`, which Task 6's tests assert never emits agent identity.

- [ ] **Step 1: Write the failing test**

Create `agent-x/tests/test_twin_tools.py`:

```python
"""
Pure-logic tests for the twin's network listing search. No network calls —
these cover formatting and, critically, that the owning agent's identity
never reaches the buyer.

Run with: uv run --with pytest pytest tests/test_twin_tools.py -v
"""

from tools.twin_listing_search import _format_network_listing


def _listing(**overrides):
    listing = {
        "id": 4210,
        "property_name": "Riverson Suites",
        "township": "Kota Kinabalu",
        "type_id": 1,
        "asking_price_amount": 450000,
        "currency": "MYR",
        "bedrooms": 3,
        "bathrooms": 2,
        # /api/web/subsales index embeds the owning agent — the whole point of
        # a separate formatter is that none of this escapes to the buyer.
        "user": {
            "display_name": "Amy Lee",
            "email": "amy@iqiglobal.com",
            "mobile_contact_number": "60111111111",
        },
    }
    listing.update(overrides)
    return listing


class TestFormatNetworkListing:
    def test_includes_the_property_facts(self):
        line = _format_network_listing(_listing())
        assert "Riverson Suites" in line
        assert "Kota Kinabalu" in line
        assert "450,000" in line

    def test_never_leaks_the_owning_agent(self):
        line = _format_network_listing(_listing())
        for secret in ("Amy Lee", "amy@iqiglobal.com", "60111111111"):
            assert secret not in line

    def test_omits_agent_even_when_nested_differently(self):
        line = _format_network_listing(_listing(user={"display_name": "Bob Tan"}))
        assert "Bob Tan" not in line

    def test_rental_price_is_labelled_per_month(self):
        line = _format_network_listing(
            _listing(type_id=2, asking_price_amount=2500)
        )
        assert "/month" in line

    def test_missing_fields_do_not_crash(self):
        line = _format_network_listing({"id": 1})
        assert isinstance(line, str) and line
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/khalid/Work/agent-x && uv run --with pytest pytest tests/test_twin_tools.py -v
```
Expected: FAIL — `ImportError: cannot import name '_format_network_listing'`

- [ ] **Step 3: Add the formatter and the tool**

Append to `agent-x/tools/twin_listing_search.py`:

```python
def _format_network_listing(listing: Dict[str, Any]) -> str:
    """
    Format a listing owned by ANOTHER agent, for the buyer to read.

    Separate from _format_listing on purpose: /api/web/subsales embeds the
    owning agent in each record, and the buyer must never see whose listing
    it is. Whose stock this is belongs on the lead in Atlas, where the
    profile agent can act on it — not in the chat, where it would hand the
    buyer a different agent to call.
    """
    name = listing.get("property_name") or listing.get("address") or "Unnamed listing"
    township = listing.get("township") or (listing.get("state") or {}).get("name") or ""
    kind = "For rent" if listing.get("type_id") == RENT else "For sale"

    rooms: List[str] = []
    for label, key in (("bed", "bedrooms"), ("bath", "bathrooms")):
        value = listing.get(key)
        if value and str(value) != "N/A" and str(value).isdigit() and int(value) > 0:
            rooms.append(f"{value} {label}")

    parts = [name]
    if township:
        parts.append(township)
    parts.append(kind)
    parts.append(_format_price(listing))
    if rooms:
        parts.append(" ".join(rooms))

    return f"- {' | '.join(parts)}"


@tool(
    name="search_network_listings",
    description=(
        "Search OTHER IQI agents' listings that are open to internal "
        "co-broking. Use it ONLY after search_agent_listings has come back "
        "with nothing suitable — this agent's own stock always comes first. "
        "Results are presented as options this agent can arrange through "
        "IQI's network; never name or hint at the agent who owns them."
    ),
)
async def search_network_listings(
    township: Optional[str] = None,
    listing_type: Optional[str] = None,
    property_category: Optional[str] = None,
    min_price_myr: Optional[int] = None,
    max_price_myr: Optional[int] = None,
    bedrooms: Optional[int] = None,
    limit: int = 5,
) -> str:
    """
    Search co-broke-enabled listings across other IQI agents.

    Args:
        township: Township or area name (e.g. "Kota Kinabalu").
        listing_type: "sale" or "rent". Omit to include both.
        property_category: The kind of property in the buyer's own words.
        min_price_myr: Minimum price in MYR (monthly rent for rentals).
        max_price_myr: Maximum price in MYR (monthly rent for rentals).
        bedrooms: Minimum number of bedrooms.
        limit: Maximum listings to return (default 5).

    Returns:
        A compact list with no agent attribution, or a message saying none
        matched.
    """
    try:
        agent_id = _resolve_twin_agent_id()
    except TwinScopeError as e:
        logger.error("[twin] %s", e)
        return (
            "I can't look that up right now. Please leave your contact details "
            "and the agent will follow up personally."
        )

    limit = max(1, min(int(limit or 5), MAX_LIMIT))

    # open_for_internal_co_broke is the consent flag: only listings whose
    # owning agent opted into internal co-broking may be surfaced here.
    params: Dict[str, Any] = {
        "q[open_for_internal_co_broke_eq]": "true",
        "per_page": 50,
        "page": 1,
    }

    # NOTE: q[combined_search] is NOT used — no such ransacker exists in
    # atlas-api and Ransack silently drops unknown conditions, so it filters
    # nothing. township_cont is a real ransackable attribute.
    if township:
        params["q[township_cont]"] = township
    if listing_type:
        normalized = str(listing_type).strip().lower()
        if normalized.startswith("rent"):
            params["q[type_id_eq]"] = RENT
        elif normalized.startswith("sale") or normalized.startswith("buy"):
            params["q[type_id_eq]"] = SALE

    category_id = _resolve_category(property_category)
    if category_id:
        params["q[category_id_eq]"] = category_id

    base_url = agno_env.getenv("ATLAS_API_URL", "https://api.iqiglobal.com").rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{base_url}{SUBSALES_ENDPOINT}",
                params=params,
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as e:
        logger.error("[twin] network listing search failed: %s", e)
        return (
            "I couldn't reach the listing system just now. Please leave your "
            "contact details and the agent will get back to you."
        )

    listings = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(listings, list):
        listings = []

    def matches(listing: Dict[str, Any]) -> bool:
        # The agent's own listings are search_agent_listings' job; showing
        # them here would double-count what the buyer has already seen.
        if str(listing.get("user", {}).get("id", "")) == str(agent_id):
            return False
        price = listing.get("asking_price_amount") or 0
        if min_price_myr and price < min_price_myr:
            return False
        if max_price_myr and price and price > max_price_myr:
            return False
        if bedrooms:
            beds = listing.get("bedrooms")
            if not (beds and str(beds).isdigit() and int(beds) >= int(bedrooms)):
                return False
        return True

    filtered = [l for l in listings if isinstance(l, dict) and matches(l)][:limit]

    if not filtered:
        return (
            "Nothing in the wider IQI network matches those criteria right now "
            "either. Offer to pass the buyer's requirements to the agent, who "
            "can keep an eye out."
        )

    lines = [
        f"{len(filtered)} option(s) available through IQI's network (NOT this "
        "agent's own listings). Present them as properties this agent can "
        "arrange through the IQI network. NEVER name or describe the agent "
        "who holds them — the buyer deals with this agent only:"
    ]
    lines += [_format_network_listing(l) for l in filtered]

    return "\n".join(lines)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/khalid/Work/agent-x && uv run --with pytest pytest tests/test_twin_tools.py -v
```
Expected: PASS (5 passed)

- [ ] **Step 5: Register the tool**

In `agent-x/tools/twin_toolkit.py`, update the import:

```python
from tools.twin_listing_search import search_agent_listings, search_network_listings
```

And add to `TWIN_TOOLS`, directly after `search_agent_listings`:

```python
    search_agent_listings,
    # Only reached when the agent's own stock has nothing: demand that would
    # otherwise die at one agent's inventory limit gets matched against
    # colleagues who opted their listings into internal co-broking.
    search_network_listings,
```

- [ ] **Step 6: Verify registration**

```bash
cd /Users/khalid/Work/agent-x
uv run python -c "
from tools.twin_toolkit import TWIN_TOOLS
names = [t.name for t in TWIN_TOOLS]
assert 'search_network_listings' in names, names
print('registered:', names)
"
```
Expected: prints the list including `search_network_listings`

- [ ] **Step 7: Commit**

```bash
cd /Users/khalid/Work/agent-x
git add tools/twin_listing_search.py tools/twin_toolkit.py tests/test_twin_tools.py
git commit -m "Let the twin offer co-broke stock when the agent has none"
```

---

### Task 7: Prompt rules (agent-x)

Tools exist; nothing tells the twin when to use them. This task adds the governing rules and the scorer's matching schema change.

**Files:**
- Modify: `agent-x/prompts/twin_instructions.py`

**Interfaces:**
- Consumes: tool names `check_loan_eligibility` (Task 5), `search_network_listings` (Task 6).
- Produces: scorer `financing` field matching Task 4's `SCORING_INSTRUCTION` **exactly**.

- [ ] **Step 1: Add the affordability rule**

In `agent-x/prompts/twin_instructions.py`, inside `TWIN_INSTRUCTIONS`, immediately after the `WHERE THEY ARE BASED` entry:

```python
    "AFFORDABILITY CHECK: a loan that does not clear is what kills Malaysian "
    "property deals late, so it is worth screening early — but gently. Once a "
    "buyer is clearly looking to BUY (they named a budget, asked about a "
    "specific sale listing, or filled in the buying template), you may offer "
    "ONCE: 'Want a quick check on roughly what loan amount you'd likely "
    "qualify for? I'd just need your monthly take-home income and any existing "
    "loan commitments — no documents.' Never offer it for rentals, and never "
    "before you have helped with what they actually asked.",

    "If they accept, take approximate figures happily — 'about 8k', 'roughly "
    "1,200 in car loan' is plenty — and call check_loan_eligibility. Never "
    "press for exact numbers, payslips or documents, and never ask a second "
    "time if they decline or ignore the offer. A buyer who says no must be "
    "helped exactly as well as one who says yes.",

    "Always present the result as indicative: it is a calculator, not a bank "
    "decision and not an approval. Say plainly that the bank's own assessment "
    "of their income, commitments and credit history is what decides. If the "
    "figure comes back at zero or very low, say so kindly and without "
    "judgement, never as a rejection, and offer to have the agent talk options "
    "through. Never give personalised financial advice, never recommend a "
    "specific bank or loan product, and never state an affordability figure "
    "you did not get from check_loan_eligibility.",
```

- [ ] **Step 2: Add the network-search rule**

Immediately after the `SEARCH BEATS TEMPLATE` entry:

```python
    "OWN INVENTORY FIRST, THEN THE NETWORK: always search this agent's own "
    "listings first with search_agent_listings. Only when that returns nothing "
    "suitable may you call search_network_listings, which finds properties "
    "other IQI agents have opened to internal co-broking. Never call it first, "
    "and never call it to pad out results that already answered the question.",

    "Present anything from the network as this agent's reach, because that is "
    "what it is: '{agent} doesn't have a 3-bed in Luyang listed right now, but "
    "through IQI's network he can arrange these two.' NEVER name, describe or "
    "hint at the agent who holds the listing, never suggest the buyer contact "
    "anyone else, and never imply {agent} is handing them off. The buyer deals "
    "with {agent}; the rest is IQI's plumbing and none of their concern.",
```

- [ ] **Step 3: Add the scorer's financing field**

In the same file, in `TWIN_SCORER_INSTRUCTIONS`, replace the JSON-shape entry:

```python
    'The exact shape is: {"qualified": boolean, "budget": string, '
    '"purchase_timing": string, "motivation": string, "listing_id": number or '
    'null, "target_city": string, "target_state": string, '
    '"target_country": string, "property_category": string, '
    '"language": string, "intent": string, "financing": {"checked": boolean, '
    '"max_property_price": string, "monthly_instalment": string}, '
    '"summary": string}',
```

And add, immediately after the `intent` entry:

```python
    "financing: set checked to true ONLY when an affordability or loan "
    "eligibility check actually ran in the transcript. When it did, copy the "
    "maximum property price and the monthly instalment the assistant quoted, "
    "exactly as written ('RM 610,000'). When no check ran, leave checked "
    "false and both figures empty strings — never estimate them yourself.",
```

- [ ] **Step 4: Verify the prompts still load**

```bash
cd /Users/khalid/Work/agent-x
uv run python -c "
from prompts.twin_instructions import TWIN_INSTRUCTIONS, TWIN_SCORER_INSTRUCTIONS
joined = ' '.join(TWIN_INSTRUCTIONS)
assert 'check_loan_eligibility' in joined
assert 'search_network_listings' in joined
assert 'financing' in ' '.join(TWIN_SCORER_INSTRUCTIONS)
print(f'{len(TWIN_INSTRUCTIONS)} twin rules, {len(TWIN_SCORER_INSTRUCTIONS)} scorer rules')
"
```
Expected: prints the counts without error

- [ ] **Step 5: Confirm the two scorer schemas match**

The JSON shape now appears in `agent-x/prompts/twin_instructions.py` and `atlas-api/app/services/ai/twin/lead_scorer.rb`. Read both and confirm the key list is identical — a mismatch means the scorer returns fields the parser ignores, silently.

```bash
cd /Users/khalid/Work/agent-x && grep -n "financing" prompts/twin_instructions.py
cd /Users/khalid/Work/atlas-api && grep -n "financing" app/services/ai/twin/lead_scorer.rb
```
Expected: both declare `checked`, `max_property_price`, `monthly_instalment`

- [ ] **Step 6: Commit**

```bash
cd /Users/khalid/Work/agent-x
git add prompts/twin_instructions.py
git commit -m "Teach the twin when to check affordability and when to widen the search"
```

---

### Task 8: End-to-end verification and push

**Files:** none modified — verification only.

- [ ] **Step 1: Full atlas-api suite**

```bash
cd /Users/khalid/Work/atlas-api && bin/rails test
```
Expected: PASS. Baseline before this plan was 366 tests; this plan adds 26 (7 parser + 10 matcher + 3 serializer + 6 scorer). Investigate any failure before continuing.

- [ ] **Step 2: Full agent-x unit suite**

```bash
cd /Users/khalid/Work/agent-x && uv run --with pytest pytest tests/ -v
```
Expected: PASS, including the new `tests/test_twin_tools.py`

- [ ] **Step 3: Live conversation — affordability**

Start agent-x locally against staging (`ATLAS_API_URL=https://atlas-api-8.staging.iqiglobal.com`) and run a twin conversation that establishes buy intent, e.g. "I'm looking to buy a condo in Kota Kinabalu, budget around RM500k."

Confirm by reading the reply and the tool-call log:
- the twin offers the affordability check once, and only after helping
- accepting it and giving "about 8k a month, 1.2k car loan" triggers `check_loan_eligibility`
- the figures match the `curl` from Task 5 Step 5 for the same inputs
- the reply says the figures are indicative and does not claim approval
- declining the offer ends it — the twin does not raise it again

- [ ] **Step 4: Live conversation — co-broke**

Ask for something the profile agent does not list (e.g. a township absent from their inventory).

Confirm:
- `search_agent_listings` is called first and returns nothing
- only then is `search_network_listings` called
- the reply frames results as "{agent} can arrange through IQI's network"
- **no** other agent's name, phone or email appears anywhere in the reply

- [ ] **Step 5: Verify the lead in Atlas**

Finalize the session, then inspect the resulting lead:

```bash
cd /Users/khalid/Work/atlas-api
bin/rails runner '
lead = Lead.where(source_id: Lead::AI_TWIN).order(:id).last
puts "priority:  #{Lead::PRIORITY_TYPES[lead.priority_id]}"
puts "type:      #{Lead::TYPES[lead.type_id]}"
puts "budget:    #{lead.budget.inspect}"
puts "financing: #{lead.payload.dig("twin_scoring", "financing").inspect}"
puts "cobroke:   #{lead.payload.dig("cobroke", "listings")&.size} match(es)"
'
```
Expected: priority High or better, budget populated (from the buyer or the affordability check), `financing.checked == true`, and co-broke matches present when the network search found any.

- [ ] **Step 6: Push both branches**

```bash
cd /Users/khalid/Work/atlas-api && git push origin lead-engine
cd /Users/khalid/Work/agent-x && git push origin lead-engine
```

- [ ] **Step 7: Restore the agent-x working tree**

```bash
cd /Users/khalid/Work/agent-x
git checkout main
git stash pop      # returns the pre-existing uv.lock diff that was never ours
git status --short # expect only: M uv.lock
```

- [ ] **Step 8: Redeploy staging**

Both features need **both** services redeployed to staging: agent-x for the tools and prompts, atlas-api for the scorer, matcher and serializer. Note this to the user — the deploy is theirs to trigger.

---

## Follow-ups noted, deliberately not in this plan

- **`q[combined_search]` is a no-op.** `tools/twin_listing_search.py` has sent it since the tool was written, but no such ransacker exists in atlas-api and Ransack silently ignores unknown conditions — so `search_agent_listings`' `keyword` argument has never filtered anything. Fixing it means switching to a real predicate such as `q[property_name_or_township_or_address_cont]`. Out of scope here; worth its own small change.
- **Frontend for co-broke and financing.** `docs/atlas-leads-twin-panel-frontend-spec.md` covers the transcript and nurture cards only. `ai_twin_cobroke` and `extracted.financing` need a short addendum before the FE dev picks the work up.
