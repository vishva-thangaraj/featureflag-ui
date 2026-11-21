import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** "Flag key" reads "Copy flag key", while an acronym such as "SDK" keeps its case. */
const inSentence = (label: string) => (/^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label)

/** Every identifier gets one: keys and ids are typed into code and terminals, where a typo is silent. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const name = `Copy ${inSentence(label)}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error("Couldn't copy. Select the text and copy it instead.")
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger
        asChild
        // On focus only with a focus ring: focus moved here by code, after a click, shouldn't pop it open.
        onFocus={(event) => {
          if (!event.currentTarget.matches(':focus-visible')) {
            event.preventDefault()
          }
        }}
      >
        <Button type="button" variant="ghost" size="icon-sm" aria-label={name} onClick={() => void copy()}>
          <Copy aria-hidden="true" className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  )
}
