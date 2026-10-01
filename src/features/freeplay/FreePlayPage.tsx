import { useState } from 'react'
import { Navigate } from 'react-router'
import { paths } from '../../app/paths'
import type { FreeLine } from '../../core/types'
import { actions, useAppState } from '../../store/store'
import { Button } from '../../ui/Button'
import { Shell } from '../../ui/Shell'
import { Sprite } from '../../art/sprites'
import { LineMap } from './LineMap'
import { StationPanel } from './StationPanel'
import { MAX_STATIONS, VEHICLES, addAtFreeSpot, addStation, emptyLine, removeLast, renameStation } from './model'
import { prefersReducedMotion, useRunner } from './useRunner'
import styles from './FreePlay.module.css'

export function FreePlayPage() {
  const enabled = useAppState((s) => s.settings.freePlayEnabled)
  if (!enabled) return <Navigate to={paths.home} replace />
  return <Builder />
}

function Builder() {
  const line = useAppState((s) => s.freePlay.line) ?? emptyLine
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const reduced = prefersReducedMotion()
  const { stations } = line
  const runner = useRunner(stations, reduced)
  const save = (next: FreeLine) => actions.setFreeLine(next)
  const sel = stations.find((s) => s.id === selected)
  const full = stations.length >= MAX_STATIONS
  const here = runner.at === null ? null : stations[runner.at]
  const next = stations[runner.running || runner.at === null ? runner.to : runner.at + 1]

  return (
    <Shell title="Bygg din linje">
      <div className={styles.page}>
        <div className={styles.mapBox}>
          <LineMap
            line={line}
            d={runner.d}
            selected={selected}
            onAdd={(x, y) => save(addStation(line, x, y))}
            onSelect={setSelected}
          />
        </div>
        <div className={styles.side}>
          <div className={styles.sign} aria-live="polite">
            {stations.length < 2 ? (
              <span>Lägg till minst två stationer</span>
            ) : (
              <>
                <span>{here ? `Här: ${here.name}` : 'På väg'}</span>
                <strong>{next ? `Nästa: ${next.name}` : 'Slutstation'}</strong>
              </>
            )}
          </div>
          <div className={styles.row} role="group" aria-label="Fordon">
            {VEHICLES.map((v) => (
              <Button
                key={v.id}
                variant={line.vehicle === v.id ? 'primary' : 'secondary'}
                aria-pressed={line.vehicle === v.id}
                onClick={() => save({ ...line, vehicle: v.id })}
              >
                <Sprite id={v.sprite} className={styles.icon} /> {v.label}
              </Button>
            ))}
          </div>
          <div className={styles.row}>
            <Button variant="secondary" disabled={full} onClick={() => save(addAtFreeSpot(line))}>
              Lägg till station
            </Button>
            <Button variant="secondary" disabled={!stations.length} onClick={() => save(removeLast(line))}>
              Ta bort sista stationen
            </Button>
          </div>
          <div className={styles.row}>
            {reduced ? (
              <Button disabled={stations.length < 2} onClick={runner.step}>
                Nästa station
              </Button>
            ) : runner.running ? (
              <Button onClick={runner.stop}>Stoppa</Button>
            ) : (
              <Button disabled={stations.length < 2} onClick={runner.start}>
                Kör
              </Button>
            )}
            {confirming ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    save(emptyLine)
                    setConfirming(false)
                    setSelected(null)
                  }}
                >
                  Ja, börja om
                </Button>
                <Button variant="quiet" onClick={() => setConfirming(false)}>
                  Nej
                </Button>
              </>
            ) : (
              <Button variant="quiet" disabled={!stations.length} onClick={() => setConfirming(true)}>
                Börja om
              </Button>
            )}
          </div>
          {sel && (
            <StationPanel
              key={sel.id}
              name={sel.name}
              onPick={(n) => save(renameStation(line, sel.id, n))}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      </div>
    </Shell>
  )
}
