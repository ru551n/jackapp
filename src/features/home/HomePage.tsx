import { Link } from 'react-router'
import { paths } from '../../app/paths'
import { Sprite } from '../../art/sprites'
import { AREAS } from '../../core/catalog'
import type { SpriteId } from '../../core/types'
import { useAppState } from '../../store/store'
import { Shell } from '../../ui/Shell'
import { AREA_SPRITE } from './areaArt'
import styles from './HomePage.module.css'

function Destination({
  to,
  sprite,
  name,
  tagline,
  variant,
}: {
  to: string
  sprite: SpriteId
  name: string
  tagline: string
  variant?: 'collection' | 'play'
}) {
  return (
    <li>
      <Link to={to} className={`${styles.card} ${variant ? styles[variant] : ''}`}>
        <Sprite id={sprite} className={styles.art} />
        <span className={styles.name}>{name}</span>
        <span className={styles.tagline}>{tagline}</span>
      </Link>
    </li>
  )
}

export function HomePage() {
  const freePlay = useAppState((s) => s.settings.freePlayEnabled)
  return (
    <Shell title="Mitt äventyr" home={false}>
      <nav aria-label="Välj vart du vill åka">
        <ul className={styles.grid}>
          {AREAS.map((a) => (
            <Destination
              key={a.id}
              to={paths.area(a.id)}
              sprite={AREA_SPRITE[a.id]}
              name={a.name}
              tagline={a.tagline}
            />
          ))}
          <Destination
            to={paths.collection}
            sprite="jet"
            name="Min samling"
            tagline="Dina tåg och flygplan"
            variant="collection"
          />
          {freePlay && (
            <Destination
              to={paths.freePlay}
              sprite="signal"
              name="Bygg din linje"
              tagline="Bygg och kör fritt"
              variant="play"
            />
          )}
        </ul>
      </nav>
      <footer className={styles.footer}>
        <Link to={paths.parent} className={styles.parent}>
          För vuxna
        </Link>
      </footer>
    </Shell>
  )
}
