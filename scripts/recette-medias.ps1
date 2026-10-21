param([string]$Script = 'scripts/recette-medias.mjs')
$ErrorActionPreference = 'Stop'
# Exiger un créneau PostgreSQL/Next exclusif avant ce lanceur; aucune migration ici.
if ($env:DOCKER_HOST) { throw 'DOCKER_HOST distant interdit.' }
$recipeDockerHost = docker context inspect --format '{{.Endpoints.docker.Host}}'
if ($LASTEXITCODE -ne 0) { throw 'Impossible de vérifier le contexte Docker.' }
if (-not ($recipeDockerHost.StartsWith('npipe:////./pipe/', [StringComparison]::Ordinal) -or $recipeDockerHost.StartsWith('unix://', [StringComparison]::Ordinal))) { throw 'Docker local requis.' }
$recipeContainerEnv = docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' gamenight-fixe2-browser-pg
if ($LASTEXITCODE -ne 0) { throw 'Conteneur local dédié absent.' }
$recipePasswordRow = $recipeContainerEnv | Where-Object { $_ -like 'POSTGRES_PASSWORD=*' } | Select-Object -First 1
if (-not $recipePasswordRow) { throw 'Mot de passe du conteneur local absent.' }
$recipePassword = $recipePasswordRow.Substring('POSTGRES_PASSWORD='.Length)
$recipeDatabase = 'postgresql://postgres:' + [uri]::EscapeDataString($recipePassword) + '@127.0.0.1:55447/gamenight_fixe2_browser'
$recipeTools = if ($env:GAMENIGHT_PLAYWRIGHT_MODULE_PATH) { $env:GAMENIGHT_PLAYWRIGHT_MODULE_PATH } else { Join-Path $env:TEMP 'gamenight-fixe2-browser-tools/node_modules/playwright-core' }
if (-not (Test-Path -LiteralPath $recipeTools)) { throw 'playwright-core hors application absent.' }
$previousDatabase = $env:TEST_DATABASE_URL
$previousPlaywright = $env:PLAYWRIGHT_MODULE_PATH
try {
  $env:TEST_DATABASE_URL = $recipeDatabase
  $env:PLAYWRIGHT_MODULE_PATH = $recipeTools
  node $Script
  if ($LASTEXITCODE -ne 0) { throw 'Recette médias échouée.' }
} finally {
  $env:TEST_DATABASE_URL = $previousDatabase
  $env:PLAYWRIGHT_MODULE_PATH = $previousPlaywright
  $recipeContainerEnv = $null
  $recipePasswordRow = $null
  $recipePassword = $null
  $recipeDatabase = $null
}
