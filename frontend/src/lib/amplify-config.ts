/**
 * AWS Amplify configuration for Cognito authentication.
 *
 * Configures Amplify with the KlearTrust Cognito User Pool.
 * Users must already exist in Cognito - no self-registration.
 */

import { Amplify, type ResourcesConfig } from "aws-amplify";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { sessionStorage } from "aws-amplify/utils";

/**
 * Check if Cognito is configured via environment variables.
 */
export function isCognitoConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_AWS_COGNITO_USER_POOL_ID &&
    process.env.NEXT_PUBLIC_AWS_COGNITO_APP_CLIENT_ID
  );
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

/**
 * Get the Amplify Auth configuration from environment variables.
 */
function getAuthConfig(): ResourcesConfig["Auth"] | null {
  const userPoolId = process.env.NEXT_PUBLIC_AWS_COGNITO_USER_POOL_ID;
  const userPoolClientId = process.env.NEXT_PUBLIC_AWS_COGNITO_APP_CLIENT_ID;
  const identityPoolId = process.env.NEXT_PUBLIC_AWS_COGNITO_IDENTITY_POOL_ID;
  const domain = process.env.NEXT_PUBLIC_AWS_COGNITO_DOMAIN;
  const redirectSignIn = process.env.NEXT_PUBLIC_AWS_COGNITO_REDIRECT_SIGN_IN;
  const redirectSignOut = process.env.NEXT_PUBLIC_AWS_COGNITO_REDIRECT_SIGN_OUT;

  if (!userPoolId || !userPoolClientId) {
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

  return {
    Cognito: cognitoConfig,
  } as ResourcesConfig["Auth"];
}

let isConfigured = false;

/**
 * Configure AWS Amplify with Cognito settings.
 *
 * This should be called once during application initialization.
 * Safe to call multiple times - subsequent calls are no-ops.
 */
export function configureAmplify(): boolean {
  if (isConfigured) {
    return true;
  }

  const authConfig = getAuthConfig();
  if (!authConfig) {
    console.warn(
      "Cognito not configured. Set NEXT_PUBLIC_AWS_COGNITO_USER_POOL_ID and NEXT_PUBLIC_AWS_COGNITO_APP_CLIENT_ID."
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
