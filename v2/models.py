"""models — types partages du superagent v2.

TriageDecision remplace le JSON manuel parse par regex de v1
(orchestrator.py: parse_decision). pydantic-ai valide/retry contre ce schema
cote client (response_format OpenAI-compatible) : le triage ne PEUT plus
repondre en texte libre ou en code, contrairement a nemotron en v1
(constate 2026-07-15 : "a ecrit du CODE au lieu du JSON de decision").
"""
from typing import Literal

from pydantic import BaseModel, Field


class TriageDecision(BaseModel):
    complexity: Literal["trivial", "standard", "hard"]
    plan: bool
    grill: bool
    skeptic: bool
    loop: bool
    reason: str = Field(description="une phrase justifiant la decision")
