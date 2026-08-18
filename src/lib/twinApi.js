// Client for atlas-api's public AI Twin endpoints.
//
// Point VITE_ATLAS_API_URL at an Atlas host (e.g. staging) to talk to the real
// twin. Leave it unset and the app stays in mock mode — the demo still runs
// with no backend, which is also the safety net if staging is unreachable
// mid-demo.

const BASE_URL = (import.meta.env.VITE_ATLAS_API_URL || '').replace(/\/+$/, '')

export const isLiveMode = Boolean(BASE_URL)

class TwinApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'TwinApiError'
    this.status = status
  }
}

async function parseError(response, fallback) {
  try {
    const body = await response.json()
    return body?.errors?.[0] || body?.message || fallback
  } catch {
    return fallback
  }
}

// Fetches an agent's public profile from Atlas — the same endpoint that backs
// iqiglobal.com's agent pages, and the one the bundled fixtures were exported
// from, so the payload feeds normalizeAgent unchanged.
//
// Worth doing rather than always rendering fixtures: in live mode the twin
// answers from Atlas's current listings, so a stale fixture would have the
// page and the chat contradicting each other.
export async function fetchAgentProfile(agentSlug) {
  const response = await fetch(
    `${BASE_URL}/api/web/agents/${encodeURIComponent(agentSlug)}`,
    { headers: { Accept: 'application/json' } },
  )

  if (!response.ok) {
    throw new TwinApiError(`Agent profile unavailable (${response.status})`, response.status)
  }

  const body = await response.json()
  // The endpoint answers 200 with {} for an agent with no public profile.
  const agent = body?.data ?? body
  if (!agent || !agent.id) {
    throw new TwinApiError('Agent has no public profile', 404)
  }

  return agent
}

// Opens a chat session for an agent's public profile. The agent is resolved
// server-side from the slug; the returned token is what authenticates every
// subsequent message, so the browser never asserts which agent it is talking to
// after this point.
export async function openTwinSession(agentSlug) {
  const response = await fetch(`${BASE_URL}/api/web/twin_chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ agent_slug: agentSlug }),
  })

  if (!response.ok) {
    throw new TwinApiError(
      await parseError(response, 'Could not start the chat session'),
      response.status,
    )
  }

  return response.json()
}

// Picks up the conversation behind a resume link — the signed token Atlas put
// in the buyer's acknowledgment message. Returns the same shape as
// openTwinSession plus `messages`, the earlier conversation to show above the
// new turn.
export async function resumeTwinSession(resumeToken) {
  const response = await fetch(`${BASE_URL}/api/web/twin_chats/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token: resumeToken }),
  })

  if (!response.ok) {
    throw new TwinApiError(
      await parseError(response, 'That link has expired'),
      response.status,
    )
  }

  return response.json()
}

// Ends the conversation and scores its lead straight away, rather than
// waiting for Atlas's idle sweep (30+ minutes). Returns the scored lead only
// when the Atlas instance has demo inspection enabled — in production the
// qualification verdict is the agent's view of the buyer, not the buyer's.
export async function finalizeTwinSession(token) {
  const response = await fetch(
    `${BASE_URL}/api/web/twin_chats/${encodeURIComponent(token)}/finalize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    },
  )

  if (!response.ok) {
    throw new TwinApiError(
      await parseError(response, 'Could not close the chat session'),
      response.status,
    )
  }

  return response.json()
}

export async function sendTwinMessage(token, message) {
  const response = await fetch(
    `${BASE_URL}/api/web/twin_chats/${encodeURIComponent(token)}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ message }),
    },
  )

  if (!response.ok) {
    throw new TwinApiError(
      await parseError(response, 'The assistant could not reply just now'),
      response.status,
    )
  }

  return response.json()
}
