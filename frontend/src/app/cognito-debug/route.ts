import { NextResponse } from 'next/server'

/**
 * Cognito Configuration Runtime Endpoint
 *
 * This endpoint provides Cognito configuration to the client at runtime,
 * solving the NEXT_PUBLIC_* build-time limitation issue.
 */
export async function GET() {
  const cognitoConfig = {
    userPoolId: process.env.NEXT_PUBLIC_AWS_COGNITO_USER_POOL_ID || null,
    appClientId: process.env.NEXT_PUBLIC_AWS_COGNITO_APP_CLIENT_ID || null,
    identityPoolId: process.env.NEXT_PUBLIC_AWS_COGNITO_IDENTITY_POOL_ID || null,
    domain: process.env.NEXT_PUBLIC_AWS_COGNITO_DOMAIN || null,
    redirectSignIn: process.env.NEXT_PUBLIC_AWS_COGNITO_REDIRECT_SIGN_IN || null,
    redirectSignOut: process.env.NEXT_PUBLIC_AWS_COGNITO_REDIRECT_SIGN_OUT || null,
    region: process.env.AWS_COGNITO_REGION || 'us-east-1',
  }

  const isConfigured = !!(cognitoConfig.userPoolId && cognitoConfig.appClientId)

  return NextResponse.json({
    isConfigured,
    cognitoConfig,
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  })
}