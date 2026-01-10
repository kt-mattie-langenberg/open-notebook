"""
Collaborators router for managing notebook sharing.

Provides endpoints for:
- Listing collaborators on a notebook
- Adding/removing collaborators
- Managing invitation links
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger
from pydantic import BaseModel, Field

from api.cognito_auth import cognito_config
from api.permissions_service import (
    NotFoundOrForbiddenError,
    PermissionDeniedError,
    get_notebook_with_access,
)
from api.user_service import get_current_user, require_cognito_auth
from open_notebook.domain.collaboration import (
    CollaboratorRole,
    NotebookCollaborator,
    NotebookInvitation,
)
from open_notebook.domain.notebook import Notebook
from open_notebook.domain.user import User

router = APIRouter()


# Request/Response models
class CollaboratorResponse(BaseModel):
    id: str
    notebook_id: str
    user_id: str
    user_email: Optional[str] = None
    user_display_name: Optional[str] = None
    role: str
    invited_at: Optional[str] = None
    invited_by: Optional[str] = None


class AddCollaboratorRequest(BaseModel):
    user_email: str = Field(..., description="Email of user to add as collaborator")
    role: str = Field("viewer", description="Role: viewer, editor, or admin")


class UpdateCollaboratorRequest(BaseModel):
    role: str = Field(..., description="New role: viewer, editor, or admin")


class InvitationResponse(BaseModel):
    id: str
    notebook_id: str
    token: str
    role: str
    expires_at: Optional[str] = None
    max_uses: Optional[int] = None
    use_count: int
    created_by: str
    created: Optional[str] = None
    # Computed field for sharing
    invitation_url: Optional[str] = None


class CreateInvitationRequest(BaseModel):
    role: str = Field("viewer", description="Role to grant: viewer, editor, or admin")
    expires_in_days: Optional[int] = Field(7, description="Days until expiration (null = never)")
    max_uses: Optional[int] = Field(None, description="Max uses (null = unlimited)")


class AcceptInvitationResponse(BaseModel):
    message: str
    notebook_id: str
    notebook_name: str
    role: str


# Helper to enrich collaborator with user info
async def _enrich_collaborator(collab: NotebookCollaborator) -> CollaboratorResponse:
    """Add user details to collaborator response."""
    user_email = None
    user_display_name = None

    try:
        user = await User.get(collab.user_id)
        user_email = user.email
        user_display_name = user.display_name
    except Exception:
        pass

    return CollaboratorResponse(
        id=collab.id or "",
        notebook_id=collab.notebook_id,
        user_id=collab.user_id,
        user_email=user_email,
        user_display_name=user_display_name,
        role=collab.role,
        invited_at=str(collab.invited_at) if collab.invited_at else None,
        invited_by=collab.invited_by,
    )


# Collaborator endpoints
@router.get("/notebooks/{notebook_id}/collaborators", response_model=List[CollaboratorResponse])
async def list_collaborators(
    notebook_id: str,
    user: User = Depends(get_current_user),
):
    """
    List all collaborators on a notebook.

    Requires view access to the notebook.
    """
    require_cognito_auth()

    try:
        # Check access (view is enough to see collaborators)
        notebook = await get_notebook_with_access(notebook_id, user)

        collaborators = await NotebookCollaborator.get_for_notebook(notebook_id)

        return [await _enrich_collaborator(c) for c in collaborators]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing collaborators for {notebook_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/notebooks/{notebook_id}/collaborators", response_model=CollaboratorResponse)
async def add_collaborator(
    notebook_id: str,
    request: AddCollaboratorRequest,
    user: User = Depends(get_current_user),
):
    """
    Add a collaborator to a notebook by email.

    Requires admin access to the notebook.
    The user being added must already exist (have logged in before).
    """
    require_cognito_auth()

    try:
        # Check admin access
        notebook = await get_notebook_with_access(notebook_id, user, require_admin=True)

        # Find user by email
        target_user = await User.get_by_email(request.user_email)
        if not target_user:
            raise HTTPException(
                status_code=404,
                detail=f"User with email {request.user_email} not found. They must log in first.",
            )

        # Check if already a collaborator
        existing = await NotebookCollaborator.find(notebook_id, target_user.id)
        if existing:
            raise HTTPException(
                status_code=400,
                detail="User is already a collaborator on this notebook",
            )

        # Can't add owner as collaborator
        if notebook.owner_id == target_user.id:
            raise HTTPException(
                status_code=400,
                detail="Cannot add notebook owner as collaborator",
            )

        # Validate role
        if request.role not in ["viewer", "editor", "admin"]:
            raise HTTPException(status_code=400, detail="Invalid role")

        # Add collaborator
        collab = await notebook.add_collaborator(
            user_id=target_user.id,
            role=request.role,
            invited_by=user.id,
        )

        return await _enrich_collaborator(collab)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding collaborator to {notebook_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/notebooks/{notebook_id}/collaborators/{user_id}", response_model=CollaboratorResponse)
async def update_collaborator(
    notebook_id: str,
    user_id: str,
    request: UpdateCollaboratorRequest,
    user: User = Depends(get_current_user),
):
    """
    Update a collaborator's role.

    Requires admin access to the notebook.
    """
    require_cognito_auth()

    try:
        # Check admin access
        await get_notebook_with_access(notebook_id, user, require_admin=True)

        # Find collaboration
        collab = await NotebookCollaborator.find(notebook_id, user_id)
        if not collab:
            raise HTTPException(status_code=404, detail="Collaborator not found")

        # Validate role
        if request.role not in ["viewer", "editor", "admin"]:
            raise HTTPException(status_code=400, detail="Invalid role")

        collab.role = request.role
        await collab.save()

        return await _enrich_collaborator(collab)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating collaborator {user_id} on {notebook_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/notebooks/{notebook_id}/collaborators/{user_id}")
async def remove_collaborator(
    notebook_id: str,
    user_id: str,
    user: User = Depends(get_current_user),
):
    """
    Remove a collaborator from a notebook.

    Requires admin access, OR the user can remove themselves.
    """
    require_cognito_auth()

    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise NotFoundOrForbiddenError("Notebook")

        # User can remove themselves, otherwise need admin
        is_self_removal = user.id == user_id
        if not is_self_removal:
            has_admin = await notebook.can_admin(user.id)
            if not has_admin:
                raise PermissionDeniedError("Admin access required to remove collaborators")

        # Find and remove
        collab = await NotebookCollaborator.find(notebook_id, user_id)
        if not collab:
            raise HTTPException(status_code=404, detail="Collaborator not found")

        await collab.delete()

        return {"message": "Collaborator removed successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing collaborator {user_id} from {notebook_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Invitation endpoints
@router.get("/notebooks/{notebook_id}/invitations", response_model=List[InvitationResponse])
async def list_invitations(
    notebook_id: str,
    user: User = Depends(get_current_user),
):
    """
    List all invitation links for a notebook.

    Requires admin access to the notebook.
    """
    require_cognito_auth()

    try:
        # Check admin access
        await get_notebook_with_access(notebook_id, user, require_admin=True)

        invitations = await NotebookInvitation.get_for_notebook(notebook_id)

        return [
            InvitationResponse(
                id=inv.id or "",
                notebook_id=inv.notebook_id,
                token=inv.token,
                role=inv.role,
                expires_at=str(inv.expires_at) if inv.expires_at else None,
                max_uses=inv.max_uses,
                use_count=inv.use_count,
                created_by=inv.created_by,
                created=str(inv.created) if inv.created else None,
                invitation_url=f"/invitations/{inv.token}",
            )
            for inv in invitations
        ]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing invitations for {notebook_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/notebooks/{notebook_id}/invitations", response_model=InvitationResponse)
async def create_invitation(
    notebook_id: str,
    request: CreateInvitationRequest,
    user: User = Depends(get_current_user),
):
    """
    Create a shareable invitation link for a notebook.

    Requires admin access to the notebook.
    """
    require_cognito_auth()

    try:
        # Check admin access
        await get_notebook_with_access(notebook_id, user, require_admin=True)

        # Validate role
        if request.role not in ["viewer", "editor", "admin"]:
            raise HTTPException(status_code=400, detail="Invalid role")

        invitation = await NotebookInvitation.create_invitation(
            notebook_id=notebook_id,
            created_by=user.id,
            role=request.role,
            expires_in_days=request.expires_in_days,
            max_uses=request.max_uses,
        )

        return InvitationResponse(
            id=invitation.id or "",
            notebook_id=invitation.notebook_id,
            token=invitation.token,
            role=invitation.role,
            expires_at=str(invitation.expires_at) if invitation.expires_at else None,
            max_uses=invitation.max_uses,
            use_count=invitation.use_count,
            created_by=invitation.created_by,
            created=str(invitation.created) if invitation.created else None,
            invitation_url=f"/invitations/{invitation.token}",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating invitation for {notebook_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/notebooks/{notebook_id}/invitations/{invitation_id}")
async def delete_invitation(
    notebook_id: str,
    invitation_id: str,
    user: User = Depends(get_current_user),
):
    """
    Delete an invitation link.

    Requires admin access to the notebook.
    """
    require_cognito_auth()

    try:
        # Check admin access
        await get_notebook_with_access(notebook_id, user, require_admin=True)

        # Get and delete invitation
        invitation = await NotebookInvitation.get(invitation_id)
        if not invitation or invitation.notebook_id != notebook_id:
            raise HTTPException(status_code=404, detail="Invitation not found")

        await invitation.delete()

        return {"message": "Invitation deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting invitation {invitation_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Accept invitation endpoint (separate path, not under notebook)
@router.get("/invitations/{token}", response_model=dict)
async def get_invitation_info(token: str):
    """
    Get information about an invitation link (public endpoint).

    Returns notebook name and role without requiring authentication.
    """
    try:
        invitation = await NotebookInvitation.get_by_token(token)
        if not invitation:
            raise HTTPException(status_code=404, detail="Invitation not found or expired")

        if not invitation.is_valid():
            raise HTTPException(status_code=410, detail="Invitation has expired or reached maximum uses")

        # Get notebook info
        notebook = await Notebook.get(invitation.notebook_id)

        return {
            "valid": True,
            "notebook_name": notebook.name if notebook else "Unknown",
            "role": invitation.role,
            "expires_at": str(invitation.expires_at) if invitation.expires_at else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting invitation info for token: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/invitations/{token}/accept", response_model=AcceptInvitationResponse)
async def accept_invitation(
    token: str,
    user: User = Depends(get_current_user),
):
    """
    Accept an invitation link and become a collaborator.

    Requires authentication. The user will be added as a collaborator
    with the role specified in the invitation.
    """
    require_cognito_auth()

    try:
        invitation = await NotebookInvitation.get_by_token(token)
        if not invitation:
            raise HTTPException(status_code=404, detail="Invitation not found")

        if not invitation.is_valid():
            raise HTTPException(status_code=410, detail="Invitation has expired or reached maximum uses")

        # Get notebook for response
        notebook = await Notebook.get(invitation.notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        # Check if user is already owner
        if notebook.owner_id == user.id:
            raise HTTPException(status_code=400, detail="You are the owner of this notebook")

        # Accept invitation
        try:
            await invitation.accept(user.id)
        except ValueError as e:
            raise HTTPException(status_code=410, detail=str(e))
        except Exception as e:
            if "already a collaborator" in str(e):
                raise HTTPException(status_code=400, detail="You are already a collaborator on this notebook")
            raise

        return AcceptInvitationResponse(
            message="Successfully joined notebook",
            notebook_id=notebook.id or "",
            notebook_name=notebook.name,
            role=invitation.role,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error accepting invitation: {e}")
        raise HTTPException(status_code=500, detail=str(e))
