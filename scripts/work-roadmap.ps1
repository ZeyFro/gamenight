# Boucle /next-item : un element de docs/ROADMAP.md par appel de claude -p, PR empilees.
# Travaille dans un worktree dedie (-WorkDir), jamais dans le depot principal.
# Arret : plus d'element a faire (0), 2 echecs consecutifs (1). Prerequis manquant (2). Deja lance (3).
# Limite d'usage : journalise, attend -WaitMinutes, reessaie sans limite de tentatives.
# Usage : pwsh scripts/work-roadmap.ps1 [-MaxItems 0] [-BudgetUsd 5] [-Model sonnet] [-WaitMinutes 30] [-WorkDir <chemin>]
param(
  [int]$MaxItems = 0,          # 0 = illimite
  [double]$BudgetUsd = 5,      # plafond par element (--max-budget-usd)
  [string]$Model = 'sonnet',
  [int]$WaitMinutes = 30,
  [string]$WorkDir = ''
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
if (-not $WorkDir) { $WorkDir = Join-Path (Split-Path $repo -Parent) 'gamenight-roadmap' }
$logDir = Join-Path $repo 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$logFile = Join-Path $logDir "roadmap-$(Get-Date -Format 'yyyy-MM-dd').log"
function Log([string]$m) {
  $l = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $m"
  Write-Host $l
  Add-Content -Path $logFile -Value $l -Encoding utf8
}

# Un seul script a la fois : deux instances creeraient des doublons.
try { $lock = [System.IO.File]::Open((Join-Path $logDir 'roadmap.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch { Log 'Une autre instance tourne deja (logs/roadmap.lock). Arret.'; exit 3 }

# Base de test locale uniquement (jamais Neon) : ecrase toute DATABASE_URL heritee.
$localDb = 'postgresql://postgres:test@127.0.0.1:55439/gamenight_test'
$env:DATABASE_URL = $localDb
$env:TEST_DATABASE_URL = $localDb
if (-not (docker ps -q -f name=gamenight-test-pg)) {
  if (docker ps -aq -f name=gamenight-test-pg) { docker start gamenight-test-pg | Out-Null }
  else { Log 'Conteneur gamenight-test-pg absent : voir CLAUDE.md (etapes 1-2). Arret.'; exit 2 }
}

# Worktree dedie, cree une fois depuis origin/main.
git fetch -q origin
if (-not (Test-Path $WorkDir)) { git worktree add --detach $WorkDir origin/main | Out-Null }
if (-not (Test-Path (Join-Path $WorkDir '.claude\commands\next-item.md'))) {
  Log 'next-item.md absent du worktree : la PR chore/roadmap-autonome est-elle mergee ? Arret.'; exit 2
}
if (-not (Test-Path (Join-Path $WorkDir 'node_modules'))) {
  Log "node_modules absent du worktree. Propose (non execute) : cmd /c mklink /J `"$WorkDir\node_modules`" `"$repo\node_modules`""
  exit 2
}

# Pas de bypassPermissions : acceptEdits + liste blanche ; tout le reste est refuse (--permission-prompts none).
$allowed = @(
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Agent', 'Skill',
  'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git branch *)', 'Bash(git fetch *)',
  'Bash(git ls-remote *)', 'Bash(git switch *)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git show *)',
  'Bash(git push -u origin claude/*)', 'Bash(git push origin claude/*)',
  'Bash(gh pr create *--draft*)', 'Bash(gh pr list *)', 'Bash(gh pr view *)', 'Bash(gh pr edit *)', 'Bash(gh pr checks *)',
  'Bash(npm test *)', 'Bash(npm run lint *)', 'Bash(npm run test:postgres *)', 'Bash(npx vitest *)', 'Bash(npx tsc --noEmit *)',
  'Bash(npx eslint *)', 'Bash(npx next build *)', 'Bash(npx prisma generate *)', 'Bash(npx prisma migrate deploy *)',
  'Bash(npx prisma migrate dev *)', 'Bash(docker ps *)', 'Bash(graphify *)', 'Bash(ls *)'
) -join ','
$denied = @(
  'Bash(git push --force*)', 'Bash(git push -f*)', 'Bash(git merge*)', 'Bash(git reset --hard*)', 'Bash(git add -A*)',
  'Bash(git add .)', 'Bash(gh pr merge*)', 'Bash(gh pr ready*)', 'Bash(vercel*)', 'Bash(*neon.tech*)',
  'Read(.env)', 'Read(.env.*)', 'Edit(.env)', 'Edit(.env.*)', 'Write(.env)', 'Write(.env.*)'
) -join ','

$processed = 0; $fails = 0
Push-Location $WorkDir
try {
  while ($MaxItems -eq 0 -or $processed -lt $MaxItems) {
    # Repart d'un etat propre : un run interrompu peut laisser des changements non commites (le travail commite est garde).
    git reset -q --hard HEAD; git clean -fdq
    Log "Lancement de /next-item (traites: $processed, echecs consecutifs: $fails)"
    $raw = & claude -p '/next-item' --permission-mode acceptEdits --permission-prompts none `
      --allowedTools $allowed --disallowedTools $denied --model $Model `
      --max-budget-usd $BudgetUsd --output-format json --no-session-persistence 2>&1 | Out-String
    $code = $LASTEXITCODE
    $j = $null; $text = $raw
    try { $j = $raw | ConvertFrom-Json; $text = [string]$j.result } catch { }
    $isError = ($null -eq $j) -or [bool]$j.is_error
    Add-Content -Path $logFile -Value $text -Encoding utf8

    # Limite d'usage : seulement si le run est en erreur (is_error ou code non nul), jamais sur le texte d'un run reussi.
    # 429 et libelles supposes (non confirmes) ; le brut est conserve dans logs/.
    $errored = $isError -or ($code -ne 0)
    if ($errored -and (($j -and $j.api_error_status -eq 429) -or $raw -match '(?i)usage limit|rate limit|limit reached|limit will reset|quota exceeded')) {
      $raw | Set-Content (Join-Path $logDir "roadmap-raw-limite-$(Get-Date -Format 'yyyyMMdd-HHmmss').json") -Encoding utf8
      Log "Limite d'usage detectee. Reprise a $((Get-Date).AddMinutes($WaitMinutes).ToString('HH:mm'))."
      Start-Sleep -Seconds ($WaitMinutes * 60)
      continue
    }
    if ($text -match 'ROADMAP TERMINEE') { Log 'Roadmap terminee.'; exit 0 }

    $failed = ($code -ne 0) -or $isError -or ($text -match 'ECHEC :') -or ($text -notmatch 'PR OUVERTE :|ELEMENT BLOQUE :')
    if ($failed) {
      $raw | Set-Content (Join-Path $logDir "roadmap-raw-echec-$(Get-Date -Format 'yyyyMMdd-HHmmss').json") -Encoding utf8
      $fails++
      Log "Echec $fails/2 (code=$code is_error=$isError)"
      if ($fails -ge 2) { Log '2 echecs consecutifs : arret.'; exit 1 }
    } else {
      if ($text -notmatch 'ELEMENT BLOQUE :') { $fails = 0 }   # un blocage humain ne remet pas le compteur a zero
      Log "Element traite : $(($text -split "`n" | Where-Object { $_ -match 'PR OUVERTE :|ELEMENT BLOQUE :' } | Select-Object -First 1))"
    }
    $processed++
  }
  Log "MaxItems atteint ($processed)."
  exit 0
} finally {
  Pop-Location
  $lock.Dispose()
}
