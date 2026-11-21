import { useId, useRef, useState, type FormEvent } from 'react'
import { Loader2, MoreHorizontal, X } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/errors'
import { Segmented } from '@/components/Segmented'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { isProtectedEnvironment, type Environment } from '@/features/environments/queries'
import { fallbackMessage } from '@/lib/form-errors'
import { useDeleteOverride, useOverrides, useUpsertOverride, type Feature, type Override } from './queries'

interface OverrideTableProps {
  feature: Feature
  environment: Environment
  canWrite: boolean
}

type Choice = 'allow' | 'deny'

const PAGE = 50
const word = (enabled: boolean) => (enabled ? 'allowed' : 'denied')

function failureMessage(error: unknown): string {
  if (error instanceof ApiError && error.retryAfter) {
    return `Too many changes at once. Try again in ${error.retryAfter} s.`
  }
  return fallbackMessage(error)
}

/** Users who always or never get the flag here, whatever the rules and rollout say. Each change applies at once. */
export function OverrideTable({ feature, environment, canWrite }: OverrideTableProps) {
  const overrides = useOverrides(feature.id, environment.id)
  const upsert = useUpsertOverride(feature.id, environment.id)
  const remove = useDeleteOverride(feature.id, environment.id)
  const inputRef = useRef<HTMLInputElement>(null)
  const errorId = useId()
  const [userId, setUserId] = useState('')
  const [choice, setChoice] = useState<Choice>('allow')
  const [inputError, setInputError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [removing, setRemoving] = useState<Override | null>(null)
  const isProtected = isProtectedEnvironment(environment.name)

  function set(externalUserId: string, enabled: boolean, done?: () => void) {
    upsert.mutate(
      { externalUserId, enabled },
      {
        onSuccess: done,
        onError: (error) => toast.error(`Couldn't change ${externalUserId}. ${failureMessage(error)}`),
      },
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const id = userId.trim()
    if (id === '') {
      setInputError('Enter a user ID.')
      return
    }
    if (id.length > 255) {
      setInputError('User IDs are at most 255 characters.')
      return
    }
    const enabled = choice === 'allow'
    const existing = overrides.data?.find((override) => override.externalUserId === id)
    setUserId('')
    setInputError(null)
    inputRef.current?.focus()
    if (existing?.enabled === enabled) {
      toast(`${id} is already ${word(enabled)}.`)
      return
    }
    set(id, enabled, existing ? () => toast.success(`${id} was ${word(existing.enabled)}, now ${word(enabled)}.`) : undefined)
  }

  function confirmRemove(override: Override) {
    if (isProtected) {
      setRemoving(override)
    } else {
      removeNow(override, true)
    }
  }

  function removeNow(override: Override, offerUndo: boolean) {
    const { externalUserId, enabled } = override
    remove.mutate(
      { externalUserId },
      {
        onSuccess: () => {
          if (offerUndo) {
            toast(`Removed ${externalUserId}'s override`, {
              duration: 6000,
              action: { label: 'Undo', onClick: () => set(externalUserId, enabled) },
            })
          }
        },
        onError: (error) => toast.error(`Couldn't remove ${externalUserId}. ${failureMessage(error)}`),
      },
    )
  }

  const all = overrides.data ?? []
  const needle = query.trim().toLowerCase()
  const matching = needle ? all.filter((override) => override.externalUserId.toLowerCase().includes(needle)) : all
  const visible = matching.slice(0, shown)

  return (
    <section aria-labelledby="overrides-heading" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h2 id="overrides-heading" className="text-sm font-semibold text-muted-foreground">
          User overrides
        </h2>
        <p className="text-sm text-muted-foreground">
          Checked before the rules: denied users never get the flag, allowed users get it whenever it's on.
        </p>
      </div>

      {canWrite && (
        <form onSubmit={submit} noValidate className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={inputRef}
              aria-label="User ID"
              aria-invalid={inputError ? true : undefined}
              aria-describedby={inputError ? errorId : undefined}
              placeholder="user id or email"
              autoComplete="off"
              spellCheck={false}
              value={userId}
              onChange={(event) => {
                setUserId(event.target.value)
                setInputError(null)
              }}
              className="h-9 max-w-xs flex-1 font-mono text-[13px]"
            />
            <Segmented
              label="Override"
              options={[
                { value: 'allow', label: 'Allow' },
                { value: 'deny', label: 'Deny' },
              ]}
              value={choice}
              onChange={setChoice}
            />
            <Button type="submit" variant="outline" className="h-9">
              Add
            </Button>
          </div>
          {inputError && (
            <p id={errorId} className="text-sm text-destructive">
              {inputError}
            </p>
          )}
        </form>
      )}

      {overrides.isPending ? (
        <div role="status" aria-label="Loading overrides" className="h-16 animate-pulse rounded-lg bg-muted" />
      ) : overrides.isError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>Couldn't load the overrides.</p>
          <Button variant="outline" size="sm" onClick={() => void overrides.refetch()}>
            Try again
          </Button>
        </div>
      ) : all.length === 0 ? (
        <p className="text-muted-foreground">No overrides. Everyone follows the rules and rollout.</p>
      ) : (
        <>
          {all.length > 10 && (
            <Input
              type="search"
              aria-label="Search overrides"
              placeholder={`Search ${all.length} user IDs`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setShown(PAGE)
              }}
              className="h-9 max-w-xs"
            />
          )}
          {matching.length === 0 ? (
            <p className="text-muted-foreground">No user ID matches “{query.trim()}”.</p>
          ) : (
            <Table aria-labelledby="overrides-heading">
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="w-28">Override</TableHead>
                  {canWrite && <TableHead className="w-20 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((override) => (
                  <TableRow key={override.externalUserId}>
                    <TableCell className="max-w-0 truncate font-mono text-[13px]" title={override.externalUserId}>
                      {override.externalUserId}
                    </TableCell>
                    <TableCell>
                      {override.enabled ? (
                        <Badge className="bg-success-soft text-success">Allow</Badge>
                      ) : (
                        <Badge className="bg-destructive/10 text-destructive">Deny</Badge>
                      )}
                    </TableCell>
                    {canWrite && (
                      <TableCell className="text-right">
                        <span className="inline-flex">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${override.externalUserId}`}>
                                <MoreHorizontal aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => set(override.externalUserId, !override.enabled)}>
                                {override.enabled ? 'Change to deny' : 'Change to allow'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove override for ${override.externalUserId}`}
                            onClick={() => confirmRemove(override)}
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </span>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {matching.length > visible.length && (
            <Button variant="outline" size="sm" className="self-start" onClick={() => setShown(shown + PAGE)}>
              Show {Math.min(PAGE, matching.length - visible.length)} more of {matching.length - visible.length}
            </Button>
          )}
        </>
      )}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove <code className="font-mono">{removing?.externalUserId}</code>'s override in {environment.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They'll follow the rules and rollout instead of always being {removing && word(removing.enabled)}.{' '}
              {environment.name} is protected. SDKs pick up the change on their next poll.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              disabled={remove.isPending}
              onClick={() => {
                if (removing) {
                  removeNow(removing, false)
                }
                setRemoving(null)
              }}
            >
              {remove.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              Remove override
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
