import { useState, useRef, useEffect, useCallback } from 'react'
import { isLiveMode, openTwinSession, sendTwinMessage, finalizeTwinSession } from '../lib/twinApi'
import LeadCapturedCard from './LeadCapturedCard'
import ChatMessage from './ChatMessage'

// Mock response generator, grounded in the agent's real data.
// Used when VITE_ATLAS_API_URL is unset, so the demo runs with no backend —
// and as the fallback if the live session can't be opened. Keyword-matched
// against the agent's actual listings so the two agents visibly diverge even
// in mock mode.
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

// Openers a real buyer would plausibly type, built from this agent's own data
// so they differ per agent and always have something to match. Also saves
// typing on stage — and the third one is the demo's point: it hands over
// contact details, which is what turns the conversation into a Lead.
function starterPrompts(agent) {
  const township = agent.listings.find((l) => l.township)?.township
  const area = township || agent.branch

  const prompts = []
  if (agent.rentCount > 0) prompts.push(`What do you have for rent in ${area}?`)
  if (agent.saleCount > 0) prompts.push(`Anything for sale around ${area}?`)
  prompts.push("I'm Tan Wei, 012-345 6789 — please have the agent call me")

  return prompts.slice(0, 3)
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
  const [token, setToken] = useState(null)
  const [leadCaptured, setLeadCaptured] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [finalized, setFinalized] = useState(false)
  const [lead, setLead] = useState(null)
  // Starts live if configured, but degrades to mock on any failure so a demo
  // never dies on a backend hiccup.
  const [live, setLive] = useState(isLiveMode)
  const scrollRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isTyping])

  // Open the session up front so the first message doesn't pay for it.
  useEffect(() => {
    if (!isLiveMode) return

    let cancelled = false
    openTwinSession(agent.slug)
      .then((session) => {
        if (!cancelled) setToken(session.token)
      })
      .catch((error) => {
        if (cancelled) return
        console.warn('[twin] falling back to mock mode:', error.message)
        setLive(false)
      })

    return () => {
      cancelled = true
    }
  }, [agent.slug])

  const replyWithMock = useCallback(
    (text) => {
      setTimeout(() => {
        setMessages((prev) => [...prev, { role: 'assistant', text: mockReply(agent, text) }])
        setIsTyping(false)
      }, 600 + Math.random() * 500)
    },
    [agent],
  )

  async function handleSend(e) {
    e.preventDefault()
    await submit(input)
  }

  async function submit(raw) {
    const text = raw.trim()
    if (!text || isTyping) return

    setMessages((prev) => [...prev, { role: 'user', text }])
    setInput('')
    setIsTyping(true)

    if (!live || !token) {
      replyWithMock(text)
      return
    }

    try {
      const result = await sendTwinMessage(token, text)
      setMessages((prev) => [...prev, { role: 'assistant', text: result.reply }])
      if (result.lead_captured) setLeadCaptured(true)
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `Sorry — I couldn't reach ${agent.displayName}'s assistant just then. Please try again in a moment.`,
        },
      ])
      console.warn('[twin] message failed:', error.message)
    } finally {
      setIsTyping(false)
    }
  }

  async function handleFinalize() {
    if (!live || !token || finalizing) return

    setFinalizing(true)
    try {
      const result = await finalizeTwinSession(token)
      setFinalized(true)
      // Present only when the Atlas instance has demo inspection enabled.
      if (result.lead) setLead(result.lead)
    } catch (error) {
      console.warn('[twin] finalize failed:', error.message)
    } finally {
      setFinalizing(false)
    }
  }

  // min-h rather than h: the panel grows when the lead card appears instead of
  // squeezing the transcript out of view.
  return (
    <div className="flex flex-col min-h-[430px]">
      <div className="px-5 py-3.5 border-b border-iqi-line flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-iqi-live motion-safe:animate-pulse flex-shrink-0" />
        <span className="text-[13.5px] font-bold text-iqi-ink">{agent.displayName}&apos;s AI Twin</span>
        {leadCaptured ? (
          <span className="text-[10px] font-bold uppercase tracking-wide text-iqi-live bg-iqi-live/15 px-2 py-0.5 rounded">
            Lead captured in Atlas
          </span>
        ) : null}
        <span className="ml-auto text-[11.5px] text-iqi-ink-faint">
          {live ? 'grounded · not scripted' : 'demo mode'}
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-[240px] max-h-[340px] overflow-y-auto px-5 py-4 space-y-3.5 outline-none">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[84%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                m.role === 'user'
                  ? 'bg-iqi-accent text-white rounded-br-sm'
                  : 'bg-iqi-surface-2 border border-iqi-line text-iqi-ink rounded-bl-sm'
              }`}
            >
              {m.role === 'user' ? m.text : <ChatMessage text={m.text} />}
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

      {/* Only while the conversation is untouched — once it's underway these
          would be noise competing with the transcript. */}
      {messages.length === 1 && !finalized ? (
        <div className="px-5 pb-3 flex flex-wrap gap-2">
          {starterPrompts(agent).map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => submit(prompt)}
              disabled={isTyping}
              className="rounded-full border border-iqi-line text-iqi-ink-dim hover:text-iqi-ink hover:border-iqi-line-strong px-3 py-1.5 text-[11.5px] text-left disabled:opacity-40"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      <form onSubmit={handleSend} className="border-t border-iqi-line p-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            finalized ? 'This conversation has ended' : `Ask ${agent.displayName} anything...`
          }
          disabled={finalized}
          className="flex-1 rounded-lg border border-iqi-line bg-iqi-surface-2 text-iqi-ink placeholder:text-iqi-ink-faint px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-iqi-accent/40 disabled:opacity-50"
        />
        <button
          type="submit"
          className="rounded-lg bg-iqi-accent text-white px-4 py-2 text-[13px] font-bold disabled:opacity-40"
          disabled={!input.trim() || finalized}
        >
          Send
        </button>
      </form>

      {/* Ends the session and scores its lead now, rather than waiting for
          Atlas's 30-minute idle sweep — which is what makes the qualification
          step visible inside a short demo. */}
      {live && leadCaptured && !finalized ? (
        <button
          type="button"
          onClick={handleFinalize}
          disabled={finalizing}
          className="mx-3 mb-3 rounded-lg border border-iqi-line text-iqi-ink-dim px-3 py-2 text-[12px] font-semibold hover:text-iqi-ink disabled:opacity-50"
        >
          {finalizing ? 'Scoring the lead…' : 'End chat & score this lead'}
        </button>
      ) : null}

      {lead ? (
        <div className="px-3 pb-3">
          <LeadCapturedCard lead={lead} />
        </div>
      ) : null}
    </div>
  )
}
