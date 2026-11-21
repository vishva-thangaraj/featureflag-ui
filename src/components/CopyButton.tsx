import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/** Every identifier gets one: keys and ids are typed into code and terminals, where a typo is silent. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error("Couldn't copy. Select the text and copy it instead.")
    }
  }

  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => void copy()}>
      <Copy aria-hidden="true" className="size-3.5" />
    </Button>
  )
}
