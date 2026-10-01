import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router'
import { ageBand } from '../../../shared/contracts'
import { paths, useResource, type LearnerProfile } from './api'
import type { LearnerContext } from './context'
import { ActiveCount } from './Creations'
import { Page } from './Page'
import { AGE_BAND, schoolLabel } from './labels'
import s from './adult.module.css'

const TABS = [
  ['', 'Profil och stöd'],
  ['skapa', 'Skapa material'],
  ['material', 'Material'],
  ['studiematerial', 'Studiematerial'],
] as const

/** `/vuxen/elev/:id/*`: loads the profile once and shows the learner's sub-navigation. */
export function LearnerLayout() {
  const { id = '' } = useParams()
  const resource = useResource<LearnerProfile>(paths.learner(id))
  const { pathname } = useLocation()
  const section = pathname.split(`/elev/${id}/`)[1]?.split('/')[0] ?? ''
  const tab = TABS.find(([p]) => p === section)?.[1] ?? TABS[0][1]
  const learner = resource.data?.id === id ? resource.data : undefined

  return (
    <Page title={learner ? `${learner.displayName} – ${tab}` : tab}>
      <p className={s.crumb}>
        <Link to="/vuxen">Översikt</Link>
        {learner && (
          <span>
            {' '}
            / {learner.displayName} · {schoolLabel(learner.school)} · {AGE_BAND[ageBand(learner.school)]}
          </span>
        )}
      </p>
      <nav aria-label="Elevens sidor" className={s.tabs}>
        {TABS.map(([p, label]) => (
          <NavLink key={p} to={p ? `/vuxen/elev/${id}/${p}` : `/vuxen/elev/${id}`} end={!p}>
            {label}
            {p === 'material' && <ActiveCount learnerId={id} />}
          </NavLink>
        ))}
      </nav>
      {learner ? (
        <Outlet context={{ learner, resource } satisfies LearnerContext} />
      ) : (
        <p role="status" className={s.muted}>
          {resource.error ? resource.error.message : 'Hämtar …'}
        </p>
      )}
    </Page>
  )
}
