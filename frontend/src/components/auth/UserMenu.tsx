'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCognitoAuth } from '@/lib/auth'
import { useAuthStore } from '@/lib/stores/auth-store'
import { isCognitoConfigured } from '@/lib/amplify-config'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { LogOut, User, ChevronDown } from 'lucide-react'

export function UserMenu() {
  const router = useRouter()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  // Cognito auth
  const {
    isConfigured: cognitoEnabled,
    isAuthenticated: cognitoAuthenticated,
    user: cognitoUser,
    signOut: cognitoSignOut,
  } = useCognitoAuth()

  // Password auth
  const { logout: passwordLogout, isAuthenticated: passwordAuthenticated } = useAuthStore()

  // Determine auth state
  const isAuthenticated = cognitoEnabled ? cognitoAuthenticated : passwordAuthenticated
  const userEmail = cognitoUser?.email
  const userName = cognitoUser?.username || userEmail?.split('@')[0]

  if (!isAuthenticated) {
    return null
  }

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      if (cognitoEnabled) {
        await cognitoSignOut()
      }
      passwordLogout()
      router.push('/login')
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <User className="h-4 w-4" />
          {userName && <span className="hidden sm:inline max-w-[150px] truncate">{userName}</span>}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {userEmail && (
          <>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                {userName && <p className="text-sm font-medium">{userName}</p>}
                <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="text-red-600 focus:text-red-600"
        >
          <LogOut className="mr-2 h-4 w-4" />
          {isLoggingOut ? 'Signing out...' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
