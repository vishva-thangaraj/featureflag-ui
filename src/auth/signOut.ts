import { toast } from 'sonner'
import { logout } from './session'

/** Signs out everywhere. The guards move the user on; this only has to report a failure. */
export function signOut(): void {
  logout().catch(() => {
    toast.error("Couldn't sign out. Check your connection and try again.")
  })
}
