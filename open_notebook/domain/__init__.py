"""
Domain models for Open Notebook.

This module exports all domain models for use throughout the application.
"""

from open_notebook.domain.base import ObjectModel, RecordModel
from open_notebook.domain.collaboration import (
    CollaboratorRole,
    NotebookCollaborator,
    NotebookInvitation,
)
from open_notebook.domain.notebook import (
    Asset,
    ChatSession,
    Note,
    Notebook,
    Source,
    SourceEmbedding,
    SourceInsight,
    text_search,
    vector_search,
)
from open_notebook.domain.user import User

__all__ = [
    # Base
    "ObjectModel",
    "RecordModel",
    # User
    "User",
    # Notebook and related
    "Notebook",
    "Source",
    "SourceEmbedding",
    "SourceInsight",
    "Note",
    "ChatSession",
    "Asset",
    # Collaboration
    "NotebookCollaborator",
    "NotebookInvitation",
    "CollaboratorRole",
    # Search functions
    "text_search",
    "vector_search",
]
