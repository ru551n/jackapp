import s from './adult.module.css'

// Placeholders for components owned by the study and runs areas (src/features/study, src/features/runs).
// When those land, replace each placeholder with a re-export, e.g.
//   export { StudyUpload, StudySetView } from '../study'
//   export { RunHistory } from '../runs'

const Soon = ({ what }: { what: string }) => <p className={s.muted}>{what} kommer här.</p>

export function StudyUpload(_: { learnerId: string }) {
  return <Soon what="Uppladdning av studiematerial" />
}

export function StudySetView(_: { learnerId: string; setId: string }) {
  return <Soon what="Visning av studiematerialet" />
}

export function RunHistory(_: { learnerId: string }) {
  return <Soon what="Historik över genomförda övningar" />
}
