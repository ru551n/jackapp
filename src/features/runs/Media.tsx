import { useEffect, useState } from 'react'
import { API_PREFIX, type MediaRef } from '../../../shared/contracts'
import { api } from '../../api/client'
import styles from './runs.module.css'

/** Licences that need no visible credit (mirrors server/research/routes.ts). */
const NO_ATTRIBUTION = new Set(['CC0-1.0', 'PD', 'project-owned', 'ai-generated'])

interface Attribution {
  attributionRequired: boolean
  attribution?: string
}

/** An image with alt text, a discreet "AI-bild" label and the licence credit when required. */
export function MediaImage({ media, large }: { media: MediaRef; large?: boolean }) {
  const needsCredit = !media.generated && !NO_ATTRIBUTION.has(media.license.license)
  const [credit, setCredit] = useState(media.license.attribution)
  useEffect(() => {
    if (!needsCredit) return
    let live = true
    api
      .get<Attribution>(`/assets/${media.assetId}/attribution`)
      .then((a) => live && a.attributionRequired && a.attribution && setCredit(a.attribution))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [media.assetId, needsCredit])
  return (
    <figure className={[styles.figure, large && styles.figureLarge].filter(Boolean).join(' ')}>
      <img src={`${API_PREFIX}/assets/${media.assetId}`} alt={media.alt} />
      {(media.generated || (needsCredit && credit)) && (
        <figcaption>
          {media.generated && <span className={styles.aiLabel}>AI-bild</span>}
          {needsCredit && credit && <span>{credit}</span>}
        </figcaption>
      )}
    </figure>
  )
}

export function MediaList({ media, large }: { media?: MediaRef[]; large?: boolean }) {
  if (!media?.length) return null
  return (
    <div className={styles.media}>
      {media.map((m) => (
        <MediaImage key={m.assetId} media={m} large={large} />
      ))}
    </div>
  )
}
