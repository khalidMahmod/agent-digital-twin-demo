// Keeps a buyer's conversation across page refreshes.
//
// Two reasons this matters, only one of them cosmetic:
//   1. Refreshing used to wipe the visible chat, which reads as broken.
//   2. Worse, each load opened a NEW server session, so one buyer's
//      conversation fragmented across several sessions and the lead's
//      transcript arrived in pieces.
//
// sessionStorage, not localStorage: a public agent profile can be opened on a
// shared or public machine, and a property conversation carrying someone's name
// and phone number has no business outliving the tab. It survives refresh and
// in-tab navigation, which is the actual complaint.

const KEY_PREFIX = 'twin-chat:'

// Server-side session tokens expire in 24h and idle sessions are finalized
// long before that, so anything older is dead weight.
const MAX_AGE_MS = 12 * 60 * 60 * 1000

const keyFor = (agentSlug) => `${KEY_PREFIX}${agentSlug}`

function storage() {
  try {
    return window.sessionStorage
  } catch {
    // Storage can throw outright in private modes and sandboxed frames.
    return null
  }
}

export function loadConversation(agentSlug) {
  const store = storage()
  if (!store) return null

  try {
    const raw = store.getItem(keyFor(agentSlug))
    if (!raw) return null

    const saved = JSON.parse(raw)
    if (!saved?.savedAt || Date.now() - saved.savedAt > MAX_AGE_MS) {
      store.removeItem(keyFor(agentSlug))
      return null
    }

    return {
      token: saved.token || null,
      messages: Array.isArray(saved.messages) ? saved.messages : [],
      leadCaptured: Boolean(saved.leadCaptured),
    }
  } catch {
    return null
  }
}

export function saveConversation(agentSlug, { token, messages, leadCaptured }) {
  const store = storage()
  if (!store) return

  try {
    store.setItem(
      keyFor(agentSlug),
      JSON.stringify({ token, messages, leadCaptured, savedAt: Date.now() }),
    )
  } catch {
    // Quota or a locked-down browser — the chat still works, it just won't
    // survive a refresh. Not worth surfacing to the buyer.
  }
}

export function clearConversation(agentSlug) {
  storage()?.removeItem(keyFor(agentSlug))
}
