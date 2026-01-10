"""
Permission checking service for multiuser access control.

Provides utilities and FastAPI dependencies for checking user permissions
on notebooks, sources, notes, and chat sessions.
"""

from typing import Optional

from fastapi import Depends, HTTPException
from loguru import logger

from api.cognito_auth import cognito_config
from api.user_service import get_current_user, get_optional_user
from open_notebook.domain.notebook import ChatSession, Notebook, Note, Source
from open_notebook.domain.user import User


class PermissionDeniedError(HTTPException):
    """Raised when a user doesn't have permission to perform an action."""

    def __init__(self, message: str = "Permission denied"):
        super().__init__(status_code=403, detail=message)


class NotFoundOrForbiddenError(HTTPException):
    """
    Raised when a resource is not found or user doesn't have access.

    We use a combined error to avoid leaking information about existence
    of resources the user doesn't have access to.
    """

    def __init__(self, resource_type: str = "Resource"):
        super().__init__(
            status_code=404,
            detail=f"{resource_type} not found or you don't have access",
        )


async def check_notebook_access(
    notebook: Notebook,
    user: Optional[User],
    require_edit: bool = False,
    require_admin: bool = False,
) -> bool:
    """
    Check if user has required access level to a notebook.

    Args:
        notebook: The notebook to check access for
        user: The user to check (None = unauthenticated)
        require_edit: Require edit permission (add sources, notes)
        require_admin: Require admin permission (share, delete)

    Returns:
        True if user has required access

    Raises:
        PermissionDeniedError if access is denied
    """
    # If multiuser is not configured, allow all access
    if not cognito_config.is_configured:
        return True

    user_id = user.id if user else None

    if require_admin:
        has_access = await notebook.can_admin(user_id)
        if not has_access:
            raise PermissionDeniedError(
                "You need admin access to perform this action on the notebook"
            )
    elif require_edit:
        has_access = await notebook.can_edit(user_id)
        if not has_access:
            raise PermissionDeniedError(
                "You need edit access to modify this notebook"
            )
    else:
        has_access = await notebook.is_accessible_by(user_id)
        if not has_access:
            raise NotFoundOrForbiddenError("Notebook")

    return True


async def check_chat_access(
    chat: ChatSession,
    notebook: Notebook,
    user: Optional[User],
) -> bool:
    """
    Check if user can access a chat session.

    Args:
        chat: The chat session to check
        notebook: The notebook the chat belongs to
        user: The user to check

    Returns:
        True if user has access

    Raises:
        NotFoundOrForbiddenError if access is denied
    """
    # If multiuser is not configured, allow all access
    if not cognito_config.is_configured:
        return True

    user_id = user.id if user else None
    has_access = await chat.is_accessible_by(user_id, notebook)

    if not has_access:
        raise NotFoundOrForbiddenError("Chat session")

    return True


async def get_notebook_with_access(
    notebook_id: str,
    user: User,
    require_edit: bool = False,
    require_admin: bool = False,
) -> Notebook:
    """
    Get a notebook by ID, checking user access.

    Args:
        notebook_id: The notebook ID
        user: The requesting user
        require_edit: Require edit permission
        require_admin: Require admin permission

    Returns:
        The Notebook if user has access

    Raises:
        NotFoundOrForbiddenError if notebook not found or access denied
    """
    try:
        notebook = await Notebook.get(notebook_id)
    except Exception:
        raise NotFoundOrForbiddenError("Notebook")

    await check_notebook_access(
        notebook, user, require_edit=require_edit, require_admin=require_admin
    )

    return notebook


async def filter_accessible_notebooks(
    notebooks: list[Notebook],
    user: Optional[User],
) -> list[Notebook]:
    """
    Filter a list of notebooks to only those accessible by the user.

    If multiuser is not configured, returns all notebooks.
    """
    if not cognito_config.is_configured:
        return notebooks

    user_id = user.id if user else None
    accessible = []

    for notebook in notebooks:
        if await notebook.is_accessible_by(user_id):
            accessible.append(notebook)

    return accessible


async def filter_accessible_chats(
    chats: list[ChatSession],
    notebook: Notebook,
    user: Optional[User],
) -> list[ChatSession]:
    """
    Filter a list of chat sessions to only those accessible by the user.

    If multiuser is not configured, returns all chats.
    """
    if not cognito_config.is_configured:
        return chats

    user_id = user.id if user else None
    accessible = []

    for chat in chats:
        if await chat.is_accessible_by(user_id, notebook):
            accessible.append(chat)

    return accessible


def set_ownership(
    obj: Notebook | ChatSession,
    user: Optional[User],
) -> None:
    """
    Set ownership on a new notebook or chat session.

    If multiuser is configured and user is provided, sets owner_id.
    If multiuser is not configured, leaves owner_id as None.
    """
    if cognito_config.is_configured and user:
        obj.owner_id = user.id
