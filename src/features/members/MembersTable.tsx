import { useState } from 'react'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'
import { useMe } from '@/auth/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fallbackMessage } from '@/lib/form-errors'
import { useTenant } from '@/tenant/context'
import { useCan } from '@/tenant/permissions'
import { RemoveMemberDialog } from './RemoveMemberDialog'
import { TableError, TableSkeleton } from './TableStates'
import { isOwner, memberName, useMembers, useUpdateMemberRole, type Member } from './queries'
import { canWriteAs, grantableRoles, highestRole, ROLES, type Role } from './roles'
import { useExplainRefusal } from './useExplainRefusal'

const DANGER = 'bg-danger-strong text-white hover:bg-danger-strong/90'

const STATUS_LABELS: Record<Member['status'], string> = { ACTIVE: 'Active', INVITED: 'Invited', REMOVED: 'Removed' }

export function MembersTable() {
  const canWrite = useCan('write')
  const tenant = useTenant()
  const members = useMembers()
  const me = useMe()
  const updateRole = useUpdateMemberRole()
  const explainRefusal = useExplainRefusal()
  const [removing, setRemoving] = useState<Member | null>(null)
  const [confirming, setConfirming] = useState<{ member: Member; role: Role } | null>(null)

  // Which row is the caller's decides its controls, so the table waits for /auth/me too.
  if (members.isPending || me.isPending) {
    return <TableSkeleton label="Loading members" />
  }
  if (members.isError || me.isError) {
    return (
      <TableError
        message="Couldn't load members."
        onRetry={() => {
          void members.refetch()
          void me.refetch()
        }}
      />
    )
  }

  const grantable = grantableRoles(tenant.roles.map((role) => role.name))
  const isSelf = (member: Member) => member.userID === me.data.userId

  function applyRole(member: Member, role: Role) {
    const name = memberName(member)
    updateRole.mutate(
      { membershipId: member.membershipId, roleName: role.name },
      {
        onSuccess: () => toast.success(isSelf(member) ? `Your role is now ${role.label}` : `${name}'s role is now ${role.label}`),
        onError: (error) => toast.error(explainRefusal(error) ?? `Couldn't change ${name}'s role. ${fallbackMessage(error)}`),
      },
    )
  }

  function chooseRole(member: Member, roleName: string) {
    const role = ROLES.find((candidate) => candidate.name === roleName)
    if (!role) {
      return
    }
    if (role.name === 'OWNER' || (isSelf(member) && !canWriteAs(role.name))) {
      setConfirming({ member, role })
    } else {
      applyRole(member, role)
    }
  }

  return (
    <section aria-label="Members" className="overflow-hidden rounded-xl border bg-card">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Person</TableHead>
              <TableHead className="w-44 px-4">Role</TableHead>
              <TableHead className="w-28 px-4">Status</TableHead>
              {canWrite && (
                <TableHead className="w-28 px-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.data.map((member) => {
              const name = memberName(member)
              const role = highestRole(member.roles.map((candidate) => candidate.name))
              const self = isSelf(member)
              const owner = isOwner(member)
              return (
                <TableRow key={member.membershipId}>
                  <TableCell className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2 font-medium">
                        {name}
                        {self && <Badge variant="secondary">You</Badge>}
                      </span>
                      <span className="text-sm text-muted-foreground">{member.email}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4">
                    {canWrite && owner ? (
                      <LockedOwner />
                    ) : canWrite && role ? (
                      <Select value={role.name} onValueChange={(next) => chooseRole(member, next)}>
                        <SelectTrigger
                          aria-label={`Role for ${name}`}
                          className="h-8 w-36"
                          disabled={updateRole.isPending && updateRole.variables?.membershipId === member.membershipId}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {grantable.map((option) => (
                            <SelectItem key={option.name} value={option.name}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-ink-secondary">{role?.label ?? '—'}</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 text-ink-secondary">{STATUS_LABELS[member.status]}</TableCell>
                  {canWrite && (
                    <TableCell className="px-4 text-right">
                      {!owner && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={self ? `Leave ${tenant.name}` : `Remove ${name}`}
                          onClick={() => setRemoving(member)}
                        >
                          {self ? 'Leave' : 'Remove'}
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {removing && (
        <RemoveMemberDialog
          key={removing.membershipId}
          member={removing}
          leaving={isSelf(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
      {confirming && (
        <ConfirmRoleDialog
          member={confirming.member}
          role={confirming.role}
          onConfirm={() => {
            applyRole(confirming.member, confirming.role)
            setConfirming(null)
          }}
          onClose={() => setConfirming(null)}
        />
      )}
    </section>
  )
}

function LockedOwner() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex items-center gap-1.5 rounded-sm text-ink-secondary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Lock aria-hidden="true" className="size-3.5" />
          Owner
        </span>
      </TooltipTrigger>
      <TooltipContent>The owner's role can't be changed, and the owner can't be removed.</TooltipContent>
    </Tooltip>
  )
}

interface ConfirmRoleDialogProps {
  member: Member
  role: Role
  onConfirm: () => void
  onClose: () => void
}

/** For the two role changes the caller can't take back: making an owner, and demoting themselves. */
function ConfirmRoleDialog({ member, role, onConfirm, onClose }: ConfirmRoleDialogProps) {
  const makingOwner = role.name === 'OWNER'
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {makingOwner ? `Make ${memberName(member)} an owner?` : `Make yourself a ${role.label}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {makingOwner
              ? "Owners can do everything, including deleting the organization. An owner's role can't be changed afterwards, and an owner can't be removed."
              : "You won't be able to change flags, environments, API keys or members any more. Only an owner or admin can change your role back."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button className={DANGER} onClick={onConfirm}>
            {makingOwner ? 'Make owner' : 'Change my role'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
