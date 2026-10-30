DO $tower_migrations$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Community'
      AND column_name = 'communityTeamsEnabled'
      AND data_type = 'boolean' AND is_nullable = 'NO'
      AND column_default LIKE '%false%'
  ) THEN
    RAISE EXCEPTION 'community_teams: Community.communityTeamsEnabled missing or has the wrong default/nullability';
  END IF;

  IF to_regclass('public."CommunityTeam"') IS NULL
     OR to_regclass('public."CommunityTeamMember"') IS NULL THEN
    RAISE EXCEPTION 'community_teams: team tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CommunityTeamMember_teamId_communityId_fkey'
      AND conrelid = 'public."CommunityTeamMember"'::regclass
      AND confrelid = 'public."CommunityTeam"'::regclass
      AND contype = 'f' AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'community_teams: membership must cascade with its team';
  END IF;

  IF to_regclass('public."CommunityTeamMember_teamId_userId_key"') IS NULL
     OR to_regclass('public."CommunityTeam_id_communityId_key"') IS NULL THEN
    RAISE EXCEPTION 'community_teams: team membership and community-scoped team keys are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Session'
      AND column_name = 'communityTeamId' AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Session_communityTeamId_fkey'
      AND conrelid = 'public."Session"'::regclass
      AND confrelid = 'public."CommunityTeam"'::regclass
      AND contype = 'f' AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'session_community_team: optional team relation must use ON DELETE SET NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Community'
      AND column_name = 'towerLevelsPerFloor'
      AND data_type = 'integer' AND is_nullable = 'NO'
      AND column_default = '10'
  ) THEN
    RAISE EXCEPTION 'tower_levels_per_floor: expected non-null integer default 10';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CommunityTeam_gameId_fkey'
      AND conrelid = 'public."CommunityTeam"'::regclass
      AND confrelid = 'public."Game"'::regclass
      AND contype = 'f' AND confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'community_team_game_restrict: deleting a referenced game must be restricted';
  END IF;

  IF (
    SELECT count(*) FROM "_prisma_migrations"
    WHERE migration_name IN (
      '20261026180000_community_teams',
      '20261026190000_session_community_team',
      '20261026210000_tower_levels_per_floor',
      '20261026220000_community_team_game_restrict'
    ) AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  ) <> 4 THEN
    RAISE EXCEPTION 'expected all four Tower/team migrations to be applied';
  END IF;
END
$tower_migrations$;
