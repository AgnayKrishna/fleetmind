// Small Baltic Amber building blocks: glass panel, buttons, status chip, tinted badge.
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { STATUS, type StatusKey } from '@/lib/fleet'

export function Panel({ className, ...p }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('glass rounded-[22px] text-ink', className)} {...p} />
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'; size?: 'sm' | 'md' | 'lg' }

/** One amber primary per panel; secondary buttons use the chip fill. At least 44 px tall (sm is for dense rows). */
export function Btn({ tone = 'secondary', size = 'md', className, ...p }: BtnProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[14px] font-bold whitespace-nowrap transition-[background,transform,opacity] duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber active:translate-y-px disabled:opacity-50 disabled:pointer-events-none',
        size === 'sm' && 'min-h-9 px-3 text-[13px] rounded-[10px]',
        size === 'md' && 'min-h-11 px-4 text-[14px]',
        size === 'lg' && 'min-h-12 px-5 text-[15px]',
        tone === 'primary' && 'bg-amber text-on-amber hover:brightness-[1.04] font-extrabold',
        tone === 'secondary' && 'bg-chip text-ink hover:bg-[color-mix(in_srgb,var(--fm-chip),var(--fm-ink)_6%)]',
        tone === 'ghost' && 'text-ink hover:bg-chip',
        tone === 'outline' && 'border border-line text-ink hover:bg-chip',
        tone === 'danger' && 'bg-act-tint text-act-text hover:brightness-95',
        className,
      )}
      {...p}
    />
  )
}

export function StatusChip({ status, className }: { status: StatusKey; className?: string }) {
  const s = STATUS[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-bold whitespace-nowrap', className)}
      style={{ background: s.tint, color: s.text, border: status === 'nosignal' ? '1px dashed #8A8F98' : undefined }}>
      <span className="size-1.5 rounded-full" style={{ background: s.dot }} />
      {s.label}
    </span>
  )
}

const TINTS = {
  amber: 'bg-amber-tint text-amber-text', good: 'bg-good-tint text-good-text', watch: 'bg-watch-tint text-watch-text',
  act: 'bg-act-tint text-act-text', load: 'bg-load-tint text-load-text', neutral: 'bg-chip text-muted-ink',
}

export function Badge({ tone = 'neutral', children, className, title }: { tone?: keyof typeof TINTS; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-bold whitespace-nowrap', TINTS[tone], className)}>{children}</span>
}

export function SampleTag() {
  return <span title="Made-up stations and prices until real data is connected"
    className="inline-flex rounded-full border border-dashed border-line px-2 text-[11px] font-semibold text-muted-ink">Sample data</span>
}

export function Dots() {
  return <span className="dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true" className="shrink-0">
      <rect width="30" height="30" rx="9" fill="var(--fm-amber)" />
      <path d="M8 19h9l3-5h3v5h-2" fill="none" stroke="#1C1408" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
