'use client'

import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import {
  Copy,
  Link,
  Loader2,
  Mail,
  Plus,
  Trash2,
  Users,
  Globe,
  Lock,
} from 'lucide-react'

interface Collaborator {
  id: string
  notebook_id: string
  user_id: string
  user_email: string | null
  user_display_name: string | null
  role: string
  invited_at: string | null
}

interface Invitation {
  id: string
  notebook_id: string
  token: string
  role: string
  expires_at: string | null
  max_uses: number | null
  use_count: number
  invitation_url: string
}

interface ShareNotebookDialogProps {
  notebookId: string
  notebookName: string
  visibility: string
  isOwner: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShareNotebookDialog({
  notebookId,
  notebookName,
  visibility,
  isOwner,
  open,
  onOpenChange,
}: ShareNotebookDialogProps) {
  const queryClient = useQueryClient()
  const [newCollaboratorEmail, setNewCollaboratorEmail] = useState('')
  const [newCollaboratorRole, setNewCollaboratorRole] = useState('viewer')
  const [newInvitationRole, setNewInvitationRole] = useState('viewer')
  const [newInvitationExpiry, setNewInvitationExpiry] = useState('7')

  // Fetch collaborators
  const { data: collaborators = [], isLoading: loadingCollaborators } = useQuery({
    queryKey: ['collaborators', notebookId],
    queryFn: async () => {
      const response = await apiClient.get<Collaborator[]>(`/notebooks/${notebookId}/collaborators`)
      return response.data
    },
    enabled: open && isOwner,
  })

  // Fetch invitations
  const { data: invitations = [], isLoading: loadingInvitations } = useQuery({
    queryKey: ['invitations', notebookId],
    queryFn: async () => {
      const response = await apiClient.get<Invitation[]>(`/notebooks/${notebookId}/invitations`)
      return response.data
    },
    enabled: open && isOwner,
  })

  // Add collaborator mutation
  const addCollaborator = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      const response = await apiClient.post(`/notebooks/${notebookId}/collaborators`, {
        user_email: email,
        role,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collaborators', notebookId] })
      setNewCollaboratorEmail('')
      toast.success('Collaborator added')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to add collaborator')
    },
  })

  // Remove collaborator mutation
  const removeCollaborator = useMutation({
    mutationFn: async (userId: string) => {
      await apiClient.delete(`/notebooks/${notebookId}/collaborators/${userId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collaborators', notebookId] })
      toast.success('Collaborator removed')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to remove collaborator')
    },
  })

  // Update collaborator role mutation
  const updateCollaboratorRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const response = await apiClient.put(`/notebooks/${notebookId}/collaborators/${userId}`, {
        role,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collaborators', notebookId] })
      toast.success('Role updated')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to update role')
    },
  })

  // Create invitation mutation
  const createInvitation = useMutation({
    mutationFn: async ({ role, expiresInDays }: { role: string; expiresInDays: number | null }) => {
      const response = await apiClient.post(`/notebooks/${notebookId}/invitations`, {
        role,
        expires_in_days: expiresInDays,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations', notebookId] })
      toast.success('Invitation link created')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to create invitation')
    },
  })

  // Delete invitation mutation
  const deleteInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      await apiClient.delete(`/notebooks/${notebookId}/invitations/${invitationId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations', notebookId] })
      toast.success('Invitation deleted')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to delete invitation')
    },
  })

  // Update visibility mutation
  const updateVisibility = useMutation({
    mutationFn: async (newVisibility: string) => {
      const response = await apiClient.put(
        `/notebooks/${notebookId}/visibility?visibility=${newVisibility}`
      )
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notebooks'] })
      queryClient.invalidateQueries({ queryKey: ['notebook', notebookId] })
      toast.success('Visibility updated')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Failed to update visibility')
    },
  })

  const handleAddCollaborator = (e: React.FormEvent) => {
    e.preventDefault()
    if (newCollaboratorEmail.trim()) {
      addCollaborator.mutate({ email: newCollaboratorEmail.trim(), role: newCollaboratorRole })
    }
  }

  const handleCreateInvitation = () => {
    const expiresInDays = newInvitationExpiry === 'never' ? null : parseInt(newInvitationExpiry)
    createInvitation.mutate({ role: newInvitationRole, expiresInDays })
  }

  const copyInvitationLink = (token: string) => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    const link = `${baseUrl}/invitations/${token}`
    navigator.clipboard.writeText(link)
    toast.success('Link copied to clipboard')
  }

  if (!isOwner) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share Settings</DialogTitle>
            <DialogDescription>
              Only the notebook owner can manage sharing settings.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 text-center text-muted-foreground">
            <Lock className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>You don&apos;t have permission to manage sharing for this notebook.</p>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share &quot;{notebookName}&quot;</DialogTitle>
          <DialogDescription>
            Manage who can access this notebook
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="collaborators" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="collaborators">
              <Users className="h-4 w-4 mr-2" />
              People
            </TabsTrigger>
            <TabsTrigger value="links">
              <Link className="h-4 w-4 mr-2" />
              Links
            </TabsTrigger>
            <TabsTrigger value="visibility">
              <Globe className="h-4 w-4 mr-2" />
              Visibility
            </TabsTrigger>
          </TabsList>

          {/* Collaborators Tab */}
          <TabsContent value="collaborators" className="space-y-4">
            <form onSubmit={handleAddCollaborator} className="flex gap-2">
              <Input
                placeholder="Email address"
                type="email"
                value={newCollaboratorEmail}
                onChange={(e) => setNewCollaboratorEmail(e.target.value)}
                className="flex-1"
              />
              <Select value={newCollaboratorRole} onValueChange={setNewCollaboratorRole}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" size="icon" disabled={addCollaborator.isPending}>
                {addCollaborator.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </form>

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {loadingCollaborators ? (
                <div className="text-center py-4 text-muted-foreground">Loading...</div>
              ) : collaborators.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  No collaborators yet
                </div>
              ) : (
                collaborators.map((collab) => (
                  <div
                    key={collab.id}
                    className="flex items-center justify-between p-2 rounded border"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {collab.user_display_name || collab.user_email || 'Unknown'}
                      </p>
                      {collab.user_email && collab.user_display_name && (
                        <p className="text-xs text-muted-foreground truncate">
                          {collab.user_email}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={collab.role}
                        onValueChange={(role) =>
                          updateCollaboratorRole.mutate({ userId: collab.user_id, role })
                        }
                      >
                        <SelectTrigger className="w-24 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="editor">Editor</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-600"
                        onClick={() => removeCollaborator.mutate(collab.user_id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {/* Invitation Links Tab */}
          <TabsContent value="links" className="space-y-4">
            <div className="flex gap-2">
              <Select value={newInvitationRole} onValueChange={setNewInvitationRole}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Select value={newInvitationExpiry} onValueChange={setNewInvitationExpiry}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Expires in..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Expires in 1 day</SelectItem>
                  <SelectItem value="7">Expires in 7 days</SelectItem>
                  <SelectItem value="30">Expires in 30 days</SelectItem>
                  <SelectItem value="never">Never expires</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleCreateInvitation} disabled={createInvitation.isPending}>
                {createInvitation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Create Link'
                )}
              </Button>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {loadingInvitations ? (
                <div className="text-center py-4 text-muted-foreground">Loading...</div>
              ) : invitations.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  No invitation links
                </div>
              ) : (
                invitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between p-2 rounded border"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium capitalize">{inv.role} access</p>
                      <p className="text-xs text-muted-foreground">
                        {inv.expires_at
                          ? `Expires ${new Date(inv.expires_at).toLocaleDateString()}`
                          : 'Never expires'}
                        {inv.max_uses && ` • ${inv.use_count}/${inv.max_uses} uses`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => copyInvitationLink(inv.token)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-600"
                        onClick={() => deleteInvitation.mutate(inv.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {/* Visibility Tab */}
          <TabsContent value="visibility" className="space-y-4">
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => updateVisibility.mutate('private')}
                disabled={updateVisibility.isPending}
                className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                  visibility === 'private'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Lock className="h-5 w-5" />
                  <div>
                    <p className="font-medium">Private</p>
                    <p className="text-sm text-muted-foreground">
                      Only you and collaborators can access
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => updateVisibility.mutate('shared')}
                disabled={updateVisibility.isPending}
                className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                  visibility === 'shared'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Globe className="h-5 w-5" />
                  <div>
                    <p className="font-medium">Shared</p>
                    <p className="text-sm text-muted-foreground">
                      All authenticated users can view
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
