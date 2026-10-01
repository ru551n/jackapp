import { useState } from 'react'
import { Link } from 'react-router'
import { Button, LinkButton } from '../../ui/Button'
import {
  adultApi,
  errorText,
  paths,
  useResource,
  type ArtifactSummary,
  type LearnerListItem,
  type SkillsResponse,
  type SystemStatus,
} from './api'
import { ActiveCount } from './Creations'
import { AGE_BAND, formatDate, schoolLabel, UNNAMED_SKILL } from './labels'
import { Page } from './Page'
import { NewPin } from './PinPad'
import s from './adult.module.css'

export const AI_UNAVAILABLE =
  'AI-funktionerna är inte tillgängliga. Den som driftar JackApp behöver kontrollera inställningarna.'

function Highlights({ id }: { id: string }) {
  const skills = useResource<SkillsResponse>(paths.skills(id))
  const pending = useResource<ArtifactSummary[]>(paths.artifacts(id, '?approval=pendingApproval'))
  const list = skills.data?.skills ?? []
  const leaf = (st: string) => list.filter((k) => k.status === st && k.skill.split('.').length > 1).slice(0, 3)
  const support = leaf('needsSupport')
  const good = leaf('secure')
  const last = list
    .map((k) => k.lastPracticedAt)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1)
  const nPending = pending.data?.length ?? 0
  return (
    <div className={s.stack}>
      <p className={s.muted}>{last ? `Senast aktiv ${formatDate(last)}` : 'Ingen aktivitet ännu'}</p>
      {support.length > 0 && (
        <div>
          <h4 className={s.tagSupport}>Behöver stöd</h4>
          <ul className={s.plain}>
            {support.map((k) => (
              <li key={k.skill}>{k.note ?? UNNAMED_SKILL}</li>
            ))}
          </ul>
        </div>
      )}
      {good.length > 0 && (
        <div>
          <h4 className={s.tagGood}>Går bra</h4>
          <ul className={s.plain}>
            {good.map((k) => (
              <li key={k.skill}>{k.note ?? UNNAMED_SKILL}</li>
            ))}
          </ul>
        </div>
      )}
      {nPending > 0 && (
        <p>
          <Link to={`/vuxen/elev/${id}/material?approval=pendingApproval`}>
            {nPending === 1 ? '1 material väntar på godkännande' : `${nPending} material väntar på godkännande`}
          </Link>
        </p>
      )}
    </div>
  )
}

function LearnerCard({ l }: { l: LearnerListItem }) {
  const base = `/vuxen/elev/${l.id}`
  return (
    <li className={s.card}>
      <div className={s.cardHead}>
        <h3>
          <Link to={base}>{l.displayName}</Link>
        </h3>
        <span className={s.badge}>
          {schoolLabel(l.school)} · {AGE_BAND[l.ageBand]}
        </span>
      </div>
      <Highlights id={l.id} />
      <nav aria-label={`Genvägar för ${l.displayName}`} className={s.links}>
        <Link to={`${base}/skapa`}>Skapa material</Link>
        <Link to={`${base}/material`}>
          Material
          <ActiveCount learnerId={l.id} />
        </Link>
        <Link to={base}>Profil och stöd</Link>
      </nav>
    </li>
  )
}

export function StatusPanel() {
  const status = useResource<SystemStatus>(paths.status)
  if (!status.data) return null
  const { ready, capabilities } = status.data
  return (
    <section className={s.card} aria-labelledby="status-h">
      <h2 id="status-h">Systemstatus</h2>
      {!ready && (
        <p className={s.notice} role="alert">
          {AI_UNAVAILABLE}
        </p>
      )}
      <ul className={s.plain}>
        {capabilities
          .filter((c) => c.configured)
          .map((c) => (
            <li key={c.capability}>
              <span aria-hidden="true" className={c.reachable === 'no' ? s.dotOff : s.dotOn} /> {c.label}
            </li>
          ))}
      </ul>
    </section>
  )
}

function ChangePin() {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  return (
    <section className={s.card} aria-labelledby="pin-h">
      <h2 id="pin-h">Vuxenkod</h2>
      {open ? (
        <NewPin
          onDone={(pin) =>
            adultApi.post('/gate/pin', { pin }).then(
              () => {
                setOpen(false)
                setMsg('Den nya koden är sparad.')
              },
              (e) => setMsg(errorText(e)),
            )
          }
        />
      ) : (
        <div>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Byt kod
          </Button>
        </div>
      )}
      <p role="status" className={s.muted}>
        {msg}
      </p>
    </section>
  )
}

/** `/vuxen`: learners with highlights, system status and the PIN. */
export function Overview() {
  const learners = useResource<LearnerListItem[]>(paths.learners)
  return (
    <Page title="Översikt för vuxna">
      <div className={s.layout}>
        <section aria-labelledby="learners-h" className={s.stack}>
          <div className={s.cardHead}>
            <h2 id="learners-h">Elever</h2>
            <LinkButton to="/vuxen/ny" variant="secondary">
              Lägg till elev
            </LinkButton>
          </div>
          {learners.error && <p className={s.msg}>{learners.error.message}</p>}
          {learners.data?.length === 0 && <p className={s.muted}>Inga elever ännu.</p>}
          <ul className={s.grid}>
            {learners.data?.map((l) => (
              <LearnerCard key={l.id} l={l} />
            ))}
          </ul>
        </section>
        <aside className={s.stack}>
          <StatusPanel />
          <ChangePin />
          <Link to="/vuxen/pagar">Pågår och klart</Link>
          <Link to="/vuxen/om">Om appen: tack och licenser</Link>
        </aside>
      </div>
    </Page>
  )
}
