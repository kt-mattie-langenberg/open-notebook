from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger

from api.cognito_auth import cognito_config
from api.models import NotebookCreate, NotebookResponse, NotebookUpdate
from api.permissions_service import (
    NotFoundOrForbiddenError,
    check_notebook_access,
    get_notebook_with_access,
    set_ownership,
)
from api.user_service import get_current_user, get_optional_user
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.domain.user import User
from open_notebook.exceptions import InvalidInputError

router = APIRouter()


def _notebook_to_response(nb: dict) -> NotebookResponse:
    """Convert a notebook dict (from query) to NotebookResponse."""
    return NotebookResponse(
        id=str(nb.get("id", "")),
        name=nb.get("name", ""),
        description=nb.get("description", ""),
        archived=nb.get("archived", False),
        created=str(nb.get("created", "")),
        updated=str(nb.get("updated", "")),
        source_count=nb.get("source_count", 0),
        note_count=nb.get("note_count", 0),
        owner_id=str(nb.get("owner_id", "")) if nb.get("owner_id") else None,
        visibility=nb.get("visibility", "private"),
    )


@router.get("/notebooks", response_model=List[NotebookResponse])
async def get_notebooks(
    archived: Optional[bool] = Query(None, description="Filter by archived status"),
    order_by: str = Query("updated desc", description="Order by field and direction"),
    user: Optional[User] = Depends(get_optional_user),
):
    """
    Get all accessible notebooks with optional filtering and ordering.

    If multiuser is enabled:
    - Returns notebooks owned by the user
    - Returns notebooks shared with the user
    - Returns notebooks with visibility='shared'

    If multiuser is not enabled:
    - Returns all notebooks
    """
    try:
        # Build base query with counts
        if cognito_config.is_configured and user:
            # Multiuser mode: filter by ownership, collaboration, or shared visibility
            query = f"""
                SELECT *,
                count(<-reference.in) as source_count,
                count(<-artifact.in) as note_count
                FROM notebook
                WHERE owner_id = $user_id
                   OR visibility = 'shared'
                   OR id IN (SELECT notebook_id FROM notebook_collaborator WHERE user_id = $user_id)
                ORDER BY {order_by}
            """
            result = await repo_query(query, {"user_id": ensure_record_id(user.id)})
        else:
            # Single-user mode: return all notebooks
            query = f"""
                SELECT *,
                count(<-reference.in) as source_count,
                count(<-artifact.in) as note_count
                FROM notebook
                ORDER BY {order_by}
            """
            result = await repo_query(query)

        # Filter by archived status if specified
        if archived is not None:
            result = [nb for nb in result if nb.get("archived") == archived]

        return [_notebook_to_response(nb) for nb in result]
    except Exception as e:
        logger.error(f"Error fetching notebooks: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching notebooks: {str(e)}"
        )


@router.post("/notebooks", response_model=NotebookResponse)
async def create_notebook(
    notebook: NotebookCreate,
    user: Optional[User] = Depends(get_optional_user),
):
    """
    Create a new notebook.

    If multiuser is enabled, the current user becomes the owner.
    """
    try:
        new_notebook = Notebook(
            name=notebook.name,
            description=notebook.description,
        )

        # Set ownership if multiuser is enabled
        set_ownership(new_notebook, user)

        await new_notebook.save()

        return NotebookResponse(
            id=new_notebook.id or "",
            name=new_notebook.name,
            description=new_notebook.description,
            archived=new_notebook.archived or False,
            created=str(new_notebook.created),
            updated=str(new_notebook.updated),
            source_count=0,
            note_count=0,
            owner_id=new_notebook.owner_id,
            visibility=new_notebook.visibility,
        )
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating notebook: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error creating notebook: {str(e)}"
        )


@router.get("/notebooks/{notebook_id}", response_model=NotebookResponse)
async def get_notebook(
    notebook_id: str,
    user: Optional[User] = Depends(get_optional_user),
):
    """Get a specific notebook by ID (with access check)."""
    try:
        # Query with counts for single notebook
        query = """
            SELECT *,
            count(<-reference.in) as source_count,
            count(<-artifact.in) as note_count
            FROM $notebook_id
        """
        result = await repo_query(query, {"notebook_id": ensure_record_id(notebook_id)})

        if not result:
            raise NotFoundOrForbiddenError("Notebook")

        nb = result[0]
        notebook = Notebook(**{k: v for k, v in nb.items() if k not in ["source_count", "note_count"]})

        # Check access
        await check_notebook_access(notebook, user)

        return _notebook_to_response(nb)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching notebook {notebook_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching notebook: {str(e)}"
        )


@router.put("/notebooks/{notebook_id}", response_model=NotebookResponse)
async def update_notebook(
    notebook_id: str,
    notebook_update: NotebookUpdate,
    user: Optional[User] = Depends(get_optional_user),
):
    """Update a notebook (requires edit access)."""
    try:
        # Get notebook with edit access check
        notebook = await get_notebook_with_access(
            notebook_id, user, require_edit=True
        ) if cognito_config.is_configured else await Notebook.get(notebook_id)

        if not notebook:
            raise NotFoundOrForbiddenError("Notebook")

        # Update only provided fields
        if notebook_update.name is not None:
            notebook.name = notebook_update.name
        if notebook_update.description is not None:
            notebook.description = notebook_update.description
        if notebook_update.archived is not None:
            notebook.archived = notebook_update.archived

        await notebook.save()

        # Query with counts after update
        query = """
            SELECT *,
            count(<-reference.in) as source_count,
            count(<-artifact.in) as note_count
            FROM $notebook_id
        """
        result = await repo_query(query, {"notebook_id": ensure_record_id(notebook_id)})

        if result:
            return _notebook_to_response(result[0])

        # Fallback if query fails
        return NotebookResponse(
            id=notebook.id or "",
            name=notebook.name,
            description=notebook.description,
            archived=notebook.archived or False,
            created=str(notebook.created),
            updated=str(notebook.updated),
            source_count=0,
            note_count=0,
            owner_id=notebook.owner_id,
            visibility=notebook.visibility,
        )
    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating notebook {notebook_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error updating notebook: {str(e)}"
        )


@router.put("/notebooks/{notebook_id}/visibility")
async def update_notebook_visibility(
    notebook_id: str,
    visibility: str = Query(..., regex="^(private|shared)$"),
    user: Optional[User] = Depends(get_optional_user),
):
    """
    Update notebook visibility (requires admin access).

    visibility: 'private' or 'shared'
    - private: Only owner and collaborators can see
    - shared: All authenticated users can see
    """
    try:
        # Get notebook with admin access check
        notebook = await get_notebook_with_access(
            notebook_id, user, require_admin=True
        ) if cognito_config.is_configured else await Notebook.get(notebook_id)

        if not notebook:
            raise NotFoundOrForbiddenError("Notebook")

        notebook.visibility = visibility
        await notebook.save()

        return {
            "id": notebook.id,
            "visibility": notebook.visibility,
            "message": f"Notebook visibility updated to {visibility}",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating notebook visibility {notebook_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error updating notebook visibility: {str(e)}"
        )


@router.post("/notebooks/{notebook_id}/sources/{source_id}")
async def add_source_to_notebook(
    notebook_id: str,
    source_id: str,
    user: Optional[User] = Depends(get_optional_user),
):
    """Add an existing source to a notebook (requires edit access)."""
    try:
        # Check notebook exists and user has edit access
        notebook = await get_notebook_with_access(
            notebook_id, user, require_edit=True
        ) if cognito_config.is_configured else await Notebook.get(notebook_id)

        if not notebook:
            raise NotFoundOrForbiddenError("Notebook")

        # Check if source exists
        source = await Source.get(source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Source not found")

        # Check if reference already exists (idempotency)
        existing_ref = await repo_query(
            "SELECT * FROM reference WHERE out = $source_id AND in = $notebook_id",
            {
                "notebook_id": ensure_record_id(notebook_id),
                "source_id": ensure_record_id(source_id),
            },
        )

        # If reference doesn't exist, create it
        if not existing_ref:
            await repo_query(
                "RELATE $source_id->reference->$notebook_id",
                {
                    "notebook_id": ensure_record_id(notebook_id),
                    "source_id": ensure_record_id(source_id),
                },
            )

        return {"message": "Source linked to notebook successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error linking source {source_id} to notebook {notebook_id}: {str(e)}"
        )
        raise HTTPException(
            status_code=500, detail=f"Error linking source to notebook: {str(e)}"
        )


@router.delete("/notebooks/{notebook_id}/sources/{source_id}")
async def remove_source_from_notebook(
    notebook_id: str,
    source_id: str,
    user: Optional[User] = Depends(get_optional_user),
):
    """Remove a source from a notebook (requires edit access)."""
    try:
        # Check notebook exists and user has edit access
        notebook = await get_notebook_with_access(
            notebook_id, user, require_edit=True
        ) if cognito_config.is_configured else await Notebook.get(notebook_id)

        if not notebook:
            raise NotFoundOrForbiddenError("Notebook")

        # Delete the reference record linking source to notebook
        await repo_query(
            "DELETE FROM reference WHERE out = $notebook_id AND in = $source_id",
            {
                "notebook_id": ensure_record_id(notebook_id),
                "source_id": ensure_record_id(source_id),
            },
        )

        return {"message": "Source removed from notebook successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error removing source {source_id} from notebook {notebook_id}: {str(e)}"
        )
        raise HTTPException(
            status_code=500, detail=f"Error removing source from notebook: {str(e)}"
        )


@router.delete("/notebooks/{notebook_id}")
async def delete_notebook(
    notebook_id: str,
    user: Optional[User] = Depends(get_optional_user),
):
    """Delete a notebook (requires admin access - owner only)."""
    try:
        # Check notebook exists and user has admin access
        notebook = await get_notebook_with_access(
            notebook_id, user, require_admin=True
        ) if cognito_config.is_configured else await Notebook.get(notebook_id)

        if not notebook:
            raise NotFoundOrForbiddenError("Notebook")

        await notebook.delete()

        return {"message": "Notebook deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting notebook {notebook_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error deleting notebook: {str(e)}"
        )
