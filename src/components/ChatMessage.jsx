// Renders a twin reply as formatted text.
//
// The model emits Markdown, but the bubble used to print it raw inside a div —
// so newlines collapsed and a listing rundown arrived as one run-on paragraph
// with stray dashes and asterisks.
//
// Deliberately not react-markdown: the twin's output is a narrow, known subset
// (bullet lists, bold, prices), and a hand-rolled renderer avoids adding a
// dependency — and an install step — days before a demo.

const PRICE = /(RM\s?[\d,]+(?:\.\d+)?(?:\s?\/\s?month|\/month|per month)?)/gi

// Bold spans, then price runs inside the remaining text. Prices are styled
// whatever the model does, so a listing reads well even when it forgets to
// emphasise them itself.
function renderInline(text, keyPrefix) {
  const out = []

  text.split(/(\*\*[^*]+\*\*)/g).forEach((chunk, i) => {
    if (!chunk) return

    if (chunk.startsWith('**') && chunk.endsWith('**')) {
      out.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-iqi-ink">
          {chunk.slice(2, -2)}
        </strong>,
      )
      return
    }

    chunk.split(PRICE).forEach((part, j) => {
      if (!part) return
      if (PRICE.test(part)) {
        PRICE.lastIndex = 0
        out.push(
          <span key={`${keyPrefix}-p${i}-${j}`} className="font-semibold tabular-nums text-iqi-ink">
            {part}
          </span>,
        )
      } else {
        out.push(<span key={`${keyPrefix}-t${i}-${j}`}>{part}</span>)
      }
      PRICE.lastIndex = 0
    })
  })

  return out
}

const isBullet = (line) => /^\s*[-*•]\s+/.test(line)
const stripBullet = (line) => line.replace(/^\s*[-*•]\s+/, '')

// Group consecutive bullet lines so a run of listings renders as one list
// rather than a series of orphaned lines.
function toBlocks(text) {
  const blocks = []
  let list = null

  text.split('\n').forEach((line) => {
    const trimmed = line.trim()

    if (isBullet(trimmed)) {
      list ||= { type: 'list', items: [] }
      list.items.push(stripBullet(trimmed))
      return
    }

    if (list) {
      blocks.push(list)
      list = null
    }
    if (trimmed) blocks.push({ type: 'p', text: trimmed })
  })

  if (list) blocks.push(list)
  return blocks
}

export default function ChatMessage({ text }) {
  const blocks = toBlocks(text || '')

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) =>
        block.type === 'list' ? (
          <ul key={i} className="flex flex-col gap-1.5">
            {block.items.map((item, j) => (
              <li key={j} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-iqi-accent" />
                <span className="leading-relaxed">{renderInline(item, `${i}-${j}`)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="leading-relaxed">
            {renderInline(block.text, String(i))}
          </p>
        ),
      )}
    </div>
  )
}
