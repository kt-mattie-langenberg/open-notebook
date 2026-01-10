"""
Authentication router for Open Notebook API.

Provides endpoints to check authentication status and method.
Supports AWS Cognito (primary) and password auth (dev fallback).
"""

import os
from typing import Optional

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

    Returns information about which authentication methods are available.
    This endpoint is public (excluded from auth middleware).
    """
    cognito_enabled = cognito_config.is_configured
    password_enabled = bool(os.environ.get("OPEN_NOTEBOOK_PASSWORD"))

    # Determine primary auth method
    if cognito_enabled:
        auth_method = "cognito"
        message = "AWS Cognito authentication is enabled"
    elif password_enabled:
        auth_method = "password"
        message = "Password authentication is enabled (development mode)"
    else:
        auth_method = "none"
        message = "No authentication configured - all requests allowed"

    return {
        "auth_enabled": cognito_enabled or password_enabled,
        "auth_method": auth_method,
        "cognito_enabled": cognito_enabled,
        "password_enabled": password_enabled,
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
    # Get auth method from request state (set by middleware)
    auth_method = getattr(request.state, "auth_method", "cognito")

    return {
        "sub": cognito_user.sub,
        "email": cognito_user.email,
        "email_verified": cognito_user.email_verified,
        "cognito_username": cognito_user.cognito_username,
        "auth_method": auth_method,
    }
