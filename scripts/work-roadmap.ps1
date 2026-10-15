# Boucle /next-item : un element de docs/ROADMAP.md par appel de claude -p.
# Arret : MaxItems atteint, EN ATTENTE DE RELECTURE, ROADMAP TERMINEE, 2 echecs de suite, limite d'usage.
# Usage : pwsh scripts/work-roadmap.ps1 [-MaxItems 3] [-BudgetUsd 5] [-Model sonnet]
param(
  [int]$MaxItems = 3,
  [double]$BudgetUsd = 5,
  [string]$Model = 'sonnet'
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
New-Item -ItemType Directory -Force logs | Out-Null
$logFile = "logs/roadmap-$(Get-Date -Format 'yyyy-MM-dd').log"
function Log([string]$m) {
  $l = "[$(Get-Date -Format 'HH:mm:ss')] $m"
  Write-Host $l
  Add-Content -Path $logFile -Value $l -Encoding utf8
}

# Base de test locale uniquement (jamais Neon) : ecrase toute DATABASE_URL heritee.
$localDb = 'postgresql://postgres:test@127.0.0.1:55439/gamenight_test'
$env:DATABASE_URL = $localDb
$env:TEST_DATABASE_URL = $localDb
if (-not (docker ps -q -f name=gamenight-test-pg)) {
  if (docker ps -aq -f name=gamenight-test-pg) { docker start gamenight-test-pg | Out-Null }
  else { Log 'Conteneur gamenight-test-pg absent : voir CLAUDE.md (etapes 1-2). Arret.'; exit 1 }
}

# Pas de bypassPermissions : acceptEdits + liste blanche ; tout le reste est refuse (--permission-prompts none).
$allowed = @(
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Agent', 'Skill',
  'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git branch*)', 'Bash(git fetch*)',
  'Bash(git ls-remote*)', 'Bash(git switch*)', 'Bash(git add *)', 'Bash(git commit*)', 'Bash(git push -u origin claude/*)',
  'Bash(git push origin claude/*)', 'Bash(git show*)',
  'Bash(gh pr create --draft*)', 'Bash(gh pr list*)', 'Bash(gh pr view*)', 'Bash(gh pr edit*)', 'Bash(gh pr checks*)',
  'Bash(npm test*)', 'Bash(npm run lint*)', 'Bash(npm run test:postgres*)', 'Bash(npx vitest*)', 'Bash(npx tsc --noEmit*)',
  'Bash(npx eslint*)', 'Bash(npx next build*)', 'Bash(npx prisma generate*)', 'Bash(npx prisma migrate deploy*)',
  'Bash(npx prisma migrate dev*)', 'Bash(docker ps*)', 'Bash(graphify *)', 'Bash(mkdir *)', 'Bash(ls *)'
) -join ','
$denied = @(
  'Bash(git push --force*)', 'Bash(git push -f*)', 'Bash(git merge*)', 'Bash(git reset --hard*)', 'Bash(git add -A*)',
  'Bash(git add .)', 'Bash(gh pr merge*)', 'Bash(gh pr ready*)', 'Bash(vercel*)', 'Bash(*neon.tech*)',
  'Read(.env)', 'Read(.env.*)', 'Edit(.env)', 'Edit(.env.*)', 'Write(.env)', 'Write(.env.*)'
) -join ','

$done = 0; $fails = 0
while ($done -lt $MaxItems) {
  Log "Element $($done + 1)/$MaxItems : lancement de /next-item"
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $raw = & claude -p '/next-item' --permission-mode acceptEdits --permission-prompts none `
    --allowedTools $allowed --disallowedTools $denied --model $Model `
    --max-budget-usd $BudgetUsd --output-format json --no-session-persistence `
    --worktree "roadmap-$stamp" 2>&1 | Out-String
  $code = $LASTEXITCODE
  $text = $raw; $isError = $false
  try { $j = $raw | ConvertFrom-Json; $text = [string]$j.result; $isError = [bool]$j.is_error } catch { }
  Add-Content -Path $logFile -Value $text -Encoding utf8

  if ($raw -match '(?i)usage limit|rate limit|limit reached|quota exceeded|credit balance') {
    Log 'Limite d''usage detectee : arret.'; break
  }
  if ($code -ne 0 -or $isError -or $text -notmatch 'PR OUVERTE|ELEMENT BLOQUE|EN ATTENTE DE RELECTURE|ROADMAP TERMINEE') {
    $fails++
    Log "Echec ($fails/2) : code=$code is_error=$isError"
    if ($fails -ge 2) { Log '2 echecs consecutifs : arret.'; break }
    continue
  }
  $fails = 0
  if ($text -match 'EN ATTENTE DE RELECTURE') { Log 'EN ATTENTE DE RELECTURE : arret.'; break }
  if ($text -match 'ROADMAP TERMINEE') { Log 'Roadmap terminee : arret.'; break }
  $done++
  Log "Element termine : $(($text -split "`n" | Where-Object { $_ -match 'PR OUVERTE|ELEMENT BLOQUE' } | Select-Object -First 1))"
}
Log "Fin : $done element(s) traite(s)."
