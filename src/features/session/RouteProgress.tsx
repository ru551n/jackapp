import styles from './RouteProgress.module.css'

/** Session progress drawn as a route line with stations: done, current, upcoming. */
export function RouteProgress({ total, current }: { total: number; current: number }) {
  return (
    <ol className={styles.route} aria-label={`Uppgift ${Math.min(current + 1, total)} av ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <li
          key={i}
          className={i < current ? styles.done : i === current ? styles.current : styles.todo}
          aria-current={i === current ? 'step' : undefined}
        />
      ))}
    </ol>
  )
}
