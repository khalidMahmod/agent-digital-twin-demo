// The one place the twin speaks without being spoken to.
//
// That makes it the one place it can annoy someone into closing the tab, so
// the rules are deliberately narrow and the logic lives here, apart from the
// component, where it can be read and reasoned about on its own.
//
// It fires at most once, only when the conversation has gone somewhere and we
// still have no way to reach the buyer, and never on the heels of a contact
// request they have just sidestepped. A future tweak aimed at "more
// conversions" will be tempted to loosen exactly these three — that is what
// they are here to resist.

// Long enough that the buyer has finished reading. A twin reply runs two to
// four sentences plus property bullets, which is ten to twenty seconds of
// reading before they have even started thinking — a nudge at five seconds
// interrupts someone mid-sentence.
export const NUDGE_AFTER_MS = 75_000

// Two turns, because one is a bounce. Someone who asked a single question and
// left was never in a conversation; someone who asked, read the answer and
// asked again is deciding something.
const MIN_BUYER_TURNS = 2

const DECLINE = /\b(no thanks?|not (?:right )?now|rather not|don'?t want|prefer not|later|maybe later)\b/i

// The twin's own way of asking. If its last turn already asked, a nudge is the
// second ask in a row with nothing answered in between.
const CONTACT_REQUEST = /\b(?:your|a)\s+(?:number|phone|contact)\b|may i have|could i get|what'?s your name/i

// One Markdown bullet carrying a price — the twin's property format, and the
// signal that the buyer has actually seen inventory.
const PROPERTY_BULLET = /^\s*[-*]\s+.*RM\s?[\d,]+/im

const lastOf = (messages, role) =>
  [...messages].reverse().find((m) => m.role === role)?.text ?? ''

/**
 * Whether the twin should say something unprompted right now.
 *
 * @param {{messages: {role: string, text: string}[], leadCaptured: boolean, alreadyNudged: boolean}} state
 */
export function shouldNudge({ messages = [], leadCaptured = false, alreadyNudged = false } = {}) {
  if (alreadyNudged) return false
  // Already reachable: silence here costs nothing, and nurture takes it from
  // here on the agent's own schedule.
  if (leadCaptured) return false

  const buyerTurns = messages.filter((m) => m.role === 'user')
  if (buyerTurns.length < MIN_BUYER_TURNS) return false

  // They just declined, or ducked the question. Either way the answer was no.
  if (DECLINE.test(buyerTurns.at(-1)?.text ?? '')) return false
  if (CONTACT_REQUEST.test(lastOf(messages, 'assistant'))) return false

  return true
}

/**
 * What it should say. Built from what the conversation already contains, so it
 * offers something specific rather than poking with "still there?".
 */
export function nudgeText({ messages = [], agentName = 'the agent' } = {}) {
  const sawListings = messages.some((m) => m.role === 'assistant' && PROPERTY_BULLET.test(m.text))

  if (sawListings) {
    return `Take your time. If you'd like, I can have ${agentName} send these over ` +
      `and keep an eye out for anything similar — what's the best way to reach you?`
  }

  return `No rush — I'm still here. If it's easier, ${agentName} can pick this up ` +
    `directly and come back to you with options. Would you like me to arrange that?`
}
