# `CommunityTeam.captainId` — migration en attente

- `createdById` : créateur historique, immuable.
- `captainId` : capitaine responsable (source officielle #370/#408), nullable.
- Sans cette colonne, `transferTeamCaptain` renvoie `captain_source_unavailable`
  et `/equipe transferer` explique que la passation n'est pas disponible ; le
  créateur actif reste capitaine **par transition**, et rien n'est écrit.
- Application test : `psql "$TEST_DATABASE_URL" -f docs/migrations/pending/20261117_team_captain/migration.sql`.
- **Non appliquée** sur Neon/Production.
