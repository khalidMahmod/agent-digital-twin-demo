import { Link } from 'react-router-dom'
import { AGENTS } from '../data/agents'

export default function AgentList() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 text-center">
      <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100">Agent Digital Twin</h1>
      <p className="text-neutral-500 mt-2 max-w-xl mx-auto">
        Every agent gets an AI twin on their public profile, answering buyer questions 24/7 — grounded in
        their own listings and track record. Pick an agent below to see two genuinely different twins.
      </p>

      <div className="grid sm:grid-cols-2 gap-5 mt-10 text-left">
        {AGENTS.map((agent) => (
          <Link
            key={agent.slug}
            to={`/agent/${agent.slug}`}
            className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors bg-white dark:bg-neutral-900"
          >
            <div className="flex items-center gap-4">
              <img
                src={agent.avatarUrl}
                alt={agent.fullName}
                className="w-16 h-16 rounded-full object-cover border border-neutral-200 dark:border-neutral-800 bg-neutral-100"
                onError={(e) => {
                  e.target.style.display = 'none'
                }}
              />
              <div>
                <div className="font-semibold text-neutral-900 dark:text-neutral-100">{agent.fullName}</div>
                <div className="text-xs text-neutral-500">
                  {agent.branch}, {agent.country}
                </div>
              </div>
            </div>
            <div className="flex gap-4 mt-4 text-sm">
              <div>
                <span className="font-semibold text-neutral-900 dark:text-neutral-100">{agent.totalListings}</span>
                <span className="text-neutral-500"> listings</span>
              </div>
              <div>
                <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                  {agent.transactionsCount ?? '—'}
                </span>
                <span className="text-neutral-500"> transactions</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
