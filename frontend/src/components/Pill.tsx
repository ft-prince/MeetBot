import type { ReactNode } from 'react'

type Variant = 'live' | 'done' | 'pending' | 'neutral'

export function Pill({ variant = 'neutral', children, className = '' }: {
  variant?: Variant
  children: ReactNode
  className?: string
}) {
  const cls =
    variant === 'live' ? 'bg-red-100 text-danger' :
    variant === 'done' ? 'bg-emerald-100 text-success' :
    variant === 'pending' ? 'bg-amber-100 text-warning' :
    'bg-gray-100 text-gray-700'
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${cls} ${className}`}>
      {children}
    </span>
  )
}
