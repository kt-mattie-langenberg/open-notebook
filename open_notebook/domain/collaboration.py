"""
Collaboration domain models for multiuser notebook sharing.

Includes NotebookCollaborator for user-to-notebook sharing relationships
and NotebookInvitation for shareable invitation links.
"""

import secrets
from datetime import datetime, timedelta
from typing import ClassVar, List, Literal, Optional, Type, TypeVar

from loguru import logger

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.base import ObjectModel
from open_notebook.exceptions import DatabaseOperationError, NotFoundError

T = TypeVar("T", bound="NotebookCollaborator")
I = TypeVar("I", bound="NotebookInvitation")

# Role hierarchy for permission checking
ROLE_HIERARCHY = {
    "viewer": 0,
    "editor": 1,
    "admin": 2,
}

CollaboratorRole = Literal["viewer", "editor", "admin"]


class NotebookCollaborator(ObjectModel):
    """
    Represents a user's collaboration access to a notebook.

    Roles:
    - viewer: Can read notebook content and shared chats
    - editor: Can add/edit sources, notes, and create chats
    - admin: Can manage collaborators and notebook settings
    """

    table_name: ClassVar[str] = "notebook_collaborator"

    notebook_id: str  # record<notebook>
    user_id: str  # record<user>
    role: CollaboratorRole = "viewer"
    invited_at: Optional[datetime] = None
    invited_by: Optional[str] = None  # record<user>

    @classmethod
    async def find(
        cls: Type[T], notebook_id: str, user_id: str
    ) -> Optional[T]:
        """
        Find a collaboration record for a specific user and notebook.

        Returns None if no collaboration exists.
        """
        try:
            result = await repo_query(
                """
                SELECT * FROM notebook_collaborator
                WHERE notebook_id = $notebook_id AND user_id = $user_id
                LIMIT 1
                """,
                {
                    "notebook_id": ensure_record_id(notebook_id),
                    "user_id": ensure_record_id(user_id),
                },
            )
            if result and len(result) > 0:
                return cls(**result[0])
            return None
        except Exception as e:
            logger.error(f"Error finding collaboration: {e}")
            raise DatabaseOperationError(e)

    @classmethod
    async def get_for_notebook(cls: Type[T], notebook_id: str) -> List[T]:
        """Get all collaborators for a notebook."""
        try:
            result = await repo_query(
                """
                SELECT * FROM notebook_collaborator
                WHERE notebook_id = $notebook_id
                ORDER BY invited_at DESC
                """,
                {"notebook_id": ensure_record_id(notebook_id)},
            )
            return [cls(**collab) for collab in result] if result else []
        except Exception as e:
            logger.error(f"Error fetching collaborators for notebook {notebook_id}: {e}")
            raise DatabaseOperationError(e)

    @classmethod
    async def get_for_user(cls: Type[T], user_id: str) -> List[T]:
        """Get all collaborations for a user."""
        try:
            result = await repo_query(
                """
                SELECT * FROM notebook_collaborator
                WHERE user_id = $user_id
                ORDER BY invited_at DESC
                """,
                {"user_id": ensure_record_id(user_id)},
            )
            return [cls(**collab) for collab in result] if result else []
        except Exception as e:
            logger.error(f"Error fetching collaborations for user {user_id}: {e}")
            raise DatabaseOperationError(e)

    def can_view(self) -> bool:
        """Check if this collaboration grants view access."""
        return self.role in ROLE_HIERARCHY

    def can_edit(self) -> bool:
        """Check if this collaboration grants edit access."""
        return ROLE_HIERARCHY.get(self.role, 0) >= ROLE_HIERARCHY["editor"]

    def can_admin(self) -> bool:
        """Check if this collaboration grants admin access."""
        return ROLE_HIERARCHY.get(self.role, 0) >= ROLE_HIERARCHY["admin"]


class NotebookInvitation(ObjectModel):
    """
    Shareable invitation link for notebook collaboration.

    Invitations can be:
    - Time-limited (expires_at)
    - Use-limited (max_uses)
    - Role-specific (viewer, editor, admin)
    """

    table_name: ClassVar[str] = "notebook_invitation"

    notebook_id: str  # record<notebook>
    token: str  # Unique invitation token
    role: CollaboratorRole = "viewer"
    expires_at: Optional[datetime] = None
    max_uses: Optional[int] = None
    use_count: int = 0
    created_by: str  # record<user>

    @classmethod
    def generate_token(cls) -> str:
        """Generate a secure random invitation token."""
        return secrets.token_urlsafe(32)

    @classmethod
    async def create_invitation(
        cls: Type[I],
        notebook_id: str,
        created_by: str,
        role: CollaboratorRole = "viewer",
        expires_in_days: Optional[int] = 7,
        max_uses: Optional[int] = None,
    ) -> I:
        """
        Create a new invitation link for a notebook.

        Args:
            notebook_id: The notebook to create invitation for
            created_by: User creating the invitation
            role: Role to grant when invitation is accepted
            expires_in_days: Days until expiration (None = never expires)
            max_uses: Maximum number of uses (None = unlimited)

        Returns:
            The created invitation
        """
        expires_at = None
        if expires_in_days is not None:
            expires_at = datetime.now() + timedelta(days=expires_in_days)

        invitation = cls(
            notebook_id=notebook_id,
            token=cls.generate_token(),
            role=role,
            expires_at=expires_at,
            max_uses=max_uses,
            use_count=0,
            created_by=created_by,
        )
        await invitation.save()
        return invitation

    @classmethod
    async def get_by_token(cls: Type[I], token: str) -> Optional[I]:
        """Find an invitation by its token."""
        try:
            result = await repo_query(
                "SELECT * FROM notebook_invitation WHERE token = $token LIMIT 1",
                {"token": token},
            )
            if result and len(result) > 0:
                return cls(**result[0])
            return None
        except Exception as e:
            logger.error(f"Error finding invitation by token: {e}")
            raise DatabaseOperationError(e)

    @classmethod
    async def get_for_notebook(cls: Type[I], notebook_id: str) -> List[I]:
        """Get all invitations for a notebook."""
        try:
            result = await repo_query(
                """
                SELECT * FROM notebook_invitation
                WHERE notebook_id = $notebook_id
                ORDER BY created DESC
                """,
                {"notebook_id": ensure_record_id(notebook_id)},
            )
            return [cls(**inv) for inv in result] if result else []
        except Exception as e:
            logger.error(f"Error fetching invitations for notebook {notebook_id}: {e}")
            raise DatabaseOperationError(e)

    def is_valid(self) -> bool:
        """Check if the invitation is still valid (not expired, not exhausted)."""
        # Check expiration
        if self.expires_at is not None and datetime.now() > self.expires_at:
            return False

        # Check max uses
        if self.max_uses is not None and self.use_count >= self.max_uses:
            return False

        return True

    async def accept(self, user_id: str) -> NotebookCollaborator:
        """
        Accept this invitation and create a collaboration.

        Args:
            user_id: The user accepting the invitation

        Returns:
            The created NotebookCollaborator

        Raises:
            ValueError: If invitation is expired or exhausted
            DatabaseOperationError: If user is already a collaborator
        """
        if not self.is_valid():
            raise ValueError("Invitation has expired or reached maximum uses")

        # Check if user already has access
        existing = await NotebookCollaborator.find(self.notebook_id, user_id)
        if existing:
            raise DatabaseOperationError("User is already a collaborator on this notebook")

        # Create collaboration
        collab = NotebookCollaborator(
            notebook_id=self.notebook_id,
            user_id=user_id,
            role=self.role,
            invited_at=datetime.now(),
            invited_by=self.created_by,
        )
        await collab.save()

        # Increment use count
        self.use_count += 1
        await self.save()

        logger.info(
            f"User {user_id} accepted invitation to notebook {self.notebook_id} "
            f"with role {self.role}"
        )

        return collab
