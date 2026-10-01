import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { usePaths } from '../../app/paths'
import { Shell } from '../../ui/Shell'
import { useLearner } from './context'
import styles from './learner.module.css'

/** Screen frame: the calm early-years Shell, or a denser header for middle and upper. Exit is always there. */
export function Frame({ title, home = true, children }: { title: string; home?: boolean; children: ReactNode }) {
  const { learner, flags } = useLearner()
  const paths = usePaths()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const early = flags.band === 'early'
  useEffect(() => {
    if (early) return
    document.title = `${title} – JackApp`
    titleRef.current?.focus({ preventScroll: true })
  }, [title, early])

  if (early) {
    return (
      <Shell title={title} home={home}>
        {children}
      </Shell>
    )
  }
  return (
    <div className={styles.band}>
      <header className={styles.bar}>
        <span className={styles.who}>{learner.displayName}</span>
        <nav aria-label="Meny" className={styles.nav}>
          {home && <Link to={paths.home}>Hem</Link>}
          <Link to={paths.picker}>Byt elev</Link>
        </nav>
      </header>
      <main className={styles.main}>
        <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
          {title}
        </h1>
        {children}
      </main>
    </div>
  )
}
