import { Link } from 'react-router-dom'
import ChatPanel from './ChatPanel'

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-4 py-3 text-center">
      <div className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{value}</div>
      <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
    </div>
  )
}

function ListingCard({ listing }) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden bg-white dark:bg-neutral-900">
      <div className="aspect-[4/3] bg-neutral-100 dark:bg-neutral-800">
        {listing.thumbnail ? (
          <img src={listing.thumbnail} alt={listing.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-400 text-xs">No image</div>
        )}
      </div>
      <div className="p-3 text-left">
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
              listing.isRent
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
            }`}
          >
            {listing.isRent ? 'For Rent' : 'For Sale'}
          </span>
        </div>
        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate" title={listing.name}>
          {listing.name}
        </div>
        <div className="text-xs text-neutral-500 mt-0.5">
          {listing.township || listing.state || ''}
        </div>
        {listing.price ? (
          <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mt-1.5">
            {listing.currency} {listing.price.toLocaleString()}
            {listing.isRent ? '/mo' : ''}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function AgentProfile({ agent }) {
  const visibleListings = agent.listings.slice(0, 12)
  const remaining = agent.totalListings - visibleListings.length

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <Link to="/" className="text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
        &larr; Back to agents
      </Link>

      {/* Header */}
      <div className="flex items-start gap-5 mt-4 mb-6">
        <img
          src={agent.avatarUrl}
          alt={agent.fullName}
          className="w-24 h-24 rounded-full object-cover border border-neutral-200 dark:border-neutral-800 bg-neutral-100"
          onError={(e) => {
            e.target.style.display = 'none'
          }}
        />
        <div className="text-left flex-1">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{agent.fullName}</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            {agent.designation} · {agent.team} Team · {agent.branch}, {agent.country}
          </p>
          {agent.renTag ? (
            <p className="text-xs text-neutral-400 mt-1">REN Tag: {agent.renTag}</p>
          ) : null}
          {agent.description ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-3 max-w-2xl">{agent.description}</p>
          ) : null}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatCard label="Years at IQI" value={agent.yearsOfExperience ?? '—'} />
        <StatCard label="Transactions" value={agent.transactionsCount ?? '—'} />
        <StatCard label="For Sale" value={agent.saleCount} />
        <StatCard label="For Rent" value={agent.rentCount} />
      </div>

      {/* AI Twin — headline feature, inline panel not a floating bubble */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Chat with my AI Twin
          </h2>
          <span className="text-xs text-neutral-500">
            grounded in {agent.totalListings} real listings &amp; {agent.transactionsCount ?? '—'} transactions
          </span>
        </div>
        <ChatPanel agent={agent} />
      </div>

      {/* Listings */}
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-3">
          Active Listings ({agent.totalListings})
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {visibleListings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
        {remaining > 0 ? (
          <p className="text-xs text-neutral-400 mt-3">+ {remaining} more listings not shown</p>
        ) : null}
      </div>
    </div>
  )
}
