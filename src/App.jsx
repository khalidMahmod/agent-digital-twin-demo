import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom'
import AgentList from './components/AgentList'
import AgentProfile from './components/AgentProfile'
import { getAgentBySlug } from './data/agents'

function AgentRoute() {
  const { slug } = useParams()
  const agent = getAgentBySlug(slug)

  if (!agent) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center text-neutral-500">
        Agent not found.
      </div>
    )
  }

  return <AgentProfile agent={agent} />
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
