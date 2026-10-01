import { useParams } from 'react-router'
import { usePaths } from '../../app/paths'
import { VehicleArt } from '../../art/vehicles'
import { isUnlocked, vehicleById } from '../../content/vehicles'
import type { Vehicle, VehicleCategory } from '../../core/types'
import { useAppState } from '../../store/store'
import { LinkButton } from '../../ui/Button'
import { CATEGORY_WORD } from '../../content/english/vocab'
import { Shell } from '../../ui/Shell'
import { SpeakButton } from '../../ui/SpeakButton'
import { vehicleSpeech } from '../../lib/spoken'
import styles from './Collection.module.css'

const CATEGORY_NAME: Record<VehicleCategory, string> = {
  train: 'Tåg',
  metro: 'Tunnelbanetåg',
  tram: 'Spårvagn',
  airliner: 'Passagerarflygplan',
  fighter: 'Stridsflygplan',
}

const isAircraft = (v: Vehicle) => v.category === 'airliner' || v.category === 'fighter'
const meters = (n: number) => `${String(n).replace('.', ',')} meter`

function specRows(v: Vehicle): [string, string][] {
  const s = v.specs
  const rows: [string, string | undefined][] = [
    [isAircraft(v) ? 'Första flygning' : 'Började köra', s.firstYear?.toString()],
    ['Motorer', s.engines?.toString()],
    ['Längd', s.lengthM === undefined ? undefined : meters(s.lengthM)],
    ['Vingbredd', s.wingspanM === undefined ? undefined : meters(s.wingspanM)],
    ['Fart', s.topSpeedKmh === undefined ? undefined : `ungefär ${s.topSpeedKmh} km/h`],
  ]
  return rows.filter((r): r is [string, string] => r[1] !== undefined)
}

export function VehicleDetailPage() {
  const paths = usePaths()
  const { id = '' } = useParams()
  const missions = useAppState((s) => s.missions)
  const vehicle = vehicleById(id)
  const back = (
    <LinkButton to={paths.collection} variant="secondary" icon="back">
      Till samlingen
    </LinkButton>
  )

  if (!vehicle || !isUnlocked(vehicle, missions)) {
    return (
      <Shell title="Min samling">
        <div className={styles.detail}>
          <p className={styles.notice}>Det här fordonet har du inte hittat än. Fortsätt med uppdragen!</p>
          <div className={styles.actions}>{back}</div>
        </div>
      </Shell>
    )
  }

  const rows = specRows(vehicle)
  return (
    <Shell title="Min samling">
      <article className={styles.detail}>
        <div className={styles.hero}>
          <VehicleArt vehicle={vehicle} className={styles.art} />
        </div>
        <header>
          <h2 className={styles.vehicleName}>{vehicle.name}</h2>
          <p className={styles.meta}>
            {CATEGORY_NAME[vehicle.category]} · {vehicle.country}
          </p>
          <p className={styles.meta}>
            På engelska: <span lang="en">{CATEGORY_WORD[vehicle.category]}</span>
          </p>
        </header>
        <ul className={styles.facts}>
          {vehicle.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        {rows.length > 0 && (
          <dl className={styles.specs}>
            {rows.map(([k, val]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{val}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className={styles.actions}>
          <SpeakButton text={vehicleSpeech(vehicle)} />
          {back}
        </div>
      </article>
    </Shell>
  )
}
