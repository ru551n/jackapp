import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { paths } from '../app/paths'
import { Icon } from './Icon'
import styles from './Shell.module.css'

interface ShellProps {
  title: string
  /** Show the home button (all screens except the home screen). */
  home?: boolean
  right?: ReactNode
  children: ReactNode
}

let firstScreen = true

/** Consistent frame for every screen: home button top-left, title, content. */
export function Shell({ title, home = true, right, children }: ShellProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  // Announce screen changes: page title, and focus on the heading (except on first load).
  useEffect(() => {
    document.title = `${title} – JackApp`
    if (firstScreen) firstScreen = false
    else titleRef.current?.focus({ preventScroll: true })
  }, [title])
  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <div className={styles.side}>
          {home && (
            <Link to={paths.home} className={styles.home}>
              <Icon name="home" />
              <span>Hem</span>
            </Link>
          )}
        </div>
        <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
          {title}
        </h1>
        <div className={`${styles.side} ${styles.right}`}>{right}</div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  )
}
