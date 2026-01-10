"""
User domain model for multiuser support.

Users are synced from AWS Cognito - there is no self-registration.
The `cognito_sub` field is the immutable unique identifier from Cognito.
"""

from datetime import datetime
from typing import ClassVar, List, Optional, Type, TypeVar

from loguru import logger

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.base import ObjectModel
from open_notebook.exceptions import DatabaseOperationError, NotFoundError

T = TypeVar("T", bound="User")


class User(ObjectModel):
    """
    User model synced from AWS Cognito.

    Users are created when they first authenticate with the system.
    The cognito_sub is the immutable unique identifier from Cognito.
    """

    table_name: ClassVar[str] = "user"

    # Core identity fields (from Cognito)
    cognito_sub: str  # Cognito user ID (sub claim) - immutable unique identifier
    email: str  # Email from Cognito

    # Profile fields (can be updated)
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None

    @classmethod
    async def get_by_cognito_sub(cls: Type[T], cognito_sub: str) -> Optional[T]:
        """
        Find a user by their Cognito sub (unique identifier).

        Returns None if user not found.
        """
        if not cognito_sub:
            return None

        try:
            result = await repo_query(
                "SELECT * FROM user WHERE cognito_sub = $sub LIMIT 1",
                {"sub": cognito_sub},
            )
            if result and len(result) > 0:
                return cls(**result[0])
            return None
        except Exception as e:
            logger.error(f"Error fetching user by cognito_sub: {e}")
            raise DatabaseOperationError(e)

    @classmethod
    async def get_by_email(cls: Type[T], email: str) -> Optional[T]:
        """
        Find a user by their email address.

        Returns None if user not found.
        """
        if not email:
            return None

        try:
            result = await repo_query(
                "SELECT * FROM user WHERE email = $email LIMIT 1",
                {"email": email.lower()},
            )
            if result and len(result) > 0:
                return cls(**result[0])
            return None
        except Exception as e:
            logger.error(f"Error fetching user by email: {e}")
            raise DatabaseOperationError(e)

    @classmethod
    async def get_or_create_from_cognito(
        cls: Type[T],
        cognito_sub: str,
        email: str,
        display_name: Optional[str] = None,
    ) -> T:
        """
        Get existing user or create new one from Cognito claims.

        This is the primary method for syncing users from Cognito.
        Called during authentication to ensure user exists in local database.
        """
        # Try to find existing user by cognito_sub
        existing = await cls.get_by_cognito_sub(cognito_sub)
        if existing:
            # Update email if changed (rare but possible in Cognito)
            if existing.email != email.lower():
                existing.email = email.lower()
                await existing.save()
            return existing

        # Create new user
        user = cls(
            cognito_sub=cognito_sub,
            email=email.lower(),
            display_name=display_name,
        )
        await user.save()
        logger.info(f"Created new user from Cognito: {user.id} ({email})")
        return user

    async def get_owned_notebooks(self) -> List["Notebook"]:
        """Get all notebooks owned by this user."""
        from open_notebook.domain.notebook import Notebook

        try:
            result = await repo_query(
                "SELECT * FROM notebook WHERE owner_id = $user_id ORDER BY updated DESC",
                {"user_id": ensure_record_id(self.id)},
            )
            return [Notebook(**nb) for nb in result] if result else []
        except Exception as e:
            logger.error(f"Error fetching owned notebooks for user {self.id}: {e}")
            raise DatabaseOperationError(e)

    async def get_accessible_notebooks(self) -> List["Notebook"]:
        """
        Get all notebooks accessible to this user.

        Includes:
        - Notebooks owned by this user
        - Notebooks shared with this user (via collaboration)
        - Shared notebooks (visibility = 'shared')
        """
        from open_notebook.domain.notebook import Notebook

        try:
            # Query for notebooks where:
            # 1. User is owner, OR
            # 2. User is a collaborator, OR
            # 3. Notebook is shared (visibility = 'shared')
            result = await repo_query(
                """
                SELECT * FROM notebook WHERE
                    owner_id = $user_id OR
                    visibility = 'shared' OR
                    id IN (SELECT notebook_id FROM notebook_collaborator WHERE user_id = $user_id)
                ORDER BY updated DESC
                """,
                {"user_id": ensure_record_id(self.id)},
            )
            return [Notebook(**nb) for nb in result] if result else []
        except Exception as e:
            logger.error(f"Error fetching accessible notebooks for user {self.id}: {e}")
            raise DatabaseOperationError(e)

    def _prepare_save_data(self) -> dict:
        """Ensure email is lowercase before saving."""
        data = super()._prepare_save_data()
        if data.get("email"):
            data["email"] = data["email"].lower()
        return data
