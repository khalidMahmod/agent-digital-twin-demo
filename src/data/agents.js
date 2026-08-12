import sally from './agents/sally-wong-sex-lee.json'
import stev from './agents/stev-yap-wei-chong.json'

// Listing.type_id from atlas-api: 1 = sale, 2 = rent
const SALE = 1
const RENT = 2

function normalizeListing(listing) {
  return {
    id: listing.id,
    name: listing.property_name || listing.address,
    address: listing.address,
    township: listing.township,
    state: listing.state?.name,
    isSale: listing.type_id === SALE,
    isRent: listing.type_id === RENT,
    price: listing.asking_price_amount,
    currency: listing.currency || 'MYR',
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    builtUp: listing.built_up,
    thumbnail: listing.images?.[0]?.medium_url || null,
  }
}

function normalizeAgent(raw) {
  const listings = (raw.published_listings || []).map(normalizeListing)
  const saleCount = listings.filter((l) => l.isSale).length
  const rentCount = listings.filter((l) => l.isRent).length

  return {
    id: raw.id,
    slug: raw.slug,
    fullName: raw.full_name,
    displayName: raw.display_name,
    designation: raw.designation,
    renTag: raw.ren_tag,
    team: raw.team_name,
    branch: raw.branch_name,
    region: raw.branch_region_name,
    country: raw.country,
    description: raw.description,
    avatarUrl: raw.avatar_url,
    viewsCount: raw.views_count,
    yearsOfExperience: raw.profile_summary?.years_of_experience ?? null,
    transactionsCount: raw.profile_summary?.transactions_count ?? null,
    saleCount,
    rentCount,
    totalListings: listings.length,
    listings,
  }
}

export const AGENTS = [normalizeAgent(sally), normalizeAgent(stev)]

export function getAgentBySlug(slug) {
  return AGENTS.find((a) => a.slug === slug)
}
