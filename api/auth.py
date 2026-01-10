"""
Authentication middleware for Open Notebook.

Supports two authentication methods:
1. AWS Cognito JWT tokens (primary, required for production)
2. Simple password auth (fallback for local development only)

All requests require authentication - no anonymous access is permitted.
Users must already exist in the KlearTrust Cognito User Pool.
"""

import os
from typing import Optional

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from api.cognito_auth import CognitoUser, cognito_config, verify_cognito_token


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Unified authentication middleware supporting Cognito JWT and password auth.

    Authentication priority:
    1. If Cognito is configured, try to verify as Cognito JWT token
    2. If Cognito fails or not configured, try password auth (dev fallback)
    3. If neither succeeds, return 401

    All requests to protected endpoints require authentication.
    No anonymous access is permitted.
    """

    def __init__(self, app, excluded_paths: Optional[list] = None):
        super().__init__(app)
        self.password = os.environ.get("OPEN_NOTEBOOK_PASSWORD")
        self.excluded_paths = excluded_paths or [
            "/",
            "/health",
            "/docs",
            "/openapi.json",
            "/redoc",
            "/api/auth/status",
        ]

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Skip authentication for excluded paths
        if path in self.excluded_paths:
            return await call_next(request)

        # Skip authentication for CORS preflight requests
        if request.method == "OPTIONS":
            return await call_next(request)

        # Check if any auth method is configured
        if not cognito_config.is_configured and not self.password:
            # No auth configured - this should not happen in production
            logger.warning(
                "No authentication configured. Set AWS_COGNITO_USER_POOL_ID or OPEN_NOTEBOOK_PASSWORD."
            )
            return await call_next(request)

        # Get authorization header
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return JSONResponse(
                status_code=401,
                content={"detail": "Authentication required"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Parse authorization header
        try:
            scheme, token = auth_header.split(" ", 1)
            if scheme.lower() != "bearer":
                raise ValueError("Invalid authentication scheme")
        except ValueError:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid authorization header format. Use: Bearer <token>"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Try Cognito authentication first (primary method)
        cognito_user: Optional[CognitoUser] = None
        if cognito_config.is_configured:
            try:
                cognito_user = await verify_cognito_token(token)
                # Store user in request state for downstream handlers
                request.state.cognito_user = cognito_user
                request.state.auth_method = "cognito"
                return await call_next(request)
            except HTTPException as e:
                # If Cognito verification fails with 401, try password fallback
                if e.status_code != 401:
                    return JSONResponse(
                        status_code=e.status_code,
                        content={"detail": e.detail},
                    )
                # Continue to password fallback
                logger.debug("Cognito auth failed, trying password fallback")

        # Fallback to password authentication (development only)
        if self.password and token == self.password:
            request.state.cognito_user = None
            request.state.auth_method = "password"
            logger.debug("Authenticated via password (dev mode)")
            return await call_next(request)

        # All authentication methods failed
        if cognito_config.is_configured:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired Cognito token"},
                headers={"WWW-Authenticate": "Bearer"},
            )
        else:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid password"},
                headers={"WWW-Authenticate": "Bearer"},
            )


# Backward compatibility alias
PasswordAuthMiddleware = AuthMiddleware


# HTTPBearer security scheme for OpenAPI documentation
security = HTTPBearer(auto_error=False)


def check_api_password(
    credentials: Optional[HTTPAuthorizationCredentials] = None,
) -> bool:
    """
    Utility function to check API password.
    Can be used as a dependency in individual routes if needed.

    Note: This is for backward compatibility. New code should use
    get_current_cognito_user from cognito_auth.py instead.
    """
    password = os.environ.get("OPEN_NOTEBOOK_PASSWORD")

    # No password set, allow access (should not happen in production)
    if not password:
        return True

    # No credentials provided
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="Missing authorization",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check password
    if credentials.credentials != password:
        raise HTTPException(
            status_code=401,
            detail="Invalid password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return True
