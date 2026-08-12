import { useState, useRef, useEffect } from 'react'

// Mock response generator, grounded in the agent's real data.
// No backend yet — this is Phase 4 (fake the chat, confirm UX) before wiring
// a real LLM endpoint. Keyword-matched against the agent's actual listings so
// the two agents visibly diverge even in mock mode.
function mockReply(agent, message) {
  const q = message.toLowerCase()

  if (q.includes('rent')) {
    if (agent.rentCount === 0) {
      return `I don't currently have any rental listings — my ${agent.totalListings} active listings are all for sale. Want me to check sale options instead?`
    }
    const sample = agent.listings.find((l) => l.isRent)
    return `I have ${agent.rentCount} rental listings right now, mostly around ${sample?.township || agent.branch}. For example: ${sample?.name}${sample?.price ? ` at RM ${sample.price.toLocaleString()}/month` : ''}. Want more details?`
  }

  if (q.includes('sale') || q.includes('buy') || q.includes('purchase')) {
    if (agent.saleCount === 0) {
      return `I don't have any sale listings at the moment — all ${agent.totalListings} of my active listings are rentals. Happy to help you find a rental instead, or connect you with a colleague who handles sales in this area.`
    }
    const sample = agent.listings.find((l) => l.isSale)
    return `I have ${agent.saleCount} properties for sale right now. One example: ${sample?.name}${sample?.price ? ` — asking RM ${sample.price.toLocaleString()}` : ''}. Want me to narrow it down by area or budget?`
  }

  if (q.includes('track record') || q.includes('experience') || q.includes('how long')) {
    return `I've been with IQI for ${agent.yearsOfExperience ?? 'several'} years, with ${agent.transactionsCount ?? 'a number of'} transactions closed so far. Based in ${agent.branch}, ${agent.region}.`
  }

  if (q.includes('where') || q.includes('area') || q.includes('location')) {
    const townships = [...new Set(agent.listings.map((l) => l.township).filter(Boolean))].slice(0, 5)
    return `I mainly work around ${agent.branch}${townships.length ? `, covering areas like ${townships.join(', ')}` : ''}. Let me know what area you're interested in and I'll check what's available.`
  }

  return `Thanks for reaching out! I'm ${agent.displayName}'s AI assistant — I can help with questions about ${agent.branch} area listings, pricing, or availability (${agent.totalListings} active listings, ${agent.saleCount} for sale / ${agent.rentCount} for rent). What are you looking for?`
}

export default function ChatPanel({ agent }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: `Hi, I'm ${agent.displayName}'s AI assistant. I'm grounded in ${agent.displayName}'s real listings and track record, and I reply 24/7 — even while they're offline. What can I help you with?`,
    },
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isTyping])

  function handleSend(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return

    setMessages((prev) => [...prev, { role: 'user', text }])
    setInput('')
    setIsTyping(true)

    // Mock latency so it reads like a real response, not an instant echo.
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: 'assistant', text: mockReply(agent, text) }])
      setIsTyping(false)
    }, 600 + Math.random() * 500)
  }

  return (
    <div className="flex flex-col h-[430px]">
      <div className="px-5 py-3.5 border-b border-iqi-line flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-iqi-live motion-safe:animate-pulse flex-shrink-0" />
        <span className="text-[13.5px] font-bold text-iqi-ink">{agent.displayName}&apos;s AI Twin</span>
        <span className="ml-auto text-[11.5px] text-iqi-ink-faint">grounded &middot; not scripted</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5 outline-none">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[84%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                m.role === 'user'
                  ? 'bg-iqi-accent text-white rounded-br-sm'
                  : 'bg-iqi-surface-2 border border-iqi-line text-iqi-ink rounded-bl-sm'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-iqi-surface-2 border border-iqi-line rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-iqi-ink-faint motion-safe:animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-iqi-ink-faint motion-safe:animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-iqi-ink-faint motion-safe:animate-bounce" />
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSend} className="border-t border-iqi-line p-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask ${agent.displayName} anything...`}
          className="flex-1 rounded-lg border border-iqi-line bg-iqi-surface-2 text-iqi-ink placeholder:text-iqi-ink-faint px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-iqi-accent/40"
        />
        <button
          type="submit"
          className="rounded-lg bg-iqi-accent text-white px-4 py-2 text-[13px] font-bold disabled:opacity-40"
          disabled={!input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  )
}
