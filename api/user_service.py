"""
User service for syncing Cognito users to local database.

Provides FastAPI dependencies for getting the current user from both
Cognito authentication and the local database.
"""

from typing import Optional

from fastapi import Depends, HTTPException, Request
from loguru import logger

from api.cognito_auth import (
    CognitoUser,
    cognito_config,
    get_current_cognito_user,
    get_optional_cognito_user,
)
from open_notebook.domain.user import User


async def get_or_create_local_user(cognito_user: CognitoUser) -> User:
    """
    Get or create a local User record from Cognito claims.

    This syncs the Cognito user to the local database on each request,
    ensuring the user exists and email is up to date.
    """
    return await User.get_or_create_from_cognito(
        cognito_sub=cognito_user.sub,
        email=cognito_user.email,
        display_name=cognito_user.cognito_username,
    )


async def get_current_user(
    cognito_user: CognitoUser = Depends(get_current_cognito_user),
) -> User:
    """
    FastAPI dependency to get the current authenticated local user.

    This dependency:
    1. Verifies the Cognito JWT token
    2. Syncs/creates the user in the local database
    3. Returns the local User object

    Raises HTTPException 401 if not authenticated.

    Usage:
        @router.get("/notebooks")
        async def list_notebooks(user: User = Depends(get_current_user)):
            return await user.get_accessible_notebooks()
    """
    return await get_or_create_local_user(cognito_user)


async def get_optional_user(
    cognito_user: Optional[CognitoUser] = Depends(get_optional_cognito_user),
) -> Optional[User]:
    """
    FastAPI dependency to optionally get the current user.

    Returns None if not authenticated or Cognito not configured.
    Does NOT raise an exception for missing authentication.

    Note: For this application, anonymous access is not permitted,
    so this is mainly for transition/backward compatibility.

    Usage:
        @router.get("/public-data")
        async def get_public(user: Optional[User] = Depends(get_optional_user)):
            if user:
                # Authenticated user
                ...
            else:
                # Anonymous/unauthenticated
                ...
    """
    if cognito_user is None:
        return None
    return await get_or_create_local_user(cognito_user)


async def get_user_from_request(request: Request) -> Optional[User]:
    """
    Get the current user from request state (set by middleware).

    This is useful when you need the user but are not in a route handler
    that can use FastAPI dependencies.

    Returns None if:
    - Cognito is not configured
    - User is authenticated via password (no Cognito user)
    - No authentication present
    """
    cognito_user = getattr(request.state, "cognito_user", None)
    if cognito_user is None:
        return None
    return await get_or_create_local_user(cognito_user)


def require_cognito_auth() -> None:
    """
    Utility to check if Cognito is required for an operation.

    Raises HTTPException 400 if Cognito is not configured.
    Use this for endpoints that specifically require multiuser features.
    """
    if not cognito_config.is_configured:
        raise HTTPException(
            status_code=400,
            detail="This feature requires Cognito authentication to be configured.",
        )
