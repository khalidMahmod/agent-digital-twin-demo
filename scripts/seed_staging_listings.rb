# Seeds an Atlas environment with the two demo agents' listings, so the AI Twin
# has real inventory to answer from.
#
# Self-contained on purpose: atlas-api has no local `staging` database config
# (only default/test — staging reads DATABASE_URL on the server), so this cannot
# be run from a laptop against staging. It has to run ON the staging box, where
# the demo repo's JSON fixtures do not exist. So it fetches its data over HTTP
# and falls back to local fixtures only when they happen to be present.
#
#   # on the staging server, in the atlas-api directory
#   bin/rails runner seed_staging_listings.rb
#
#   # locally against a dev/test DB, if the demo repo is checked out
#   cd ~/Work/atlas-api
#   RAILS_ENV=test bin/rails runner \
#     ~/Work/agent-digital-twin-demo/scripts/seed_staging_listings.rb
#
# Source is Atlas's PUBLIC /api/web/agents/:slug endpoint — data already visible
# on iqiglobal.com. Nothing private is copied and no production DB access is
# needed. Override the source host with SOURCE_API if production is unreachable
# from wherever this runs.
#
# Deliberately does NOT touch users: agents 2287 and 3705 already exist on
# staging with the same ids, and copying production User rows would drag in IC
# numbers, bank details and phone numbers for no benefit. Projects are likewise
# skipped — they have no per-agent ownership in the schema (only creator_id, the
# admin who entered them) and staging already has its own.
#
# Idempotent: listings are matched on their `code`, so re-running updates rather
# than duplicates. Safe to run repeatedly while iterating on a demo.

require "net/http"
require "uri"

FIXTURE_DIR = File.expand_path("../src/data/agents", __dir__)
SOURCE_API = ENV.fetch("SOURCE_API", "https://api.iqiglobal.com").sub(%r{/+\z}, "")
SLUGS = (ENV["SLUGS"].presence&.split(",")&.map(&:strip) ||
         %w[sally-wong-sex-lee stev-yap-wei-chong]).freeze

# Keep the seed small by default: the twin searches rather than recites, so a
# few dozen listings demo just as well as hundreds and import far faster.
# Override with LIMIT=0 to import every listing in the fixture.
LIMIT = Integer(ENV.fetch("LIMIT", "40"))

abort "Refusing to run in production." if Rails.env.production?

# Columns copied verbatim when present in the fixture. Everything Listing
# validates is here (title/furnishing/occupancy/tenure/direction/unit type,
# available_date, car_parks, land_area), which is why the records save cleanly.
DIRECT_COLUMNS = %w[
  property_name address hidden_address township sub_area postal_code
  description zh_description remark
  type_id category_id status_id group_type_id
  title_type_id land_title_type_id furnishing_status_id occupancy_id
  tenure_id direction_id unit_type_id measurement_id
  bedrooms bathrooms car_parks built_up land_area
  asking_price_currency lease_year_if_leasehold available_date
  auction auction_date open_for_internal_co_broke
  youtube_link image_vr_url video_vr_url gmap
].freeze

FACILITY_COLUMNS = %w[
  bbq parking jogging_track playground squash_court tennis_court
  business_centre gymnasium mini_market salon swimming_pool
  all_day_security club_house jacuzzi nursery sauna wading_pool cafetria
].freeze

# Reference ids are resolved rather than copied verbatim: the fixtures carry
# PRODUCTION ids, and there is no guarantee id 12 means Sabah in every
# environment. Where the fixture gives a name (state, country) that wins;
# otherwise the id is used if it resolves, with a warning rather than a hard
# failure so one unmappable lookup doesn't abort the whole seed.
def resolve_country(raw)
  slug = raw.dig("country", "slug")
  id   = raw.dig("country", "id")
  (slug.present? && ::Country.find_by(slug: slug)) || (id && ::Country.find_by(id: id)) || ::Country.first
end

def resolve_state(raw, country)
  name = raw.dig("state", "name")
  id   = raw.dig("state", "id")

  found = (name.present? && ::State.find_by(name: name, country_id: country&.id)) ||
          (name.present? && ::State.find_by(name: name)) ||
          (id && ::State.find_by(id: id))
  return found if found

  # Warn loudly: an unresolved state means a Kota Kinabalu listing filed under
  # whatever state happens to sort first, which is worse than obviously broken.
  fallback = ::State.where(country_id: country&.id).first || ::State.first
  @warned_states ||= {}
  unless @warned_states[name]
    @warned_states[name] = true
    warn "    ~ state #{name.inspect} not in this environment; using #{fallback&.name.inspect} instead"
  end
  fallback
end

def resolve_property_type(raw)
  id = raw["property_type_id"]
  found = id && ::PropertyType.find_by(id: id)
  return found if found

  @property_type_fallback ||= ::PropertyType.first
  @warned_property_type ||= begin
    warn "    ~ property_type_id #{id.inspect} not in this environment; " \
         "falling back to #{@property_type_fallback&.name.inspect} for unmapped types"
    true
  end
  @property_type_fallback
end

def upsert_listing(agent, raw)
  # Keyed on source_listing_id, NOT code: Listing's before_create callback
  # overwrites code with "#{user_id}-#{timestamp}", so a code-based key silently
  # misses on re-run and duplicates the whole set. source_listing_id is the
  # column meant for imported records and nothing rewrites it.
  listing = ::Listing.find_or_initialize_by(user_id: agent.id, source_listing_id: raw["id"])

  DIRECT_COLUMNS.each do |column|
    listing[column] = raw[column] if raw.key?(column) && listing.respond_to?("#{column}=")
  end
  FACILITY_COLUMNS.each do |column|
    listing[column] = !!raw[column] if raw.key?(column) && listing.respond_to?("#{column}=")
  end

  country = resolve_country(raw)
  listing.user_id          = agent.id
  listing.country_id       = country&.id
  listing.state_id         = resolve_state(raw, country)&.id
  listing.property_type_id = resolve_property_type(raw)&.id

  # Copied verbatim, NOT multiplied by 100, despite the column name.
  # Api::Web::ListingSerializer#asking_price_amount is
  #   Money.new(asking_price_cents, currency).fractional
  # and Money#fractional returns its argument unchanged — so the serialized
  # "amount" IS the stored value. The column holds whole ringgit. Scaling it
  # turned a RM 3,500/month rental into RM 350,000/month.
  listing.asking_price_cents = raw["asking_price_amount"].to_f.round
  listing.asking_price_currency = raw["currency"].presence || raw["asking_price_currency"].presence || "MYR"

  # Both must be set or the listing is invisible to /api/web/subsales and to
  # the twin's search, which is the whole point of seeding.
  listing.status_id = ::Listing::ACTIVE
  listing.published_to_iqi = true

  listing.available_date ||= Date.current
  listing.land_area = 0 if listing.land_area.blank?
  listing.car_parks = 0 if listing.car_parks.blank?

  listing.save!
  listing
end

total_created = 0
total_updated = 0

# Local fixture if it happens to be here (fast, offline); otherwise the public
# API, which is what makes this runnable on a server that has no checkout of
# the demo repo.
def load_agent_payload(slug)
  path = File.join(FIXTURE_DIR, "#{slug}.json")
  if File.exist?(path)
    puts "  #{slug}: reading local fixture"
    return JSON.parse(File.read(path))
  end

  url = URI.parse("#{SOURCE_API}/api/web/agents/#{slug}")
  puts "  #{slug}: fetching #{url}"
  response = Net::HTTP.get_response(url)

  unless response.is_a?(Net::HTTPSuccess)
    warn "    ! #{url} returned #{response.code}"
    return nil
  end

  body = JSON.parse(response.body)
  body.is_a?(Hash) ? (body["data"] || body) : nil
rescue StandardError => e
  warn "    ! could not load #{slug}: #{e.class} #{e.message}"
  nil
end

SLUGS.each do |slug|
  data = load_agent_payload(slug)
  next if data.nil? || data["id"].blank?

  agent = ::User.find_by(slug: slug) || ::User.find_by(id: data["id"])

  if agent.nil?
    warn "  ! agent not found for #{slug} (id #{data['id']}) — skipping"
    next
  end

  listings = Array(data["published_listings"])
  listings = listings.first(LIMIT) if LIMIT.positive?

  created = 0
  updated = 0
  failed  = 0

  listings.each do |raw|
    existed = ::Listing.exists?(user_id: agent.id, source_listing_id: raw["id"])
    upsert_listing(agent, raw)
    existed ? updated += 1 : created += 1
  rescue StandardError => e
    failed += 1
    warn "    x listing #{raw['id']} (#{raw['property_name']}): #{e.message}"
  end

  total_created += created
  total_updated += updated

  active = ::Listing.where(user_id: agent.id, status_id: ::Listing::ACTIVE, published_to_iqi: true).count
  puts "  #{slug} (user #{agent.id}): +#{created} new, #{updated} updated, #{failed} failed — #{active} now active"
end

puts
puts "Done: #{total_created} created, #{total_updated} updated."
puts "Verify:  curl -s '<atlas-host>/api/web/agents/#{SLUGS.first}' | head -c 300"
