"""
AWS Cognito JWT authentication module.

Provides JWT verification for Cognito tokens issued by the KlearTrust User Pool.
Users must already exist in the KlearTrust Cognito User Pool - no self-registration.
"""

import os
from typing import Optional

import httpx
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from loguru import logger
from pydantic import BaseModel


class CognitoConfig:
    """Configuration for AWS Cognito authentication."""

    def __init__(self):
        self.region = os.environ.get("AWS_COGNITO_REGION", "us-east-1")
        self.user_pool_id = os.environ.get("AWS_COGNITO_USER_POOL_ID")
        self.app_client_id = os.environ.get("AWS_COGNITO_APP_CLIENT_ID")

        if self.user_pool_id:
            self.issuer = (
                f"https://cognito-idp.{self.region}.amazonaws.com/{self.user_pool_id}"
            )
            self.jwks_url = f"{self.issuer}/.well-known/jwks.json"
        else:
            self.issuer = None
            self.jwks_url = None

    @property
    def is_configured(self) -> bool:
        """Check if Cognito is properly configured."""
        return bool(self.user_pool_id and self.app_client_id)


# Global config instance
cognito_config = CognitoConfig()


class CognitoUser(BaseModel):
    """User claims extracted from Cognito JWT token."""

    sub: str  # Cognito user ID (UUID) - immutable unique identifier
    email: str
    email_verified: bool = False
    cognito_username: Optional[str] = None


# JWKS cache - fetched once and reused
_jwks_cache: Optional[dict] = None


async def get_jwks() -> dict:
    """
    Fetch and cache JWKS (JSON Web Key Set) from Cognito.

    The JWKS contains the public keys used to verify JWT signatures.
    Keys are cached in memory for performance.
    """
    global _jwks_cache

    if _jwks_cache is None:
        if not cognito_config.jwks_url:
            raise HTTPException(
                status_code=500, detail="Cognito JWKS URL not configured"
            )

        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(cognito_config.jwks_url)
                response.raise_for_status()
                _jwks_cache = response.json()
                logger.debug("Successfully fetched Cognito JWKS")
            except httpx.HTTPError as e:
                logger.error(f"Failed to fetch JWKS from Cognito: {e}")
                raise HTTPException(
                    status_code=503, detail="Unable to verify authentication"
                )

    return _jwks_cache


def clear_jwks_cache() -> None:
    """Clear the JWKS cache. Useful for testing or key rotation."""
    global _jwks_cache
    _jwks_cache = None


def get_signing_key(token: str, jwks: dict) -> dict:
    """
    Get the signing key for the token from JWKS.

    Matches the key ID (kid) in the token header with the appropriate key in JWKS.
    """
    try:
        unverified_header = jwt.get_unverified_header(token)
    except JWTError as e:
        logger.warning(f"Failed to decode token header: {e}")
        raise HTTPException(status_code=401, detail="Invalid token format")

    kid = unverified_header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="Token missing key ID")

    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key

    logger.warning(f"No matching key found for kid: {kid}")
    raise HTTPException(status_code=401, detail="Unable to verify token signature")


async def verify_cognito_token(token: str) -> CognitoUser:
    """
    Verify a Cognito JWT token and extract user claims.

    Args:
        token: The JWT token from the Authorization header

    Returns:
        CognitoUser with extracted claims

    Raises:
        HTTPException: If token is invalid, expired, or verification fails
    """
    if not cognito_config.is_configured:
        raise HTTPException(status_code=500, detail="Cognito authentication not configured")

    try:
        jwks = await get_jwks()
        signing_key = get_signing_key(token, jwks)

        # Verify and decode the token
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=cognito_config.app_client_id,
            issuer=cognito_config.issuer,
            options={"verify_exp": True},
        )

        # Extract user claims
        return CognitoUser(
            sub=payload["sub"],
            email=payload.get("email", ""),
            email_verified=payload.get("email_verified", False),
            cognito_username=payload.get("cognito:username"),
        )

    except JWTError as e:
        logger.warning(f"JWT verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during token verification: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")


# FastAPI security scheme
security = HTTPBearer(auto_error=False)


async def get_current_cognito_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> CognitoUser:
    """
    FastAPI dependency to get the current authenticated user from Cognito token.

    This dependency requires authentication - it will raise HTTPException if:
    - No authorization header is provided
    - Token is invalid or expired
    - Cognito is not configured

    Usage:
        @router.get("/protected")
        async def protected_endpoint(user: CognitoUser = Depends(get_current_cognito_user)):
            return {"user_id": user.sub}
    """
    if not cognito_config.is_configured:
        raise HTTPException(
            status_code=500,
            detail="Authentication not configured. Set AWS_COGNITO_USER_POOL_ID and AWS_COGNITO_APP_CLIENT_ID.",
        )

    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return await verify_cognito_token(credentials.credentials)


async def get_optional_cognito_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[CognitoUser]:
    """
    FastAPI dependency to optionally get the current user.

    Returns the CognitoUser if authenticated via middleware, None otherwise.
    Does NOT raise an exception for missing authentication.

    Note: For this application, anonymous access is not permitted.
    This is mainly for transition/backward compatibility.
    """
    # If middleware already authenticated via Cognito, return that user
    auth_method = getattr(request.state, "auth_method", None)
    if auth_method == "cognito":
        return getattr(request.state, "cognito_user", None)

    # No middleware auth - try verifying ourselves (fallback for edge cases)
    if not cognito_config.is_configured or not credentials:
        return None

    try:
        return await verify_cognito_token(credentials.credentials)
    except HTTPException:
        # Optional = return None on failure instead of raising
        return None
