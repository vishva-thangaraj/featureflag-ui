import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { MoreHorizontal, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { CopyButton } from '@/components/CopyButton'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { fallbackMessage } from '@/lib/form-errors'
import { formatDate } from '@/lib/format'
import { useUpdateFeature, type Feature } from './queries'

interface FlagHeaderProps {
  feature: Feature
  canWrite: boolean
  onDelete: () => void
}

/** The key is read-only (the server cannot rename it); the description edits in place. */
export function FlagHeader({ feature, canWrite, onDelete }: FlagHeaderProps) {
  const updateFeature = useUpdateFeature(feature.id)
  const [editing, setEditing] = useState(false)
  const [description, setDescription] = useState(feature.description ?? '')

  function startEditing() {
    setDescription(feature.description ?? '')
    setEditing(true)
  }

  function save(event?: FormEvent) {
    event?.preventDefault()
    const next = description.trim()
    if (next === (feature.description ?? '')) {
      setEditing(false)
      return
    }
    updateFeature.mutate(next, {
      onSuccess: () => {
        setEditing(false)
        toast.success('Description saved')
      },
      onError: (error) => toast.error(`Couldn't save the description. ${fallbackMessage(error)}`),
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setEditing(false)
    }
  }

  return (
    <header className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <h1 className="truncate font-mono text-xl font-semibold">{feature.key}</h1>
          <CopyButton value={feature.key} label="Flag key" />
        </div>
        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={`More actions for ${feature.key}`}>
                <MoreHorizontal aria-hidden="true" className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                Delete flag
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {editing ? (
        <form onSubmit={save} className="flex max-w-xl flex-wrap items-center gap-2">
          <Input
            autoFocus
            aria-label="Description"
            maxLength={255}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-9 min-w-64 flex-1"
          />
          <Button type="submit" size="sm" disabled={updateFeature.isPending}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-1">
          <p className={feature.description ? 'text-ink-secondary' : 'text-muted-foreground italic'}>
            {feature.description || 'No description'}
          </p>
          {canWrite && (
            <Button variant="ghost" size="icon-sm" aria-label="Edit description" onClick={startEditing}>
              <Pencil aria-hidden="true" className="size-3.5" />
            </Button>
          )}
        </div>
      )}

      <p className="text-sm text-muted-foreground">Created {formatDate(feature.createdAt)}</p>
    </header>
  )
}
