"""
Authentication router for Open Notebook API.

Provides endpoints to check authentication status and user info.
Uses AWS Cognito for authentication.
"""

from fastapi import APIRouter, Depends, Request

from api.cognito_auth import (
    CognitoUser,
    cognito_config,
    get_current_cognito_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status")
async def get_auth_status():
    """
    Check authentication configuration status.

    Returns information about Cognito authentication configuration.
    This endpoint is public (excluded from auth middleware).
    """
    cognito_enabled = cognito_config.is_configured

    if cognito_enabled:
        message = "AWS Cognito authentication is enabled"
    else:
        message = "Authentication not configured - set AWS_COGNITO_USER_POOL_ID and AWS_COGNITO_APP_CLIENT_ID"

    return {
        "auth_enabled": cognito_enabled,
        "auth_method": "cognito" if cognito_enabled else "none",
        "cognito_enabled": cognito_enabled,
        "message": message,
        # Include Cognito config for frontend (non-sensitive info only)
        "cognito": {
            "region": cognito_config.region,
            "user_pool_id": cognito_config.user_pool_id,
            "app_client_id": cognito_config.app_client_id,
        } if cognito_enabled else None,
    }


@router.get("/me")
async def get_current_user_info(
    request: Request,
    cognito_user: CognitoUser = Depends(get_current_cognito_user),
):
    """
    Get information about the currently authenticated user.

    Returns user claims from the Cognito JWT token.
    Requires authentication.
    """
    return {
        "sub": cognito_user.sub,
        "email": cognito_user.email,
        "email_verified": cognito_user.email_verified,
        "cognito_username": cognito_user.cognito_username,
        "auth_method": "cognito",
    }
