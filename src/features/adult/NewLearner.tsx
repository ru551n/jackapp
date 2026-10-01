import { Link, useNavigate } from 'react-router'
import { LearnerBasics } from './LearnerBasics'
import { Page } from './Page'
import s from './adult.module.css'

export function NewLearner() {
  const navigate = useNavigate()
  return (
    <Page title="Ny elev">
      <p className={s.crumb}>
        <Link to="/vuxen">Översikt</Link>
      </p>
      <section className={`${s.card} ${s.narrow}`}>
        <p className={s.muted}>Stöd, nivåer och annat ställer du in på profilen efteråt.</p>
        <LearnerBasics submitLabel="Lägg till" onCreated={(l) => navigate(`/vuxen/elev/${l.id}`)} />
      </section>
    </Page>
  )
}
