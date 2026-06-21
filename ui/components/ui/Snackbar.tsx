'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastVariant = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  text: string
  variant: ToastVariant
}

const VARIANT: Record<ToastVariant, { Icon: typeof Info; accent: string }> = {
  info: { Icon: Info, accent: 'var(--color-accent)' },
  success: { Icon: CheckCircle2, accent: '#16A34A' },
  error: { Icon: AlertTriangle, accent: 'var(--color-hot-2)' },
}

/** Stacked, dismissible snackbar messages anchored bottom-right. */
export function Snackbar({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[55] flex flex-col gap-2">
      {toasts.map((t) => (
        <SnackbarItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function SnackbarItem({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const { Icon, accent } = VARIANT[toast.variant]
  // Mount-in transition (pure Tailwind, no keyframes).
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(r)
  }, [])

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ minWidth: 240, maxWidth: 380, borderLeft: `3px solid ${accent}` }}
      className={cn(
        'pointer-events-auto flex items-start gap-2.5 rounded-lg border border-[color:var(--color-ink-3)] bg-[color:var(--color-ink-8)] py-2.5 pl-3 pr-2 text-[12px] text-[color:var(--color-ink-0)] shadow-[0_8px_28px_rgba(0,0,0,0.22)] transition-all duration-200 ease-out',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      <Icon size={14} strokeWidth={2} style={{ color: accent }} className="mt-px shrink-0" />
      <span className="flex-1 leading-snug">{toast.text}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="grid size-5 shrink-0 place-items-center rounded text-[color:var(--color-ink-0)]/55 transition-colors hover:bg-white/10 hover:text-[color:var(--color-ink-0)]"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  )
}
