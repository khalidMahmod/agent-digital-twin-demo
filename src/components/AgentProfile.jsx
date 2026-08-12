import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ChatPanel from './ChatPanel'

function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

function formatPhone(raw) {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  const cc = digits.slice(0, 2)
  const rest = digits.slice(2).match(/.{1,4}/g) ?? []
  return `+${cc} ${rest.join(' ')}`
}

function displayCurrency(code) {
  return code === 'MYR' ? 'RM' : code
}

function formatDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const ICON = {
  phone: 'M3 3h2.4l1.2 3.2-1.5 1.2a9 9 0 0 0 4.5 4.5l1.2-1.5L14 11.6V14a1 1 0 0 1-1 1C7.5 15 1 8.5 1 3a1 1 0 0 1 1-1h1z',
  mail: 'M1.5 4.5h13v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7Z M2 4.5 8 9l6-4.5',
  bed: 'M5 5.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5 M2 9.5V7a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 7v2.5 M2 9.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5',
  bath: 'M2 9.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5 M2 9.5V7a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 7v2.5',
  years: 'M8 4.5V8l2.5 1.5',
  txn: 'M2 9.5 6 5.5l3 3 5-5 M11 3.5h3v3',
  sale: 'M2 8.5 8 3l6 5.5 M4 7.5V13h8V7.5',
  rent: 'M2.5 6.5h11',
}

function Icon({ path, className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className}>
      <path d={path} />
    </svg>
  )
}

function Avatar({ agent, size = 'w-32 h-32', textSize = 'text-3xl' }) {
  const [failed, setFailed] = useState(false)
  if (agent.avatarUrl && !failed) {
    return (
      <img
        src={agent.avatarUrl}
        alt={agent.fullName}
        className={`${size} rounded-xl object-cover flex-shrink-0`}
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div
      className={`${size} rounded-xl flex-shrink-0 flex items-center justify-center ${textSize} font-extrabold text-iqi-ink-dim bg-gradient-to-br from-neutral-700 to-neutral-900`}
    >
      {initials(agent.displayName)}
    </div>
  )
}

function StatItem({ colorClass, icon, value, label }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className={`w-9 h-9 rounded-full flex items-center justify-center text-white ${colorClass}`}>
        <Icon path={icon} className="w-4 h-4" />
      </span>
      <span className="text-xs font-semibold text-iqi-ink-dim text-center leading-tight tabular-nums">
        {value}
      </span>
      <span className="text-[10px] text-iqi-ink-faint text-center leading-tight -mt-1">{label}</span>
    </div>
  )
}

function ListingCard({ listing }) {
  const [failed, setFailed] = useState(false)
  const showImage = listing.thumbnail && !failed

  return (
    <div className="rounded-2xl border border-iqi-line bg-iqi-surface overflow-hidden shadow-lg shadow-black/20">
      <div className="relative aspect-[4/3] bg-gradient-to-br from-neutral-700 to-neutral-900">
        {showImage ? (
          <img
            src={listing.thumbnail}
            alt={listing.name}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : null}
        <span
          className={`absolute top-2.5 left-2.5 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md text-white ${
            listing.isRent ? 'bg-iqi-rent' : 'bg-iqi-accent'
          }`}
        >
          {listing.isRent ? 'For Rent' : 'For Sale'}
        </span>
      </div>
      <div className="p-3.5 text-left flex flex-col gap-1">
        <div className="text-[13px] font-bold text-iqi-ink truncate" title={listing.name}>
          {listing.name}
        </div>
        <div className="text-[11px] text-iqi-ink-faint truncate">
          {listing.township || listing.state || ''}
        </div>
        <div className="flex gap-3 text-[11px] text-iqi-ink-dim mt-0.5">
          {listing.bedrooms && listing.bedrooms !== 'N/A' ? (
            <span className="flex items-center gap-1">
              <Icon path={ICON.bed} className="w-3 h-3 opacity-75" />
              {listing.bedrooms} bed
            </span>
          ) : null}
          {listing.bathrooms && listing.bathrooms !== 'N/A' ? (
            <span className="flex items-center gap-1">
              <Icon path={ICON.bath} className="w-3 h-3 opacity-75" />
              {listing.bathrooms} bath
            </span>
          ) : null}
        </div>
        {listing.price ? (
          <div className="text-[15px] font-extrabold text-iqi-ink tabular-nums mt-1">
            {displayCurrency(listing.currency)} {listing.price.toLocaleString()}
            {listing.isRent ? <span className="text-[11px] font-medium text-iqi-ink-faint"> /month</span> : null}
          </div>
        ) : null}
        {listing.listedAt ? (
          <div className="text-[10px] text-iqi-ink-faint">Listed on {formatDate(listing.listedAt)}</div>
        ) : null}
      </div>
    </div>
  )
}

export default function AgentProfile({ agent }) {
  const [expanded, setExpanded] = useState(false)
  const [filter, setFilter] = useState('all')

  const topTownships = useMemo(() => {
    const counts = new Map()
    for (const l of agent.listings) {
      if (!l.township) continue
      counts.set(l.township, (counts.get(l.township) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [agent.listings])

  const filteredListings = agent.listings.filter((l) => {
    if (filter === 'sale') return l.isSale
    if (filter === 'rent') return l.isRent
    return true
  })
  const visibleListings = filteredListings.slice(0, 8)

  const isLongDescription = agent.description.length > 220
  const shortDescription =
    isLongDescription && !expanded
      ? agent.description.slice(0, 220).replace(/\s+\S*$/, '') + '…'
      : agent.description

  const phone = formatPhone(agent.mobileContactNumber)
  const contactHref = agent.mobileContactNumber ? `tel:+${agent.mobileContactNumber.replace(/\D/g, '')}` : undefined

  return (
    <div className="bg-iqi-bg text-iqi-ink min-h-screen">
      {/* Nav */}
      <nav className="max-w-5xl mx-auto px-4 flex items-center gap-7 py-4 border-b border-iqi-line">
        <Link to="/" className="flex items-center gap-2 font-extrabold text-lg tracking-tight">
          <span className="w-5 h-5 rounded-md bg-[conic-gradient(from_200deg,var(--color-iqi-accent),var(--color-iqi-sale),var(--color-iqi-txn),var(--color-iqi-rent),var(--color-iqi-accent))]" />
          IQI
        </Link>
        <div className="hidden sm:flex gap-5 text-[13px] font-medium text-iqi-ink-dim">
          <span>My listings</span>
          <span>New launches</span>
          <span>Get in touch</span>
        </div>
        <div className="ml-auto flex items-center gap-3.5">
          <span className="text-xs font-semibold text-iqi-ink-faint">EN</span>
          {contactHref ? (
            <a
              href={contactHref}
              className="bg-iqi-accent text-white font-bold text-[13px] px-4 py-2 rounded-lg whitespace-nowrap"
            >
              Contact Now
            </a>
          ) : null}
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4">
        {/* About + stats */}
        <section className="text-center pt-9 pb-2 max-w-xl mx-auto">
          <h2 className="text-xl font-extrabold text-balance">About {agent.displayName}</h2>
          {agent.description ? (
            <p className="text-[13.5px] leading-relaxed text-iqi-ink-dim mt-3">
              {shortDescription}{' '}
              {isLongDescription ? (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="text-iqi-accent font-bold"
                >
                  {expanded ? 'See less' : 'See more'}
                </button>
              ) : null}
            </p>
          ) : null}

          <div className="flex justify-center gap-9 flex-wrap pt-7 pb-1.5">
            <StatItem colorClass="bg-iqi-years" icon={ICON.years} value={agent.yearsOfExperience ?? '—'} label="years at IQI" />
            <StatItem colorClass="bg-iqi-txn" icon={ICON.txn} value={agent.transactionsCount ?? '—'} label="transactions" />
            <StatItem colorClass="bg-iqi-sale" icon={ICON.sale} value={agent.saleCount} label="properties on sale" />
            <StatItem colorClass="bg-iqi-rent" icon={ICON.rent} value={agent.rentCount} label="properties on rent" />
          </div>
        </section>

        {/* AI Twin */}
        <section className="pt-11 pb-2">
          <div className="relative rounded-2xl p-px bg-gradient-to-br from-iqi-accent/60 via-transparent to-iqi-sale/60 shadow-lg shadow-black/20">
            <div className="rounded-[15px] bg-iqi-surface border border-iqi-line/60 grid md:grid-cols-[280px_1fr]">
              <div className="p-6 flex flex-col gap-4 border-b md:border-b-0 md:border-r border-iqi-line">
                <span className="self-start text-[11px] font-bold uppercase tracking-wide text-iqi-accent bg-iqi-accent/15 px-2.5 py-1 rounded-md">
                  New &middot; AI Twin
                </span>
                <h3 className="text-lg font-extrabold leading-snug">Meet {agent.displayName}'s AI Twin</h3>
                <p className="text-[13px] text-iqi-ink-dim leading-relaxed">
                  Same REN license, same {agent.totalListings} listings, awake when {agent.displayName.split(' ')[0]} isn't &mdash;
                  sourced straight from the live sheet.
                </p>
                <div className="flex flex-col gap-2 mt-1 pt-4 border-t border-iqi-line text-xs">
                  <div className="flex items-baseline justify-between">
                    <span className="text-iqi-ink-faint">Trained on</span>
                    <span className="font-semibold tabular-nums">{agent.totalListings} listings</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-iqi-ink-faint">Status</span>
                    <span className="font-semibold text-iqi-live">Answering now</span>
                  </div>
                </div>
              </div>
              <ChatPanel agent={agent} />
            </div>
          </div>
        </section>

        {/* Contact / hero card */}
        <section className="pt-11 pb-2">
          <div className="bg-iqi-card text-iqi-ink-on-card rounded-2xl px-7 py-6 flex flex-col-reverse sm:flex-row items-center justify-between gap-6 shadow-lg shadow-black/20">
            <div className="flex flex-col gap-2.5 text-left">
              <span className="self-start text-[11.5px] font-bold text-iqi-accent-deep bg-iqi-accent/15 px-2.5 py-1 rounded-md">
                {agent.designation} &middot; {agent.team}
              </span>
              <h1 className="text-2xl font-extrabold tracking-tight">{agent.displayName}</h1>
              {agent.renTag ? <span className="text-xs font-medium text-neutral-500 tabular-nums">{agent.renTag}</span> : null}
              <div className="flex gap-4 flex-wrap text-xs font-medium text-neutral-600">
                {phone ? (
                  <span className="flex items-center gap-1.5">
                    <Icon path={ICON.phone} className="w-3.5 h-3.5 opacity-70" />
                    {phone}
                  </span>
                ) : null}
                {agent.email ? (
                  <span className="flex items-center gap-1.5">
                    <Icon path={ICON.mail} className="w-3.5 h-3.5 opacity-70" />
                    {agent.email}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-3.5 mt-1">
                {contactHref ? (
                  <a href={contactHref} className="bg-iqi-accent text-white font-bold text-[13px] px-4 py-2 rounded-lg">
                    Contact Now
                  </a>
                ) : null}
                <span className="flex items-center gap-1.5 text-xs font-semibold text-iqi-live">
                  <span className="w-1.5 h-1.5 rounded-full bg-iqi-live motion-safe:animate-pulse" />
                  Ready to assist
                </span>
              </div>
            </div>
            <Avatar agent={agent} />
          </div>
        </section>

        {/* Service locations */}
        <section className="pt-11 pb-2">
          <div className="bg-iqi-surface border border-iqi-line rounded-2xl p-5">
            <h3 className="text-[15px] font-extrabold mb-3.5">{agent.displayName}'s Service Locations</h3>
            <div className="flex gap-2 flex-wrap mb-4">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                  filter === 'all' ? 'bg-iqi-accent border-iqi-accent text-white' : 'border-iqi-line text-iqi-ink-dim'
                }`}
              >
                All Listings ({agent.totalListings})
              </button>
              <button
                type="button"
                onClick={() => setFilter('sale')}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                  filter === 'sale' ? 'bg-iqi-accent border-iqi-accent text-white' : 'border-iqi-line text-iqi-ink-dim'
                }`}
              >
                For Sale ({agent.saleCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter('rent')}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                  filter === 'rent' ? 'bg-iqi-accent border-iqi-accent text-white' : 'border-iqi-line text-iqi-ink-dim'
                }`}
              >
                For Rent ({agent.rentCount})
              </button>
            </div>
            <div className="grid md:grid-cols-[200px_1fr] gap-4">
              <div className="flex flex-col gap-2 text-[12.5px] text-iqi-ink-dim">
                {topTownships.map(([township, count]) => (
                  <div key={township} className="flex items-center justify-between gap-2">
                    <span className="text-iqi-ink font-semibold truncate">{township}</span>
                    <span className="tabular-nums text-iqi-ink-faint">{count}</span>
                  </div>
                ))}
              </div>
              <div className="relative rounded-xl min-h-[150px] bg-iqi-surface-2 overflow-hidden bg-[radial-gradient(circle_at_25%_35%,rgba(240,96,42,0.16),transparent_40%),radial-gradient(circle_at_70%_65%,rgba(240,96,42,0.16),transparent_40%)]">
                {topTownships.map(([township], i) => (
                  <span
                    key={township}
                    className="absolute w-2.5 h-2.5 rounded-full bg-iqi-accent shadow-[0_0_0_3px_rgba(240,96,42,0.2)]"
                    style={{ left: `${20 + ((i * 37) % 60)}%`, top: `${25 + ((i * 53) % 50)}%` }}
                  />
                ))}
                <span className="absolute bottom-2 left-2.5 text-[10px] text-iqi-ink-faint">
                  {topTownships.length} active townships around {agent.branch}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Listings */}
        <section className="pt-11 pb-14">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-base font-extrabold">My Listings</h3>
            <span className="text-xs text-iqi-ink-faint tabular-nums">
              {visibleListings.length} of {filteredListings.length} shown
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {visibleListings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        </section>

        <footer className="border-t border-iqi-line py-6 flex justify-between gap-4 flex-wrap text-[11.5px] text-iqi-ink-faint">
          <Link to="/" className="hover:text-iqi-ink-dim">
            &larr; Back to agents
          </Link>
          <span className="tabular-nums">agent-digital-twin-demo</span>
        </footer>
      </div>
    </div>
  )
}
