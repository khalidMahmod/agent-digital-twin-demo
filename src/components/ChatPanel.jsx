import { useState, useRef, useEffect, useCallback } from 'react'
import { isLiveMode, openTwinSession, sendTwinMessage, finalizeTwinSession } from '../lib/twinApi'
import { loadConversation, saveConversation } from '../lib/twinStorage'
import ChatMessage from './ChatMessage'

// How long the conversation must sit quiet before the session is finalized and
// its lead scored. Short enough that the Lead is ready in Atlas by the time you
// switch tabs, long enough not to cut off someone still typing.
const IDLE_FINALIZE_MS = 15_000

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
  const greeting = {
    role: 'assistant',
    text: `Hi, I'm ${agent.displayName}'s AI assistant. I'm grounded in ${agent.displayName}'s real listings and track record, and I reply 24/7 — even while they're offline. What can I help you with?`,
  }
  // Restored synchronously so a refresh paints the existing conversation
  // immediately rather than flashing an empty chat first.
  const restored = isLiveMode ? loadConversation(agent.slug) : null

  const [messages, setMessages] = useState(restored?.messages?.length ? restored.messages : [greeting])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [token, setToken] = useState(restored?.token ?? null)
  const [leadCaptured, setLeadCaptured] = useState(restored?.leadCaptured ?? false)
  // A ref, not state: the idle timer and the visibility handler both race to
  // finalize, and a ref settles that synchronously without a re-render.
  const finalizedRef = useRef(false)
  const openingRef = useRef(null)
  // Starts live if configured, but degrades to mock on any failure so a demo
  // never dies on a backend hiccup.
  const [live, setLive] = useState(isLiveMode)
  const scrollRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isTyping])

  // Open a session up front so the first message doesn't pay for it — but only
  // when there isn't a restored one. Reusing the stored token is what keeps a
  // refresh continuing the same server-side conversation instead of starting a
  // second one and splitting the lead's transcript.
  useEffect(() => {
    if (!isLiveMode || token) return

    // Cache the in-flight PROMISE, not a boolean. StrictMode invokes this
    // effect twice on mount: a boolean guard makes the second pass skip
    // entirely, and since the first pass's cleanup has already flagged itself
    // cancelled, nobody ends up applying the token. Sharing the promise means
    // one network call and whichever pass is still mounted sets the token.
    openingRef.current ||= openTwinSession(agent.slug)

    let cancelled = false
    openingRef.current
      .then((session) => {
        if (!cancelled) setToken(session.token)
      })
      .catch((error) => {
        openingRef.current = null // let a later attempt retry
        if (cancelled) return
        console.warn('[twin] falling back to mock mode:', error.message)
        setLive(false)
      })

    return () => {
      cancelled = true
    }
  }, [agent.slug, token])

  // Persist after every change so a refresh at any moment resumes correctly.
  useEffect(() => {
    if (!live || !token) return
    saveConversation(agent.slug, { token, messages, leadCaptured })
  }, [agent.slug, live, token, messages, leadCaptured])

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
      const result = await sendWithRecovery(text)
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

  // A restored token can point at a session the server has already closed —
  // routine here, because a session finalizes itself 15s after a lead is
  // captured. Rather than dead-end the buyer, open a fresh session and resend.
  // The visible history carries over, and Atlas dedups the new session onto the
  // same lead, so continuity holds on both sides.
  async function sendWithRecovery(text) {
    try {
      return await sendTwinMessage(token, text)
    } catch (error) {
      if (error.status !== 404) throw error

      const session = await openTwinSession(agent.slug)
      setToken(session.token)
      finalizedRef.current = false
      return sendTwinMessage(session.token, text)
    }
  }

  // Silent finalize: ends the session and scores its lead as soon as the
  // conversation goes quiet, so the Lead is sitting fully scored in Atlas by
  // the time anyone looks. Nothing about it surfaces to the visitor — this is
  // a public profile page, and how a buyer was scored is the agent's business,
  // not theirs.
  //
  // Needed because Atlas otherwise only scores sessions idle for 30+ minutes
  // (TwinChats::FinalizeWorker), which is far too slow to watch happen.
  const finalizeQuietly = useCallback(async () => {
    if (!live || !token || finalizedRef.current) return
    finalizedRef.current = true

    try {
      await finalizeTwinSession(token)
    } catch (error) {
      finalizedRef.current = false
      console.warn('[twin] finalize failed:', error.message)
    }
  }, [live, token])

  // Fires once the buyer has stopped typing for a beat after a lead exists.
  useEffect(() => {
    if (!leadCaptured || isTyping) return

    const timer = setTimeout(finalizeQuietly, IDLE_FINALIZE_MS)
    return () => clearTimeout(timer)
  }, [leadCaptured, isTyping, messages, finalizeQuietly])

  // Backstop for the common demo move: capture a lead, then immediately switch
  // to Atlas. keepalive lets the request outlive the page.
  useEffect(() => {
    if (!leadCaptured) return

    const onHide = () => {
      if (document.visibilityState === 'hidden') finalizeQuietly()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [leadCaptured, finalizeQuietly])

  // Nothing here reveals the Atlas side — no lead badge, no scoring control.
  // This is exactly what a buyer on the public profile would see; the captured
  // Lead is shown from Atlas itself.
  return (
    <div className="flex flex-col min-h-[430px]">
      <div className="px-5 py-3.5 border-b border-iqi-line flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-iqi-live motion-safe:animate-pulse flex-shrink-0" />
        <span className="text-[13.5px] font-bold text-iqi-ink">{agent.displayName}&apos;s AI Twin</span>
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
      {messages.length === 1 ? (
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
