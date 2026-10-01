import type { SupportPreferences } from '../../../shared/contracts'
import { Choice, Field, Toggle } from './fields'
import { SUPPORT_CHOICES, SUPPORT_NOTE } from './labels'
import s from './adult.module.css'

const TOGGLES: { key: keyof SupportPreferences; label: string; help?: string }[] = [
  { key: 'readAloud', label: 'Uppläsning', help: 'En knapp för att lyssna. Ingenting läses upp automatiskt.' },
  { key: 'stepByStep', label: 'Steg för steg', help: 'Uppgifter delas upp i mindre steg.' },
  { key: 'extraThinkingTime', label: 'Extra betänketid', help: 'Lugnare tempo i förslag och påminnelser.' },
  { key: 'reducedMotion', label: 'Mindre rörelse', help: 'Inga animationer.' },
  { key: 'reducedVisualComplexity', label: 'Enklare skärmbild', help: 'Färre saker på skärmen samtidigt.' },
  { key: 'sound', label: 'Ljudeffekter' },
]

/** All support preferences as plain-Swedish choices. */
export function SupportFields({
  value,
  onChange,
}: {
  value: SupportPreferences
  onChange: (patch: Partial<SupportPreferences>) => void
}) {
  return (
    <div className={s.stack}>
      <p className={s.note}>{SUPPORT_NOTE}</p>
      {SUPPORT_CHOICES.map((c) => (
        <Choice
          key={c.key}
          legend={c.legend}
          value={value[c.key]}
          options={c.options}
          onChange={(v) => onChange({ [c.key]: v })}
        />
      ))}
      <Field label="Längd på ett pass (minuter)" help="Mellan 3 och 120 minuter.">
        {(id, d) => (
          <input
            id={id}
            type="number"
            min={3}
            max={120}
            aria-describedby={d}
            value={value.sessionMinutes}
            onChange={(e) => onChange({ sessionMinutes: Number(e.target.value) })}
          />
        )}
      </Field>
      {TOGGLES.map((t) => (
        <Toggle
          key={t.key}
          label={t.label}
          help={t.help}
          checked={!!value[t.key]}
          onChange={(v) => onChange({ [t.key]: v })}
        />
      ))}
    </div>
  )
}
