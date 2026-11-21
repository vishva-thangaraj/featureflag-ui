import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCan } from '@/tenant/permissions'
import { InvitationsTable } from './InvitationsTable'
import { InviteMemberSheet } from './InviteMemberSheet'
import { MembersTable } from './MembersTable'
import { useInvitations, useMembers } from './queries'

export function MembersPage() {
  const canWrite = useCan('write')
  const members = useMembers()
  const invitations = useInvitations(canWrite)
  const [params, setParams] = useSearchParams()
  const [inviting, setInviting] = useState(false)

  const tab = canWrite && params.get('tab') === 'invitations' ? 'invitations' : 'members'
  const pending = invitations.data?.filter((invitation) => invitation.status === 'PENDING').length

  function selectTab(next: string) {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next === 'invitations') {
          updated.set('tab', next)
        } else {
          updated.delete('tab')
        }
        return updated
      },
      { replace: true },
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Members"
        description="Who can see this organization, and what each of them can change."
        viewOnly={!canWrite}
        actions={
          canWrite && (
            <Button onClick={() => setInviting(true)}>
              <UserPlus aria-hidden="true" className="size-4" />
              Invite member
            </Button>
          )
        }
      />

      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList>
          <TabsTrigger value="members">
            {members.data ? `Members (${members.data.length})` : 'Members'}
          </TabsTrigger>
          {canWrite && (
            <TabsTrigger value="invitations">
              {pending === undefined ? 'Invitations' : `Invitations (${pending} pending)`}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="members">
          <MembersTable />
        </TabsContent>
        {canWrite && (
          <TabsContent value="invitations">
            <InvitationsTable onInvite={() => setInviting(true)} />
          </TabsContent>
        )}
      </Tabs>

      {canWrite && inviting && <InviteMemberSheet onClose={() => setInviting(false)} />}
    </div>
  )
}
