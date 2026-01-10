"use client";

/**
 * Cognito authentication context and hooks.
 *
 * Provides authentication state and methods for AWS Cognito integration.
 * Works alongside the existing auth store for backward compatibility.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  signIn,
  signOut,
  type AuthUser,
} from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { configureAmplify, isCognitoConfigured } from "@/lib/amplify-config";

/**
 * User information from Cognito.
 */
export interface CognitoUser {
  sub: string;
  email: string;
  emailVerified: boolean;
  username: string;
}

/**
 * Authentication state and methods.
 */
export interface CognitoAuthContextValue {
  /** Whether Cognito is configured */
  isConfigured: boolean;
  /** Whether authentication is in progress */
  isLoading: boolean;
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
  /** Current user information */
  user: CognitoUser | null;
  /** Current ID token for API calls */
  idToken: string | null;
  /** Authentication error message */
  error: string | null;
  /** Sign in with username/email and password */
  signIn: (username: string, password: string) => Promise<boolean>;
  /** Sign out the current user */
  signOut: () => Promise<void>;
  /** Get a fresh ID token (for API calls) */
  getIdToken: () => Promise<string | null>;
  /** Clear any error state */
  clearError: () => void;
}

const CognitoAuthContext = createContext<CognitoAuthContextValue | null>(null);

/**
 * Hook to access Cognito authentication context.
 */
export function useCognitoAuth(): CognitoAuthContextValue {
  const context = useContext(CognitoAuthContext);
  if (!context) {
    throw new Error("useCognitoAuth must be used within CognitoAuthProvider");
  }
  return context;
}

/**
 * Provider component for Cognito authentication.
 */
export function CognitoAuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<CognitoUser | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isConfigured = useMemo(() => {
    // Configure Amplify on first render
    if (isCognitoConfigured()) {
      configureAmplify();
      return true;
    }
    return false;
  }, []);

  /**
   * Fetch user attributes and token from current session.
   */
  const refreshSession = useCallback(async (): Promise<boolean> => {
    if (!isConfigured) {
      setIsLoading(false);
      return false;
    }

    try {
      const authUser: AuthUser = await getCurrentUser();
      const session = await fetchAuthSession();
      const attributes = await fetchUserAttributes();

      const token = session.tokens?.idToken?.toString() ?? null;

      setUser({
        sub: authUser.userId,
        email: attributes.email ?? "",
        emailVerified: attributes.email_verified === "true",
        username: authUser.username,
      });
      setIdToken(token);
      setIsAuthenticated(true);
      setError(null);
      return true;
    } catch {
      // Not authenticated or session expired
      setUser(null);
      setIdToken(null);
      setIsAuthenticated(false);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isConfigured]);

  /**
   * Get a fresh ID token for API calls.
   */
  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!isConfigured || !isAuthenticated) {
      return null;
    }

    try {
      const session = await fetchAuthSession({ forceRefresh: false });
      const token = session.tokens?.idToken?.toString() ?? null;
      setIdToken(token);
      return token;
    } catch {
      // Session expired, need to re-authenticate
      setIsAuthenticated(false);
      setUser(null);
      setIdToken(null);
      return null;
    }
  }, [isConfigured, isAuthenticated]);

  /**
   * Sign in with username/email and password.
   */
  const handleSignIn = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      if (!isConfigured) {
        setError("Cognito authentication is not configured");
        return false;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await signIn({ username, password });

        if (result.isSignedIn) {
          await refreshSession();
          return true;
        }

        // Handle additional challenges (MFA, new password, etc.)
        if (result.nextStep) {
          const step = result.nextStep.signInStep;
          if (step === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
            setError("Password change required. Please contact your administrator.");
          } else if (step === "CONFIRM_SIGN_IN_WITH_TOTP_CODE") {
            setError("MFA code required. MFA is not yet supported in this interface.");
          } else {
            setError(`Additional verification required: ${step}`);
          }
          return false;
        }

        setError("Sign in failed. Please try again.");
        return false;
      } catch (err) {
        console.error("Sign in error:", err);
        if (err instanceof Error) {
          // Handle specific Cognito errors
          if (err.name === "UserNotFoundException") {
            setError("User not found. Please check your username.");
          } else if (err.name === "NotAuthorizedException") {
            setError("Incorrect username or password.");
          } else if (err.name === "UserNotConfirmedException") {
            setError("Account not confirmed. Please contact your administrator.");
          } else {
            setError(err.message);
          }
        } else {
          setError("An unexpected error occurred during sign in.");
        }
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [isConfigured, refreshSession]
  );

  /**
   * Sign out the current user.
   */
  const handleSignOut = useCallback(async (): Promise<void> => {
    if (!isConfigured) return;

    try {
      await signOut();
    } catch (err) {
      console.error("Sign out error:", err);
    } finally {
      setUser(null);
      setIdToken(null);
      setIsAuthenticated(false);
      setError(null);
    }
  }, [isConfigured]);

  /**
   * Clear error state.
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Check authentication status on mount
  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // Listen for auth events from Amplify
  useEffect(() => {
    if (!isConfigured) return;

    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      switch (payload.event) {
        case "signedIn":
          refreshSession();
          break;
        case "signedOut":
          setUser(null);
          setIdToken(null);
          setIsAuthenticated(false);
          break;
        case "tokenRefresh":
          getIdToken();
          break;
        case "tokenRefresh_failure":
          // Force re-authentication
          setIsAuthenticated(false);
          setUser(null);
          setIdToken(null);
          break;
      }
    });

    return unsubscribe;
  }, [isConfigured, refreshSession, getIdToken]);

  const value = useMemo(
    (): CognitoAuthContextValue => ({
      isConfigured,
      isLoading,
      isAuthenticated,
      user,
      idToken,
      error,
      signIn: handleSignIn,
      signOut: handleSignOut,
      getIdToken,
      clearError,
    }),
    [
      isConfigured,
      isLoading,
      isAuthenticated,
      user,
      idToken,
      error,
      handleSignIn,
      handleSignOut,
      getIdToken,
      clearError,
    ]
  );

  return (
    <CognitoAuthContext.Provider value={value}>
      {children}
    </CognitoAuthContext.Provider>
  );
}
