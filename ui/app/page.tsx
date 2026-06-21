import { redirect } from 'next/navigation'

// The viewer has no separate marketing landing — "/" goes straight into the
// workspace, which shows the open-repo empty state until you index something.
export default function Home() {
  redirect('/workspace')
}
