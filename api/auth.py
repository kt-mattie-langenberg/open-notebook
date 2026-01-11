"""
Authentication middleware for Open Notebook.

Uses AWS Cognito JWT tokens for authentication.
All requests require authentication - no anonymous access is permitted.
Users must already exist in the KlearTrust Cognito User Pool.
"""

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
    Cognito JWT authentication middleware.

    Verifies JWT tokens from AWS Cognito User Pool.
    All requests to protected endpoints require a valid Cognito token.
    No anonymous access is permitted.
    """

    def __init__(self, app, excluded_paths: Optional[list] = None):
        super().__init__(app)
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

        # Check if Cognito is configured
        if not cognito_config.is_configured:
            logger.error(
                "Cognito not configured. Set AWS_COGNITO_USER_POOL_ID and AWS_COGNITO_APP_CLIENT_ID."
            )
            return JSONResponse(
                status_code=503,
                content={"detail": "Authentication service not configured"},
            )

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

        # Verify Cognito JWT token
        try:
            cognito_user = await verify_cognito_token(token)
            # Store user in request state for downstream handlers
            request.state.cognito_user = cognito_user
            request.state.auth_method = "cognito"
            return await call_next(request)
        except HTTPException as e:
            return JSONResponse(
                status_code=e.status_code,
                content={"detail": e.detail},
                headers={"WWW-Authenticate": "Bearer"},
            )
        except Exception as e:
            logger.error(f"Unexpected authentication error: {e}")
            return JSONResponse(
                status_code=401,
                content={"detail": "Authentication failed"},
                headers={"WWW-Authenticate": "Bearer"},
            )


# Backward compatibility alias
PasswordAuthMiddleware = AuthMiddleware


# HTTPBearer security scheme for OpenAPI documentation
security = HTTPBearer(auto_error=False)
