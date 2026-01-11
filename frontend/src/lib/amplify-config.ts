/**
 * AWS Amplify configuration for Cognito authentication.
 *
 * Configures Amplify with the KlearTrust Cognito User Pool.
 * Users must already exist in Cognito - no self-registration.
 */

import { Amplify, type ResourcesConfig } from "aws-amplify";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { sessionStorage } from "aws-amplify/utils";

// Cache for Cognito configuration check
let cognitoConfiguredCache: boolean | undefined = undefined;

/**
 * Check if Cognito is configured via environment variables or runtime fetch.
 * Results are cached to avoid repeated network requests.
 */
export async function isCognitoConfigured(): Promise<boolean> {
  // Return cached result if available
  if (cognitoConfiguredCache !== undefined) {
    return cognitoConfiguredCache;
  }
  
  // First try build-time environment variables
  const buildTimeConfigured = !!(
    process.env.NEXT_PUBLIC_AWS_COGNITO_USER_POOL_ID &&
    process.env.NEXT_PUBLIC_AWS_COGNITO_APP_CLIENT_ID
  );
  
  if (buildTimeConfigured) {
    cognitoConfiguredCache = true;
    return true;
  }
  
  // Fallback: fetch from runtime endpoint (only once)
  try {
    const response = await fetch('/cognito-debug', { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      const isConfigured: boolean = data.isConfigured || false;
      cognitoConfiguredCache = isConfigured;
      return isConfigured;
    }
  } catch (error) {
    console.error('[Cognito Config] Failed to fetch runtime configuration:', error);
  }
  
  cognitoConfiguredCache = false;
  return false;
}

/**
 * Cognito configuration type for User Pool only (no Identity Pool required).
 */
interface CognitoUserPoolOnlyConfig {
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId?: string;
  loginWith?: {
    oauth: {
      domain: string;
      scopes: string[];
      redirectSignIn: string[];
      redirectSignOut: string[];
      responseType: "code" | "token";
    };
  };
}

// Cache for auth configuration
let authConfigCache: ResourcesConfig["Auth"] | null | undefined = undefined;

/**
 * Get the Amplify Auth configuration from environment variables or runtime fetch.
 * Results are cached to avoid repeated network requests.
 */
async function getAuthConfig(): Promise<ResourcesConfig["Auth"] | null> {
  // Return cached result if available
  if (authConfigCache !== undefined) {
    return authConfigCache;
  }

  let userPoolId = process.env.NEXT_PUBLIC_AWS_COGNITO_USER_POOL_ID;
  let userPoolClientId = process.env.NEXT_PUBLIC_AWS_COGNITO_APP_CLIENT_ID;
  let identityPoolId = process.env.NEXT_PUBLIC_AWS_COGNITO_IDENTITY_POOL_ID;
  let domain = process.env.NEXT_PUBLIC_AWS_COGNITO_DOMAIN;
  let redirectSignIn = process.env.NEXT_PUBLIC_AWS_COGNITO_REDIRECT_SIGN_IN;
  let redirectSignOut = process.env.NEXT_PUBLIC_AWS_COGNITO_REDIRECT_SIGN_OUT;

  // If not available at build time, fetch from runtime endpoint
  if (!userPoolId || !userPoolClientId) {
    try {
      const response = await fetch('/cognito-debug', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        const config = data.cognitoConfig;
        
        userPoolId = config.userPoolId;
        userPoolClientId = config.appClientId;
        identityPoolId = config.identityPoolId;
        domain = config.domain;
        redirectSignIn = config.redirectSignIn;
        redirectSignOut = config.redirectSignOut;
      }
    } catch (error) {
      console.error('[Cognito Config] Failed to fetch runtime configuration:', error);
    }
  }

  if (!userPoolId || !userPoolClientId) {
    authConfigCache = null;
    return null;
  }

  // Build Cognito config
  const cognitoConfig: CognitoUserPoolOnlyConfig = {
    userPoolId,
    userPoolClientId,
  };

  // Add Identity Pool if configured
  if (identityPoolId) {
    cognitoConfig.identityPoolId = identityPoolId;
  }

  // Add OAuth configuration if all required values are present
  if (domain && redirectSignIn && redirectSignOut) {
    cognitoConfig.loginWith = {
      oauth: {
        domain: domain.replace("https://", ""),
        scopes: ["email", "openid", "profile"],
        redirectSignIn: [redirectSignIn],
        redirectSignOut: [redirectSignOut],
        responseType: "code",
      },
    };
  }

  authConfigCache = {
    Cognito: cognitoConfig,
  } as ResourcesConfig["Auth"];
  
  return authConfigCache;
}

let isConfigured = false;

/**
 * Configure AWS Amplify with Cognito settings.
 *
 * This should be called once during application initialization.
 * Safe to call multiple times - subsequent calls are no-ops.
 */
export async function configureAmplify(): Promise<boolean> {
  if (isConfigured) {
    return true;
  }

  const authConfig = await getAuthConfig();
  if (!authConfig) {
    console.warn(
      "Cognito not configured. Unable to get configuration from environment or runtime endpoint."
    );
    return false;
  }

  try {
    Amplify.configure({ Auth: authConfig });

    // Use session storage for tokens (more secure than localStorage)
    cognitoUserPoolsTokenProvider.setKeyValueStorage(sessionStorage);

    isConfigured = true;
    console.log("AWS Amplify configured for Cognito authentication");
    return true;
  } catch (error) {
    console.error("Failed to configure Amplify:", error);
    return false;
  }
}

/**
 * Reset configuration state (useful for testing).
 */
export function resetAmplifyConfig(): void {
  isConfigured = false;
}
