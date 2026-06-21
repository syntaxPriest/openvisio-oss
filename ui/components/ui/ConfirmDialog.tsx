'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive actions get a red confirm button. */
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** A small yes/no modal — the in-app replacement for window.confirm(). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  // Esc cancels, Enter confirms; focus the confirm button on open.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => confirmRef.current?.focus(), 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onConfirm, onCancel])

  if (!open) return null

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="modal-card w-[380px] max-w-full rounded-2xl border border-black/5 bg-[color:var(--color-ink-0)] p-6 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.45)]"
      >
        <h3 className="text-[14px] font-semibold leading-tight text-[color:var(--color-ink-8)]">{title}</h3>
        {message ? (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[color:var(--color-muted)]">{message}</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[color:var(--color-ink-3)] bg-[color:var(--color-ink-0)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--color-ink-7)] transition-colors hover:border-[color:var(--color-ink-5)] hover:text-[color:var(--color-ink-8)]"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={cn(
              'rounded-md px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-1',
              destructive
                ? 'bg-[color:var(--color-hot-2)] focus:ring-[color:var(--color-hot-2)]'
                : 'bg-[color:var(--color-accent)] focus:ring-[color:var(--color-accent)]',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
