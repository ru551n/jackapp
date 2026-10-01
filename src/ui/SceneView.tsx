import { Fragment } from 'react'
import { Sprite } from '../art/sprites'
import { VehicleArt } from '../art/vehicles'
import { vehicleById } from '../content/vehicles'
import type { Scene, SceneItem } from '../core/types'
import styles from './SceneView.module.css'

/** Renders declarative Scene data. The only place that knows how content becomes pixels. */
export function SceneView({ scene, compact = false }: { scene: Scene; compact?: boolean }) {
  switch (scene.kind) {
    case 'row':
      return <Row items={scene.items} label={scene.label} compact={compact} />
    case 'sign':
      return (
        <div
          className={`${styles.sign} ${styles[`sign_${scene.style}`]}`}
          lang={scene.lang === 'en' ? 'en' : undefined}
        >
          {scene.text}
        </div>
      )
    case 'vehicle': {
      const v = vehicleById(scene.vehicle)
      if (!v) return null
      return (
        <div
          className={`${styles.vehicle} ${compact ? styles.compact : ''}`}
          style={scene.scale ? { ['--vehicle-scale' as string]: scene.scale } : undefined}
        >
          <VehicleArt
            vehicle={v}
            mode={scene.view === 'silhouette' ? 'silhouette' : 'color'}
            className={styles.vehicleArt}
          />
        </div>
      )
    }
    case 'number':
      return <div className={styles.number}>{scene.value}</div>
    case 'equation':
      return (
        <div className={styles.equation} aria-label={scene.terms.join(' ')}>
          {scene.terms.map((t, i) => (
            <span key={i} className={t === '?' ? styles.unknown : undefined}>
              {t}
            </span>
          ))}
        </div>
      )
    case 'text':
      return (
        <div
          className={`${styles.text} ${styles[`text_${scene.size ?? 'lg'}`]}`}
          lang={scene.lang === 'en' ? 'en' : undefined}
        >
          {scene.text}
        </div>
      )
    case 'group':
      return (
        <div className={scene.direction === 'row' ? styles.groupRow : styles.groupColumn}>
          {scene.scenes.map((s, i) => (
            <SceneView key={i} scene={s} compact={compact} />
          ))}
        </div>
      )
  }
}

function Row({ items, label, compact }: { items: SceneItem[]; label?: string; compact: boolean }) {
  return (
    <figure className={`${styles.row} ${compact ? styles.compact : ''}`}>
      <div className={styles.items} aria-hidden={label ? true : undefined}>
        {items.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && item.group !== undefined && item.group !== items[i - 1].group && (
              <span className={styles.groupGap} />
            )}
            <span className={`${styles.item} ${item.state ? styles[item.state] : ''}`}>
              <Sprite id={item.sprite} tint={item.tint} className={styles.sprite} />
            </span>
          </Fragment>
        ))}
      </div>
      {label && <figcaption className="visually-hidden">{label}</figcaption>}
    </figure>
  )
}
