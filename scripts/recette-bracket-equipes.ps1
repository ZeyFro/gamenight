$ErrorActionPreference = 'Stop'
$containerName = 'gamenight-bracket-recipe-pg'
$databaseName = 'gamenight_bracket_recipe'
$portMapping = docker port $containerName '5432/tcp'
if ($LASTEXITCODE -ne 0 -or $portMapping -notcontains '127.0.0.1:55441') { throw 'La base locale dédiée doit écouter uniquement sur 127.0.0.1:55441.' }
if ((docker inspect --format '{{.State.Running}}' $containerName) -ne 'true') { throw 'Le conteneur PostgreSQL local dédié doit déjà fonctionner.' }

$envRows = docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $containerName
$passwordRow = $envRows | Where-Object { $_ -like 'POSTGRES_PASSWORD=*' } | Select-Object -First 1
if (-not $passwordRow) { throw 'POSTGRES_PASSWORD absent du conteneur local dédié.' }
$password = $passwordRow.Substring('POSTGRES_PASSWORD='.Length)
$encodedPassword = [uri]::EscapeDataString($password)
$databaseUrl = "postgresql://postgres:$encodedPassword@127.0.0.1:55441/$databaseName"
$playwrightModule = if ($env:GAMENIGHT_PLAYWRIGHT_MODULE_PATH) { $env:GAMENIGHT_PLAYWRIGHT_MODULE_PATH } else { Join-Path $env:LOCALAPPDATA 'Temp\gamenight-browser-tools\node_modules\playwright-core' }
if (-not (Test-Path -LiteralPath $playwrightModule)) { throw 'Définir GAMENIGHT_PLAYWRIGHT_MODULE_PATH vers le playwright-core déjà installé.' }

try {
  $env:DATABASE_URL = $databaseUrl
  $env:TEST_DATABASE_URL = $databaseUrl
  $env:PLAYWRIGHT_MODULE_PATH = $playwrightModule
  node --input-type=module -e 'import { PrismaClient } from "@prisma/client"; const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL }); try { const [row] = await db.$queryRawUnsafe("SELECT current_database() AS name, inet_server_addr()::text AS address, inet_server_port() AS port"); if (row.name !== "gamenight_bracket_recipe" || !row.address || row.port !== 5432) throw new Error("Cible PostgreSQL locale inattendue"); console.log(`Cible locale vérifiée: ${row.name}, port ${row.port}`); } finally { await db.$disconnect(); }'
  if ($LASTEXITCODE -ne 0) { throw 'Échec de vérification de la base PostgreSQL.' }
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'Échec des migrations sur la base locale dédiée.' }
  node scripts/recette-bracket-equipes.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Échec de la recette navigateur locale.' }
} finally {
  Remove-Item Env:DATABASE_URL, Env:TEST_DATABASE_URL, Env:PLAYWRIGHT_MODULE_PATH -ErrorAction SilentlyContinue
  $password = $null
  $encodedPassword = $null
  $databaseUrl = $null
}
