import { Link } from 'react-router'
import { paths } from '../../app/paths'
import { VehicleArt } from '../../art/vehicles'
import { isUnlocked, VEHICLES } from '../../content/vehicles'
import { useAppState } from '../../store/store'
import { Shell } from '../../ui/Shell'

// Placeholder: replaced by the collection milestone.
export function CollectionPage() {
  const missions = useAppState((s) => s.missions)
  return (
    <Shell title="Min samling">
      <ul>
        {VEHICLES.filter((v) => isUnlocked(v, missions)).map((v) => (
          <li key={v.id}>
            <Link to={paths.vehicle(v.id)}>
              <VehicleArt vehicle={v} />
              {v.shortName}
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  )
}
