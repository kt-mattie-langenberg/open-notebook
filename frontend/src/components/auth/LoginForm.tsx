'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { getConfig, getApiUrl } from '@/lib/config'
import { useCognitoAuth } from '@/lib/auth/cognito-context'
import { useAuthStore } from '@/lib/stores/auth-store'

interface AuthStatus {
  auth_enabled: boolean
  auth_method: 'cognito' | 'none'
  cognito_enabled: boolean
}

export function LoginForm() {
  const { hasHydrated } = useAuthStore()

  // Cognito auth state
  const {
    isLoading: cognitoLoading,
    isAuthenticated: cognitoAuthenticated,
    error: cognitoError,
    mfaRequired,
    signIn: cognitoSignIn,
    confirmMFA,
    clearError: clearCognitoError,
  } = useCognitoAuth()

  // Form state for Cognito
  const [email, setEmail] = useState('')
  const [cognitoPassword, setCognitoPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')

  // Auth status from API
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [configInfo, setConfigInfo] = useState<{ apiUrl: string; version: string; buildTime: string } | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  const router = useRouter()

  // Load config info for debugging
  useEffect(() => {
    getConfig().then(cfg => {
      setConfigInfo({
        apiUrl: cfg.apiUrl,
        version: cfg.version,
        buildTime: cfg.buildTime,
      })
    }).catch(err => {
      console.error('Failed to load config:', err)
    })
  }, [])

  // Check auth status from API
  useEffect(() => {
    if (!hasHydrated) return

    const checkAuth = async () => {
      try {
        const apiUrl = await getApiUrl()
        const response = await fetch(`${apiUrl}/api/auth/status`, {
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error(`Auth status check failed: ${response.status}`)
        }

        const data = await response.json()
        setAuthStatus(data)

        // If no auth required, redirect
        if (!data.auth_enabled) {
          router.push('/notebooks')
          return
        }

        // If Cognito is enabled and user is already authenticated via Cognito
        if (data.cognito_enabled && cognitoAuthenticated) {
          router.push('/notebooks')
          return
        }

        setConnectionError(null)
      } catch (error) {
        console.error('Error checking auth status:', error)
        setConnectionError(
          error instanceof Error
            ? error.message
            : 'Unable to connect to server'
        )
      } finally {
        setIsCheckingAuth(false)
      }
    }

    void checkAuth()
  }, [hasHydrated, cognitoAuthenticated, router])

  // Redirect after successful Cognito login
  useEffect(() => {
    if (cognitoAuthenticated && authStatus?.cognito_enabled) {
      router.push('/notebooks')
    }
  }, [cognitoAuthenticated, authStatus, router])

  // Show loading while checking auth
  if (!hasHydrated || isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner />
      </div>
    )
  }

  // Connection error
  if (connectionError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Connection Error</CardTitle>
            <CardDescription>
              Unable to connect to the API server
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-red-600 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div className="flex-1">{connectionError}</div>
              </div>

              {configInfo && (
                <div className="space-y-2 text-xs text-muted-foreground border-t pt-3">
                  <div className="font-medium">Diagnostic Information:</div>
                  <div className="space-y-1 font-mono">
                    <div>Version: {configInfo.version}</div>
                    <div>Built: {new Date(configInfo.buildTime).toLocaleString()}</div>
                    <div className="break-all">API URL: {configInfo.apiUrl}</div>
                  </div>
                </div>
              )}

              <Button onClick={() => window.location.reload()} className="w-full">
                Retry Connection
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Auth not configured - show error
  if (!authStatus?.cognito_enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Configuration Required</CardTitle>
            <CardDescription>
              Authentication is not configured
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-amber-600 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  AWS Cognito must be configured to use this application.
                  Please set the required environment variables.
                </div>
              </div>

              {configInfo && (
                <div className="text-xs text-center text-muted-foreground pt-4 border-t">
                  <div>Version {configInfo.version}</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Handle Cognito login
  const handleCognitoSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearCognitoError()

    if (email.trim() && cognitoPassword) {
      const success = await cognitoSignIn(email.trim(), cognitoPassword)
      if (success) {
        router.push('/notebooks')
      }
      // If MFA is required, the form will show MFA input automatically
    }
  }

  // Handle MFA submission
  const handleMFASubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearCognitoError()

    if (mfaCode.trim()) {
      const success = await confirmMFA(mfaCode.trim())
      if (success) {
        router.push('/notebooks')
      }
    }
  }

  // Cognito login form
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Open Notebook</CardTitle>
          <CardDescription>
            {mfaRequired 
              ? "Enter your MFA code to complete sign in" 
              : "Sign in with your KlearTrust account"
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mfaRequired ? (
            // MFA Code Form
            <form onSubmit={handleMFASubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mfaCode">MFA Code</Label>
                <Input
                  id="mfaCode"
                  type="text"
                  placeholder="000000"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  disabled={cognitoLoading}
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                />
              </div>

              {cognitoError && (
                <div className="flex items-start gap-2 text-red-600 text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{cognitoError}</span>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={cognitoLoading || !mfaCode.trim()}
              >
                {cognitoLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify MFA Code'
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setMfaCode('');
                  clearCognitoError();
                  // Reset to login form - user would need to sign in again
                  window.location.reload();
                }}
                disabled={cognitoLoading}
              >
                Back to Login
              </Button>
            </form>
          ) : (
            // Username/Password Form
            <form onSubmit={handleCognitoSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={cognitoLoading}
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={cognitoPassword}
                  onChange={(e) => setCognitoPassword(e.target.value)}
                  disabled={cognitoLoading}
                  autoComplete="current-password"
                />
              </div>

              {cognitoError && (
                <div className="flex items-start gap-2 text-red-600 text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{cognitoError}</span>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={cognitoLoading || !email.trim() || !cognitoPassword}
              >
                {cognitoLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>
          )}

          {configInfo && (
            <div className="text-xs text-center text-muted-foreground pt-4 border-t mt-4">
              <div>Version {configInfo.version}</div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
