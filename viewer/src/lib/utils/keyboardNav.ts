// Tiny shared keyboard-nav helpers used by the graph / group / city views.
// The big rule: don't hijack arrows or +/- when the user is typing in a
// composer, the voice picker, or any contenteditable region.

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (target.isContentEditable) return true
  // React Flow puts its zoom slider on `input[type=range]`, which is already
  // caught above, but the modal/portal-mounted ones bypass tagName checks.
  if (target.getAttribute('role') === 'textbox') return true
  return false
}
