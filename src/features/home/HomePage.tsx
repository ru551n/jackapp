import { Children, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { usePaths } from '../../app/paths'
import { Sprite } from '../../art/sprites'
import { AREAS } from '../../core/catalog'
import type { SpriteId } from '../../core/types'
import { useAppState } from '../../store/store'
import { Button, LinkButton } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { Shell } from '../../ui/Shell'
import { AREA_SPRITE } from './areaArt'
import styles from './HomePage.module.css'

export function Destination({
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
        <span className={styles.tagline} data-secondary>
          {tagline}
        </span>
      </Link>
    </li>
  )
}

/**
 * The early-years home. `lead` destinations come first, `children` after the built-in ones (list items).
 * With `max`, only that many tiles show and the rest wait behind a "Mer" tile.
 */
export function HomePage({ lead, children, max }: { lead?: ReactNode; children?: ReactNode; max?: number }) {
  const paths = usePaths()
  const freePlay = useAppState((s) => s.settings.freePlayEnabled)
  const [more, setMore] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const list = useRef<HTMLUListElement>(null)
  const tiles = Children.toArray([
    lead,
    ...AREAS.map((a) => (
      <Destination key={a.id} to={paths.area(a.id)} sprite={AREA_SPRITE[a.id]} name={a.name} tagline={a.tagline} />
    )),
    <Destination
      key="collection"
      to={paths.collection}
      sprite="jet"
      name="Min samling"
      tagline="Dina tåg och flygplan"
      variant="collection"
    />,
    freePlay && (
      <Destination
        key="play"
        to={paths.freePlay}
        sprite="signal"
        name="Bygg din linje"
        tagline="Bygg och kör fritt"
        variant="play"
      />
    ),
    children,
  ])
  const limited = max !== undefined && !more && tiles.length > max
  const showMore = () => {
    setMore(true)
    // Keep keyboard focus in place: the first tile that was hidden takes over from "Mer".
    requestAnimationFrame(() => list.current?.querySelectorAll('a')[max ?? 0]?.focus())
  }
  return (
    <Shell title="Mitt äventyr" home={false}>
      <nav aria-label="Välj vart du vill åka">
        <ul ref={list} className={styles.grid}>
          {limited ? tiles.slice(0, max) : tiles}
          {limited && (
            <li>
              <button type="button" className={styles.card} onClick={showMore}>
                <span className={styles.more} aria-hidden="true">
                  <Icon name="arrow" size={64} />
                </span>
                <span className={styles.name}>Mer</span>
                <span className={styles.tagline} data-secondary>
                  Fler saker att göra
                </span>
              </button>
            </li>
          )}
        </ul>
      </nav>
      <footer className={styles.footer}>
        {leaving ? (
          <div className={styles.leave} role="group" aria-labelledby="leave-q">
            <p id="leave-q" className={styles.leaveQ}>
              Vill du byta till någon annan?
            </p>
            <LinkButton to={paths.picker} variant="secondary">
              Ja
            </LinkButton>
            <Button autoFocus onClick={() => setLeaving(false)}>
              Nej
            </Button>
          </div>
        ) : (
          // A link (works without the question too), but asks first so a sibling's area needs a choice.
          <Link
            to={paths.picker}
            className={styles.parent}
            onClick={(e) => {
              e.preventDefault()
              setLeaving(true)
            }}
          >
            Byt elev
          </Link>
        )}
      </footer>
    </Shell>
  )
}
