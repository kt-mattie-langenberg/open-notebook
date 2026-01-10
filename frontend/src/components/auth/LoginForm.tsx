'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/use-auth'
import { useAuthStore } from '@/lib/stores/auth-store'
import { useCognitoAuth } from '@/lib/auth'
import { getConfig, getApiUrl } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, Loader2 } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

interface AuthStatus {
  auth_enabled: boolean
  auth_method: 'cognito' | 'password' | 'none'
  cognito_enabled: boolean
  password_enabled: boolean
}

export function LoginForm() {
  // Password auth state
  const [password, setPassword] = useState('')
  const { login: passwordLogin, isLoading: passwordLoading, error: passwordError } = useAuth()
  const { authRequired, checkAuthRequired, hasHydrated, isAuthenticated } = useAuthStore()

  // Cognito auth state
  const {
    isConfigured: cognitoConfigured,
    isLoading: cognitoLoading,
    isAuthenticated: cognitoAuthenticated,
    error: cognitoError,
    signIn: cognitoSignIn,
    clearError: clearCognitoError,
  } = useCognitoAuth()

  // Form state for Cognito
  const [email, setEmail] = useState('')
  const [cognitoPassword, setCognitoPassword] = useState('')

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

        // If password auth and already authenticated
        if (data.password_enabled && !data.cognito_enabled && isAuthenticated) {
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
  }, [hasHydrated, cognitoAuthenticated, isAuthenticated, router])

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

  // Handle Cognito login
  const handleCognitoSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearCognitoError()

    if (email.trim() && cognitoPassword) {
      const success = await cognitoSignIn(email.trim(), cognitoPassword)
      if (success) {
        router.push('/notebooks')
      }
    }
  }

  // Handle password login
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.trim()) {
      const success = await passwordLogin(password)
      if (success) {
        router.push('/notebooks')
      }
    }
  }

  const isLoading = cognitoLoading || passwordLoading
  const error = cognitoError || passwordError

  // Cognito login form
  if (authStatus?.cognito_enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Open Notebook</CardTitle>
            <CardDescription>
              Sign in with your KlearTrust account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCognitoSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
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
                  disabled={isLoading}
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 text-red-600 text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={isLoading || !email.trim() || !cognitoPassword}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>

              {configInfo && (
                <div className="text-xs text-center text-muted-foreground pt-2 border-t">
                  <div>Version {configInfo.version}</div>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Password login form (fallback/development)
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Open Notebook</CardTitle>
          <CardDescription>
            Enter your password to access the application
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || !password.trim()}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>

            {configInfo && (
              <div className="text-xs text-center text-muted-foreground pt-2 border-t">
                <div>Version {configInfo.version}</div>
                <div className="font-mono text-[10px]">{configInfo.apiUrl}</div>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
