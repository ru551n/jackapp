import { AREAS, SKILL_NAMES } from '../../core/catalog'
import { MAX_LEVEL, type Level, type SkillId, type SkillProgress } from '../../core/types'
import { VEHICLES, isUnlocked } from '../../content/vehicles'
import { trendOf, type Trend } from '../../engine/adaptation'
import { actions, useAppState } from '../../store/store'
import s from './parent.module.css'

const TREND: Record<Trend, string> = {
  new: 'ny, för lite data än',
  easy: 'går lätt',
  ok: 'på gång',
  hard: 'svårt just nu',
}
// Fewer than 3 attempts is too little data for a trend.
const trendFor = (p: SkillProgress | undefined): Trend => ((p?.attempts ?? 0) < 3 ? 'new' : trendOf(p))
const LEVELS: Level[] = [1, 2, 3, 4, 5]

function Dots({ level }: { level: number }) {
  return (
    <span className={s.dots} aria-hidden="true">
      {LEVELS.map((l) => (
        <span key={l} className={`${s.dot} ${l <= level ? s.dotOn : ''}`} />
      ))}
    </span>
  )
}

export function Dashboard() {
  const st = useAppState((x) => x)
  const unlocked = VEHICLES.filter((v) => isUnlocked(v, st.missions)).length
  const skills = AREAS.flatMap((a) => a.skills)
  const withTrend = (t: Trend) => skills.filter((k) => trendFor(st.progress[k]) === t)
  const list = (t: Trend) =>
    withTrend(t)
      .map((k) => SKILL_NAMES[k])
      .join(', ') || 'Inget just nu'
  const date = (at: number) => new Date(at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })

  return (
    <>
      <section className={s.card} aria-labelledby="sum-h">
        <h2 id="sum-h">Sammanfattning</h2>
        <dl>
          {AREAS.map((a) => (
            <div key={a.id}>
              <dt>{a.subject}: genomförda uppdrag</dt>
              <dd>{st.missions[a.id]}</dd>
            </div>
          ))}
          <div>
            <dt>Samling</dt>
            <dd>
              {unlocked} av {VEHICLES.length} fordon upplåsta
            </dd>
          </div>
          <div>
            <dt>Går bra</dt>
            <dd>{list('easy')}</dd>
          </div>
          <div>
            <dt>Behöver stöd</dt>
            <dd>{list('hard')}</dd>
          </div>
        </dl>
      </section>

      <section className={s.card} aria-labelledby="skills-h">
        <h2 id="skills-h">Färdigheter</h2>
        <p className={s.muted}>Lås nivån pausar automatiska nivåbyten för färdigheten.</p>
        {AREAS.map((a) => (
          <div key={a.id} className={s.scroll}>
            <table className={s.table}>
              <caption>
                <h3>{a.subject}</h3>
              </caption>
              <thead>
                <tr>
                  <th>Färdighet</th>
                  <th>Nivå</th>
                  <th>Utveckling</th>
                  <th>Försök</th>
                  <th>Rätt på första</th>
                  <th>Ledtrådar</th>
                  <th>Ändra nivå</th>
                </tr>
              </thead>
              <tbody>
                {a.skills.map((k) => (
                  <SkillRow key={k} skill={k} />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section className={s.card} aria-labelledby="rec-h">
        <h2 id="rec-h">Senaste uppdrag</h2>
        {st.sessions.length === 0 ? (
          <p className={s.muted}>Inga uppdrag ännu.</p>
        ) : (
          <ul>
            {st.sessions
              .slice(-10)
              .reverse()
              .map((x, i) => (
                <li key={i}>
                  {date(x.at)}: {AREAS.find((a) => a.id === x.area)?.subject}, {x.firstTry} av {x.total} rätt på första
                </li>
              ))}
          </ul>
        )}
      </section>
    </>
  )
}

function SkillRow({ skill }: { skill: SkillId }) {
  const p = useAppState((x) => x.progress[skill])
  const level = p?.level ?? 1
  const locked = p?.levelLocked ?? false
  const share = p && p.attempts ? `${Math.round((p.firstTry / p.attempts) * 100)} %` : '–'
  return (
    <tr>
      <th scope="row">{SKILL_NAMES[skill]}</th>
      <td>
        <Dots level={level} />
        Nivå {level} av {MAX_LEVEL}
      </td>
      <td>{TREND[trendFor(p)]}</td>
      <td>{p?.attempts ?? 0}</td>
      <td>{share}</td>
      <td>{p?.hintsUsed ?? 0}</td>
      <td>
        <select
          className={s.select}
          aria-label={`Nivå för ${SKILL_NAMES[skill]}`}
          value={level}
          onChange={(e) => actions.setSkillLevel(skill, Number(e.target.value) as Level, locked)}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={locked}
            aria-label={`Lås nivån för ${SKILL_NAMES[skill]}`}
            onChange={(e) => actions.setSkillLevel(skill, level, e.target.checked)}
          />
          Lås nivån
        </label>
      </td>
    </tr>
  )
}
