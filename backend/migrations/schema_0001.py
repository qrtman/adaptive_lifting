"""Frozen schema operations for Alembic revision 0001."""
import sqlalchemy as sa

def create_missing_tables(op, existing_tables):
    if 'users' not in existing_tables:
        op.create_table('users',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('email', sa.String(), nullable=False),
        sa.Column('hashed_password', sa.String(), nullable=False),
        sa.Column('role', sa.String(), nullable=False),
        sa.Column('subscription_status', sa.String(), nullable=True),
        sa.Column('display_name', sa.String(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
        op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)
    if 'webhook_events' not in existing_tables:
        op.create_table('webhook_events',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('external_event_id', sa.String(), nullable=False),
        sa.Column('received_at', sa.DateTime(), nullable=True),
        sa.Column('processed_at', sa.DateTime(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('external_event_id')
        )
        op.create_index(op.f('ix_webhook_events_id'), 'webhook_events', ['id'], unique=False)
    if 'audit_events' not in existing_tables:
        op.create_table('audit_events',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('actor_user_id', sa.String(), nullable=True),
        sa.Column('event_type', sa.String(), nullable=False),
        sa.Column('resource_type', sa.String(), nullable=False),
        sa.Column('resource_id', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('metadata_json', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_audit_events_id'), 'audit_events', ['id'], unique=False)
    if 'client_devices' not in existing_tables:
        op.create_table('client_devices',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=True),
        sa.Column('device_label', sa.String(), nullable=True),
        sa.Column('last_seen_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_client_devices_id'), 'client_devices', ['id'], unique=False)
    if 'coaching_relationships' not in existing_tables:
        op.create_table('coaching_relationships',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('coach_id', sa.String(), nullable=False),
        sa.Column('athlete_id', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('ended_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['athlete_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['coach_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index('uq_coaching_relationships_active_athlete', 'coaching_relationships', ['athlete_id'], unique=True, sqlite_where=sa.text('ended_at IS NULL'), postgresql_where=sa.text('ended_at IS NULL'))
    if 'day_notes' not in existing_tables:
        op.create_table('day_notes',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('owner_id', sa.String(), nullable=False),
        sa.Column('date', sa.String(), nullable=False),
        sa.Column('body', sa.String(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('owner_id', 'date', name='uq_day_notes_owner_date')
        )
        op.create_index(op.f('ix_day_notes_id'), 'day_notes', ['id'], unique=False)
        op.create_index(op.f('ix_day_notes_owner_id'), 'day_notes', ['owner_id'], unique=False)
    if 'insight_cards' not in existing_tables:
        op.create_table('insight_cards',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('owner_user_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('config_json', sa.String(), nullable=False),
        sa.Column('layout_json', sa.String(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_insight_cards_id'), 'insight_cards', ['id'], unique=False)
        op.create_index(op.f('ix_insight_cards_owner_user_id'), 'insight_cards', ['owner_user_id'], unique=False)
    if 'integration_connections' not in existing_tables:
        op.create_table('integration_connections',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('external_account_id', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('scopes', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_integration_connections_id'), 'integration_connections', ['id'], unique=False)
    if 'invite_codes' not in existing_tables:
        op.create_table('invite_codes',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('coach_id', sa.String(), nullable=False),
        sa.Column('code_hash', sa.String(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('used_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['coach_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_invite_codes_id'), 'invite_codes', ['id'], unique=False)
    if 'mesocycles' not in existing_tables:
        op.create_table('mesocycles',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('color', sa.String(), nullable=False),
        sa.Column('startDate', sa.String(), nullable=False),
        sa.Column('endDate', sa.String(), nullable=False),
        sa.Column('owner_id', sa.String(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_mesocycles_id'), 'mesocycles', ['id'], unique=False)
    if 'sessions' not in existing_tables:
        op.create_table('sessions',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=True),
        sa.Column('jwt_id', sa.String(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_sessions_id'), 'sessions', ['id'], unique=False)
        op.create_index(op.f('ix_sessions_jwt_id'), 'sessions', ['jwt_id'], unique=True)
    if 'sheet_publications' not in existing_tables:
        op.create_table('sheet_publications',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('coach_id', sa.String(), nullable=False),
        sa.Column('spreadsheet_id', sa.String(), nullable=False),
        sa.Column('worksheet_name', sa.String(), nullable=False),
        sa.Column('export_profile', sa.String(), nullable=False),
        sa.Column('last_published_at', sa.DateTime(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['coach_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_sheet_publications_id'), 'sheet_publications', ['id'], unique=False)
    if 'coaching_history_snapshots' not in existing_tables:
        op.create_table('coaching_history_snapshots',
        sa.Column('relationship_id', sa.Integer(), nullable=False),
        sa.Column('snapshot_at', sa.DateTime(), nullable=False),
        sa.Column('snapshot_json', sa.String(), nullable=False),
        sa.ForeignKeyConstraint(['relationship_id'], ['coaching_relationships.id'], ),
        sa.PrimaryKeyConstraint('relationship_id')
        )
    if 'integration_credentials' not in existing_tables:
        op.create_table('integration_credentials',
        sa.Column('connection_id', sa.String(), nullable=False),
        sa.Column('credential_type', sa.String(), nullable=False),
        sa.Column('encrypted_payload', sa.String(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('rotated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['connection_id'], ['integration_connections.id'], ),
        sa.PrimaryKeyConstraint('connection_id', 'credential_type')
        )
    if 'integration_outbox' not in existing_tables:
        op.create_table('integration_outbox',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('connection_id', sa.String(), nullable=False),
        sa.Column('payload_json', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('retry_after', sa.DateTime(), nullable=True),
        sa.Column('attempt_count', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['connection_id'], ['integration_connections.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_integration_outbox_id'), 'integration_outbox', ['id'], unique=False)
    if 'microcycles' not in existing_tables:
        op.create_table('microcycles',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('weekName', sa.String(), nullable=False),
        sa.Column('focus', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=True),
        sa.Column('owner_id', sa.String(), nullable=True),
        sa.Column('mesocycle_id', sa.String(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['mesocycle_id'], ['mesocycles.id'], ),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_microcycles_id'), 'microcycles', ['id'], unique=False)
    if 'sync_mutations' not in existing_tables:
        op.create_table('sync_mutations',
        sa.Column('mutation_id', sa.String(), nullable=False),
        sa.Column('client_device_id', sa.String(), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('entity_id', sa.String(), nullable=False),
        sa.Column('field_path', sa.String(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('applied_at', sa.DateTime(), nullable=True),
        sa.Column('result', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['client_device_id'], ['client_devices.id'], ),
        sa.PrimaryKeyConstraint('mutation_id')
        )
        op.create_index(op.f('ix_sync_mutations_mutation_id'), 'sync_mutations', ['mutation_id'], unique=False)
    if 'workouts' not in existing_tables:
        op.create_table('workouts',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('date', sa.String(), nullable=False),
        sa.Column('dayLabel', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('tonnage', sa.Float(), nullable=True),
        sa.Column('delta', sa.Float(), nullable=True),
        sa.Column('color', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('athlete_bw', sa.Float(), nullable=True),
        sa.Column('block_label', sa.String(), nullable=True),
        sa.Column('week_label', sa.String(), nullable=True),
        sa.Column('owner_id', sa.String(), nullable=True),
        sa.Column('microcycle_id', sa.String(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['microcycle_id'], ['microcycles.id'], ),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_workouts_id'), 'workouts', ['id'], unique=False)
    if 'accessories' not in existing_tables:
        op.create_table('accessories',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('lexo_rank', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('prescribedSets', sa.String(), nullable=False),
        sa.Column('targetReps', sa.String(), nullable=False),
        sa.Column('targetRpe', sa.String(), nullable=False),
        sa.Column('weight', sa.String(), nullable=True),
        sa.Column('reps', sa.String(), nullable=True),
        sa.Column('executedRpe', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('workout_id', sa.String(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['workout_id'], ['workouts.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_accessories_id'), 'accessories', ['id'], unique=False)
    if 'domain_events' not in existing_tables:
        op.create_table('domain_events',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('workout_id', sa.String(), nullable=False),
        sa.Column('event_type', sa.String(), nullable=False),
        sa.Column('payload_json', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['workout_id'], ['workouts.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_domain_events_id'), 'domain_events', ['id'], unique=False)
    if 'exercises' not in existing_tables:
        op.create_table('exercises',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('lexo_rank', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('variation', sa.String(), nullable=False),
        sa.Column('tier', sa.String(), nullable=True),
        sa.Column('lift_category', sa.String(), nullable=True),
        sa.Column('movement_pattern', sa.String(), nullable=True),
        sa.Column('lift_note', sa.String(), nullable=True),
        sa.Column('tags_raw', sa.String(), nullable=True),
        sa.Column('top', sa.String(), nullable=True),
        sa.Column('vol', sa.String(), nullable=True),
        sa.Column('workout_id', sa.String(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['workout_id'], ['workouts.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_exercises_id'), 'exercises', ['id'], unique=False)
    if 'workout_locks' not in existing_tables:
        op.create_table('workout_locks',
        sa.Column('workout_id', sa.String(), nullable=False),
        sa.Column('holder_user_id', sa.String(), nullable=False),
        sa.Column('mode', sa.String(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['holder_user_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['workout_id'], ['workouts.id'], ),
        sa.PrimaryKeyConstraint('workout_id')
        )
    if 'exercise_sets' not in existing_tables:
        op.create_table('exercise_sets',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('lexo_rank', sa.String(), nullable=False),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('scope', sa.String(), nullable=False),
        sa.Column('plannedWeight', sa.Float(), nullable=True),
        sa.Column('plannedReps', sa.Integer(), nullable=True),
        sa.Column('plannedRpe', sa.Float(), nullable=True),
        sa.Column('dropPercent', sa.Float(), nullable=True),
        sa.Column('isAuto', sa.Boolean(), nullable=True),
        sa.Column('actual', sa.Float(), nullable=True),
        sa.Column('reps', sa.Integer(), nullable=True),
        sa.Column('executedRpe', sa.Float(), nullable=True),
        sa.Column('isTop', sa.Boolean(), nullable=True),
        sa.Column('intensity_type', sa.String(), nullable=True),
        sa.Column('note', sa.String(), nullable=True),
        sa.Column('velocity', sa.Float(), nullable=True),
        sa.Column('readiness', sa.Integer(), nullable=True),
        sa.Column('hrv', sa.Float(), nullable=True),
        sa.Column('exercise_id', sa.String(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['exercise_id'], ['exercises.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_exercise_sets_id'), 'exercise_sets', ['id'], unique=False)


def create_missing_indexes(op, bind):
    """Frozen index snapshot for existing legacy tables."""
    import sqlalchemy as sa

    indexes = [
        ('ix_users_email', 'users', ['email'], True, {}),
        ('ix_users_id', 'users', ['id'], False, {}),
        ('ix_webhook_events_id', 'webhook_events', ['id'], False, {}),
        ('ix_audit_events_id', 'audit_events', ['id'], False, {}),
        ('ix_client_devices_id', 'client_devices', ['id'], False, {}),
        ('uq_coaching_relationships_active_athlete', 'coaching_relationships', ['athlete_id'], True,
         {'sqlite_where': sa.text('ended_at IS NULL'), 'postgresql_where': sa.text('ended_at IS NULL')}),
        ('ix_day_notes_id', 'day_notes', ['id'], False, {}),
        ('ix_day_notes_owner_id', 'day_notes', ['owner_id'], False, {}),
        ('ix_insight_cards_id', 'insight_cards', ['id'], False, {}),
        ('ix_insight_cards_owner_user_id', 'insight_cards', ['owner_user_id'], False, {}),
        ('ix_integration_connections_id', 'integration_connections', ['id'], False, {}),
        ('ix_invite_codes_id', 'invite_codes', ['id'], False, {}),
        ('ix_mesocycles_id', 'mesocycles', ['id'], False, {}),
        ('ix_sessions_id', 'sessions', ['id'], False, {}),
        ('ix_sessions_jwt_id', 'sessions', ['jwt_id'], True, {}),
        ('ix_sheet_publications_id', 'sheet_publications', ['id'], False, {}),
        ('ix_integration_outbox_id', 'integration_outbox', ['id'], False, {}),
        ('ix_microcycles_id', 'microcycles', ['id'], False, {}),
        ('ix_sync_mutations_mutation_id', 'sync_mutations', ['mutation_id'], False, {}),
        ('ix_workouts_id', 'workouts', ['id'], False, {}),
        ('ix_accessories_id', 'accessories', ['id'], False, {}),
        ('ix_domain_events_id', 'domain_events', ['id'], False, {}),
        ('ix_exercises_id', 'exercises', ['id'], False, {}),
        ('ix_exercise_sets_id', 'exercise_sets', ['id'], False, {}),
    ]
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for name, table, columns, unique, options in indexes:
        if table not in tables:
            continue
        present = {index['name'] for index in inspector.get_indexes(table)}
        if name not in present:
            op.create_index(name, table, columns, unique=unique, **options)
