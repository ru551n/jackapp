import { useId, type ReactNode } from 'react'
import s from './adult.module.css'

// Small labelled form controls shared by the adult forms.

export function Choice<T extends string | number>({
  legend,
  help,
  value,
  options,
  onChange,
}: {
  legend: string
  help?: ReactNode
  value: T | undefined
  options: readonly (readonly [T, string])[]
  onChange: (v: T) => void
}) {
  const name = useId()
  return (
    <fieldset className={s.choice}>
      <legend>{legend}</legend>
      {help && <p className={s.muted}>{help}</p>}
      <div className={s.options}>
        {options.map(([v, label]) => (
          <label key={String(v)} className={s.option}>
            <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function Toggle({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string
  help?: ReactNode
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  const id = useId()
  return (
    <div className={s.toggle}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={help ? `${id}-h` : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div>
        <label htmlFor={id}>{label}</label>
        {help && (
          <p id={`${id}-h`} className={s.muted}>
            {help}
          </p>
        )}
      </div>
    </div>
  )
}

export function Field({
  label,
  help,
  children,
}: {
  label: string
  help?: string
  children: (id: string, describedBy?: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className={s.field}>
      <label htmlFor={id}>{label}</label>
      {children(id, help ? `${id}-h` : undefined)}
      {help && (
        <p id={`${id}-h`} className={s.muted}>
          {help}
        </p>
      )}
    </div>
  )
}
