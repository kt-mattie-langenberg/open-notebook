'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api/client'
import { useCognitoAuth } from '@/lib/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { AlertCircle, CheckCircle, Link2, Loader2, Lock, BookOpen } from 'lucide-react'

interface InvitationInfo {
  valid: boolean
  notebook_name: string
  role: string
  expires_at: string | null
}

interface AcceptResult {
  message: string
  notebook_id: string
  notebook_name: string
  role: string
}

export default function InvitationPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const { isAuthenticated, isLoading: authLoading } = useCognitoAuth()
  const [accepted, setAccepted] = useState(false)

  // Fetch invitation info
  const {
    data: invitation,
    isLoading: invitationLoading,
    error: invitationError,
  } = useQuery({
    queryKey: ['invitation', token],
    queryFn: async () => {
      const response = await apiClient.get<InvitationInfo>(`/invitations/${token}`)
      return response.data
    },
    retry: false,
  })

  // Accept invitation mutation
  const acceptInvitation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<AcceptResult>(`/invitations/${token}/accept`)
      return response.data
    },
    onSuccess: (data) => {
      setAccepted(true)
      // Redirect to notebook after short delay
      setTimeout(() => {
        router.push(`/notebooks/${data.notebook_id}`)
      }, 2000)
    },
  })

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated && invitation?.valid) {
      // Store return URL and redirect to login
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('returnUrl', window.location.pathname)
      }
      router.push('/login')
    }
  }, [authLoading, isAuthenticated, invitation, router])

  // Loading state
  if (authLoading || invitationLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner />
      </div>
    )
  }

  // Invalid or expired invitation
  if (invitationError || !invitation?.valid) {
    const errorMessage =
      (invitationError as any)?.response?.status === 404
        ? 'This invitation link was not found.'
        : (invitationError as any)?.response?.status === 410
          ? 'This invitation has expired or reached its maximum uses.'
          : 'This invitation link is invalid or has expired.'

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-red-600" />
            </div>
            <CardTitle>Invalid Invitation</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground text-center">
              Please ask the notebook owner for a new invitation link.
            </p>
            <Button onClick={() => router.push('/notebooks')}>Go to Notebooks</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Accepted state
  if (accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <CardTitle>Invitation Accepted!</CardTitle>
            <CardDescription>
              You now have {invitation.role} access to &quot;{invitation.notebook_name}&quot;
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground">Redirecting to notebook...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Not authenticated - show login prompt
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Sign In Required</CardTitle>
            <CardDescription>
              You need to sign in to accept this invitation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 rounded-lg bg-muted">
              <div className="flex items-center gap-3">
                <BookOpen className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{invitation.notebook_name}</p>
                  <p className="text-sm text-muted-foreground capitalize">
                    {invitation.role} access
                  </p>
                </div>
              </div>
            </div>
            <Button onClick={() => router.push('/login')} className="w-full">
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Show accept invitation form
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Link2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>You&apos;re Invited!</CardTitle>
          <CardDescription>
            You&apos;ve been invited to collaborate on a notebook
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 rounded-lg bg-muted">
            <div className="flex items-center gap-3">
              <BookOpen className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">{invitation.notebook_name}</p>
                <p className="text-sm text-muted-foreground capitalize">
                  {invitation.role} access
                </p>
              </div>
            </div>
          </div>

          {invitation.expires_at && (
            <p className="text-xs text-muted-foreground text-center">
              This invitation expires on{' '}
              {new Date(invitation.expires_at).toLocaleDateString()}
            </p>
          )}

          {acceptInvitation.error && (
            <div className="flex items-center gap-2 text-red-600 text-sm p-3 rounded bg-red-50">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>
                {(acceptInvitation.error as any)?.response?.data?.detail ||
                  'Failed to accept invitation'}
              </span>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => router.push('/notebooks')}
              className="flex-1"
            >
              Decline
            </Button>
            <Button
              onClick={() => acceptInvitation.mutate()}
              disabled={acceptInvitation.isPending}
              className="flex-1"
            >
              {acceptInvitation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Accepting...
                </>
              ) : (
                'Accept Invitation'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
