"""Baseline: tabela de templates com owner_id.

Ponto de partida das migrações. Quem já tem um flaxy.db criado por
`create_all` deve carimbar esta revisão sem aplicá-la:

    alembic stamp 0001_baseline

Revision ID: 0001_baseline
Revises:
Create Date: 2026-08-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        # Nulo em tudo que foi criado antes de existirem contas. Ver auth.py:
        # a coluna já existe hoje para que a chegada do login seja um UPDATE, e
        # não um backfill adivinhado.
        sa.Column("owner_id", sa.String(length=36), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("file_path", sa.String(), nullable=False),
        sa.Column("overlay_x", sa.Integer(), server_default="0"),
        sa.Column("overlay_y", sa.Integer(), server_default="0"),
        sa.Column("overlay_w", sa.Integer(), server_default="1080"),
        sa.Column("overlay_h", sa.Integer(), server_default="1920"),
        sa.Column("fit_mode", sa.String(), server_default="cover"),
        sa.Column("output_w", sa.Integer(), server_default="1080"),
        sa.Column("output_h", sa.Integer(), server_default="1920"),
        sa.Column("output_format", sa.String(), server_default="mp4"),
        sa.Column("video_bitrate", sa.String(), server_default="8M"),
        sa.Column("audio_source", sa.String(), server_default="raw"),
        sa.Column("audio_mix_raw", sa.Float(), server_default="1.0"),
        sa.Column("audio_mix_template", sa.Float(), server_default="0.5"),
        sa.Column("duration_rule", sa.String(), server_default="raw"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_templates_id", "templates", ["id"])
    op.create_index("ix_templates_owner_id", "templates", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_templates_owner_id", table_name="templates")
    op.drop_index("ix_templates_id", table_name="templates")
    op.drop_table("templates")
