import type { ReactNode } from 'react'
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

/** Consistent frame for every screen: home button top-left, title, content. */
export function Shell({ title, home = true, right, children }: ShellProps) {
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
        <h1 className={styles.title}>{title}</h1>
        <div className={`${styles.side} ${styles.right}`}>{right}</div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  )
}
