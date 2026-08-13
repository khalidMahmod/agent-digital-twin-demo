import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom'
import AgentList from './components/AgentList'
import AgentProfile from './components/AgentProfile'
import { getAgentBySlug, normalizeAgent } from './data/agents'
import { isLiveMode, fetchAgentProfile } from './lib/twinApi'

function AgentRoute() {
  const { slug } = useParams()
  const fixture = getAgentBySlug(slug)
  const [agent, setAgent] = useState(fixture)
  // In live mode the twin answers from Atlas's current listings, so rendering
  // stale fixtures alongside it would have the page contradicting the chat.
  // Fixtures still render immediately and remain the fallback, so the page is
  // never blank and never dies on a backend hiccup.
  const [loading, setLoading] = useState(isLiveMode)

  useEffect(() => {
    setAgent(fixture)

    if (!isLiveMode) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    fetchAgentProfile(slug)
      .then((raw) => {
        if (!cancelled) setAgent(normalizeAgent(raw))
      })
      .catch((error) => {
        if (!cancelled) console.warn('[twin] using bundled profile:', error.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [slug, fixture])

  if (!agent) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center text-neutral-500">
        {loading ? 'Loading agent…' : 'Agent not found.'}
      </div>
    )
  }

  return <AgentProfile agent={agent} key={agent.slug} />
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
        <Routes>
          <Route path="/" element={<AgentList />} />
          <Route path="/agent/:slug" element={<AgentRoute />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
