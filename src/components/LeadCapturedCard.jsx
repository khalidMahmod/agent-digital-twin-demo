// Shows what Atlas actually recorded once a twin conversation ends: the lead
// row, the qualification verdict, and the fields the scorer extracted from the
// transcript.
//
// This is the point of the product made visible — without it the Atlas side is
// invisible from the profile page. It only renders when the Atlas instance
// returns an inspection payload, which is disabled in production: a real buyer
// must never see how they were scored.

function Field({ label, value }) {
  if (!value) return null
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-iqi-ink-faint">{label}</span>
      <span className="font-semibold text-iqi-ink text-right">{value}</span>
    </div>
  )
}

export default function LeadCapturedCard({ lead }) {
  if (!lead) return null

  return (
    <div className="mt-4 rounded-xl border border-iqi-live/40 bg-iqi-live/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-iqi-live" />
        <span className="text-[13px] font-extrabold text-iqi-ink">
          Lead #{lead.id} created in Atlas
        </span>
        <span
          className={`ml-auto text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${
            lead.qualified
              ? 'bg-iqi-live/15 text-iqi-live'
              : 'bg-iqi-ink-faint/15 text-iqi-ink-faint'
          }`}
        >
          {lead.qualified ? 'Qualified' : 'Not qualified'}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <Field label="Buyer" value={lead.buyer_name} />
        <Field label="Phone" value={lead.buyer_phone_number} />
        <Field label="Email" value={lead.buyer_email} />
        <Field label="Assigned to" value={lead.agent_name} />
        <Field label="Status" value={lead.status} />
        <Field label="Source" value={lead.source} />
        <Field label="Budget" value={lead.budget} />
        <Field label="Timing" value={lead.purchase_timing} />
        <Field label="Motivation" value={lead.motivation} />
      </div>

      {lead.summary ? (
        <p className="mt-3 pt-3 border-t border-iqi-live/20 text-[12px] leading-relaxed text-iqi-ink-dim">
          <span className="font-semibold text-iqi-ink">For the agent: </span>
          {lead.summary}
        </p>
      ) : null}
    </div>
  )
}
