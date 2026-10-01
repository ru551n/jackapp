import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from './Icon'
import styles from './Button.module.css'

type Variant = 'primary' | 'secondary' | 'quiet'

interface Common {
  variant?: Variant
  icon?: IconName
  children: ReactNode
}

const cls = (variant: Variant, extra?: string) => [styles.button, styles[variant], extra].filter(Boolean).join(' ')

export function Button({ variant = 'primary', icon, children, className, ...rest }: Common & ComponentProps<'button'>) {
  return (
    <button type="button" className={cls(variant, className)} {...rest}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </button>
  )
}

export function LinkButton({ to, variant = 'primary', icon, children }: Common & { to: string }) {
  return (
    <Link to={to} className={cls(variant)}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </Link>
  )
}
