// Small inline icon set (decorative; buttons always carry text too).
const PATHS = {
  home: 'M4 11 L12 4 L20 11 V20 H14 V14 H10 V20 H4 Z',
  back: 'M14 5 L7 12 L14 19',
  speaker: 'M4 9 H8 L13 5 V19 L8 15 H4 Z M16 9 Q18 12 16 15 M18.5 7 Q22 12 18.5 17',
  check: 'M5 12.5 L10 17 L19 7',
  lock: 'M7 11 V8 A5 5 0 0 1 17 8 V11 M5 11 H19 V20 H5 Z',
  arrow: 'M5 12 H18 M13 7 L18 12 L13 17',
  star: 'M12 4 L14.4 9.2 L20 9.8 L15.8 13.6 L17 19.2 L12 16.3 L7 19.2 L8.2 13.6 L4 9.8 L9.6 9.2 Z',
  gear: 'M12 8.5 A3.5 3.5 0 1 0 12 15.5 A3.5 3.5 0 1 0 12 8.5 M12 2.5 V5.5 M12 18.5 V21.5 M2.5 12 H5.5 M18.5 12 H21.5 M5.3 5.3 L7.4 7.4 M16.6 16.6 L18.7 18.7 M5.3 18.7 L7.4 16.6 M16.6 7.4 L18.7 5.3',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 28 }: { name: IconName; size?: number }) {
  const filled = name === 'home' || name === 'star'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={PATHS[name]}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 1 : 2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
