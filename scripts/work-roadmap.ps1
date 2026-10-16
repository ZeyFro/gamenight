# Boucle roadmap : /next-item (un element a la fois) -> porte deterministe -> CI -> fusion -> controle du deploiement.
# Decision du proprietaire (2026-10-15) : CE SCRIPT (jamais Claude) passe la PR en ready et la fusionne dans main,
# apres la porte scripts/roadmap-gate.mjs et une CI verte. Chaque fusion applique ses migrations en production.
# Compatible Windows PowerShell 5.1 et PowerShell 7 (ASCII uniquement, pas d'operateur 7-seulement).
#
# Usage : powershell -File scripts\work-roadmap.ps1 [-MaxItems 0] [-BudgetUsd 50] [-Model sonnet] [-WaitMinutes 30] [-WorkDir <chemin>]
# Arret propre : creer logs\STOP (apres l'element en cours). Bilan : logs\MORNING.md. Etat : logs\session-state.json.
# Codes de sortie : 0 fin normale / STOP / MaxItems / roadmap terminee ; 1 echecs consecutifs (5) ;
#                   2 prerequis manquant ; 3 deja lance ; 4 deploiement de production en echec.
param(
  [int]$MaxItems = 0,          # 0 = illimite (nombre d'executions de /next-item)
  [double]$BudgetUsd = 50,     # plafond par execution de claude (--max-budget-usd)
  [string]$Model = 'sonnet',
  [int]$WaitMinutes = 30,      # attente apres une limite d'usage, et apres 2+ echecs consecutifs
  [string]$WorkDir = ''
)
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
if (-not $WorkDir) { $WorkDir = Join-Path (Split-Path $repo -Parent) 'gamenight-roadmap' }
$gateJs = Join-Path $PSScriptRoot 'roadmap-gate.mjs'
$logDir = Join-Path $repo 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$logFile = Join-Path $logDir ("roadmap-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")
$stopFile = Join-Path $logDir 'STOP'
$stateFile = Join-Path $logDir 'session-state.json'
$morningFile = Join-Path $logDir 'MORNING.md'
$utf8 = New-Object System.Text.UTF8Encoding $false
try { [Console]::OutputEncoding = $utf8 } catch { }
$OutputEncoding = $utf8

function Log([string]$m) {
  $l = "[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] " + $m
  Write-Host $l
  [System.IO.File]::AppendAllText($logFile, $l + [Environment]::NewLine, $utf8)
}
function Test-Stop { return (Test-Path $stopFile) }
function Stop-Loop([int]$code) { throw ("HALT:" + $code) }
function Short([string]$s, [int]$n = 300) { if (-not $s) { return '' }; $t = ($s -replace '\s+', ' ').Trim(); if ($t.Length -gt $n) { return $t.Substring(0, $n) }; return $t }

# Attente interruptible par logs\STOP (arret propre).
function Sleep-Interruptible([int]$seconds) {
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) {
    if (Test-Stop) { return $false }
    $left = [int][Math]::Ceiling(($end - (Get-Date)).TotalSeconds)
    Start-Sleep -Seconds ([Math]::Max(1, [Math]::Min(20, $left)))
  }
  return $true
}

function Invoke-Native([string]$exe, [string[]]$arguments) {
  $out = & $exe @arguments 2>&1 | Out-String
  return @{ Code = $LASTEXITCODE; Out = $out }
}
function G([string[]]$a) { return (Invoke-Native 'git' (@('-C', $WorkDir) + $a)) }
function GhOut([string[]]$a) { return (& gh @a 2>$null | Out-String) }
function GhJson([string[]]$a) {
  $o = GhOut $a
  try { return ($o | ConvertFrom-Json) } catch { return $null }
}

# ---------- Prerequis ----------
foreach ($c in @('git', 'gh', 'node', 'claude', 'docker')) {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Log ("Prerequis manquant : " + $c); exit 2 }
}
$null = & gh auth status 2>&1
if ($LASTEXITCODE -ne 0) { Log 'gh non authentifie (gh auth login). Arret.'; exit 2 }
if (-not (Test-Path $gateJs)) { Log ("Porte absente : " + $gateJs); exit 2 }
$repoName = (& gh repo view --json nameWithOwner --jq .nameWithOwner 2>$null | Out-String).Trim()
if (-not $repoName) { Log 'Depot GitHub introuvable. Arret.'; exit 2 }

# Un seul script a la fois : deux instances creeraient des doublons.
try { $lock = [System.IO.File]::Open((Join-Path $logDir 'roadmap.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch { Log 'Une autre instance tourne deja (logs\roadmap.lock). Arret.'; exit 3 }

# Base de test locale uniquement (jamais Neon). Les URL ne sont PAS exportees : avec TEST_DATABASE_URL, "npm test"
# lance les suites Postgres en parallele (TRUNCATE partages) et echoue. Elles ne servent qu'en prefixe de commandes autorisees.
$localDb = 'postgresql://postgres:test@127.0.0.1:55439/gamenight_test'
$env:DATABASE_URL = $null
$env:TEST_DATABASE_URL = $null
if (-not (& docker ps -q -f name=gamenight-test-pg 2>$null | Out-String).Trim()) {
  if ((& docker ps -aq -f name=gamenight-test-pg 2>$null | Out-String).Trim()) { & docker start gamenight-test-pg | Out-Null }
  else { Log 'Conteneur gamenight-test-pg absent : voir CLAUDE.md (etapes 1-2). Arret.'; $lock.Dispose(); exit 2 }
}

# Pas de bypassPermissions : acceptEdits + liste blanche ; tout le reste est refuse (--permission-prompts none).
$allowed = @(
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Agent', 'Skill',
  'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git branch *)', 'Bash(git fetch *)',
  'Bash(git ls-remote *)', 'Bash(git switch *)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git show *)',
  'Bash(git rev-parse *)', 'Bash(git merge-base *)',
  'Bash(git push -u origin claude/*)', 'Bash(git push origin claude/*)',
  'Bash(gh pr create *--draft*)', 'Bash(gh pr list *)', 'Bash(gh pr view *)', 'Bash(gh pr edit *)', 'Bash(gh pr checks *)',
  'Bash(gh pr diff *)', 'Bash(gh run list *)', 'Bash(gh run view *)',
  'Bash(npm test *)', 'Bash(npm run lint *)', 'Bash(npx vitest *)', 'Bash(npx next typegen *)', 'Bash(npx tsc --noEmit *)',
  'Bash(npx eslint *)', 'Bash(npx next build *)', 'Bash(npx prisma generate *)',
  "Bash(TEST_DATABASE_URL=$localDb npx vitest *)",
  "Bash(TEST_DATABASE_URL=$localDb npm run test:postgres *)",
  "Bash(DATABASE_URL=$localDb npx prisma migrate deploy *)",
  "Bash(DATABASE_URL=$localDb npx prisma migrate dev *)",
  'Bash(docker ps *)', 'Bash(graphify *)', 'Bash(ls *)'
) -join ','
$denied = @(
  'Bash(git push --force*)', 'Bash(git push -f*)', 'Bash(git push --delete*)', 'Bash(git merge *)','Bash(git reset --hard*)',
  'Bash(git add -A*)', 'Bash(git add .)', 'Bash(gh pr merge*)', 'Bash(gh pr ready*)', 'Bash(gh pr close*)',
  'Bash(vercel*)', 'Bash(*neon.tech*)',
  'Read(.env)', 'Read(.env.*)', 'Edit(.env)', 'Edit(.env.*)', 'Write(.env)', 'Write(.env.*)'
) -join ','

# ---------- Veille : SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) depuis le thread principal ----------
$powerOk = $false
try {
  Add-Type -Namespace RoadmapLoop -Name Power -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);' -ErrorAction Stop
} catch { }
function Set-NoSleep([bool]$on) {
  try {
    $flags = 2147483648                       # ES_CONTINUOUS : relache
    if ($on) { $flags = 2147483649 }          # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    $prev = [RoadmapLoop.Power]::SetThreadExecutionState([uint32]$flags)
    if ($prev -eq 0) { return $false }
    return $true
  } catch { return $false }
}

# ---------- Etat de session et bilan ----------
$script:State = @{ startedAt = (Get-Date).ToString('s'); merged = @(); failed = @(); toi = @(); deployFailure = $null }
if (Test-Path $stateFile) {
  try {
    $old = [System.IO.File]::ReadAllText($stateFile, $utf8).TrimStart([char]0xFEFF) | ConvertFrom-Json
    if ($old.startedAt -and $old.startedAt.Substring(0, 10) -eq (Get-Date -Format 'yyyy-MM-dd')) {
      $script:State.startedAt = $old.startedAt
      $script:State.merged = @($old.merged | Where-Object { $_ -ne $null })
      $script:State.failed = @($old.failed | Where-Object { $_ -ne $null })
      $script:State.toi = @($old.toi | Where-Object { $_ -ne $null })
    }
  } catch { }
}
function Add-State([string]$name, $obj) { $script:State[$name] = @(@($script:State[$name] | Where-Object { $_ -ne $null }) + @($obj)) }
function Save-State { [System.IO.File]::WriteAllText($stateFile, ($script:State | ConvertTo-Json -Depth 6), $utf8) }
function Get-RoadmapMain {
  $o = & git -C $WorkDir show 'origin/main:docs/ROADMAP.md' 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ($o -join "`n")
}
function Write-Morning {
  Save-State
  $md = Get-RoadmapMain
  if (-not $md) { return }
  $tmp = Join-Path $logDir 'roadmap-main.md'
  [System.IO.File]::WriteAllText($tmp, $md, $utf8)
  & node $gateJs morning $stateFile $tmp $morningFile 2>&1 | Out-Null
}

# ---------- Echecs consecutifs : 2 -> attente, 5 -> arret ----------
$script:Fails = 0
function Register-Success { $script:Fails = 0 }
function Register-Failure([string]$why) {
  $script:Fails++
  Log ("Echec " + $script:Fails + "/5 : " + (Short $why 200))
  if ($script:Fails -ge 5) { Stop-Loop 1 }
  if ($script:Fails -ge 2) {
    Log ("2 echecs consecutifs ou plus : attente de " + $WaitMinutes + " min.")
    if (-not (Sleep-Interruptible ($WaitMinutes * 60))) { Stop-Loop 0 }
  }
}

# ---------- Worktree de la boucle (npm ci reel : une jonction casse "next build") ----------
function Ensure-Deps {
  $nm = Join-Path $WorkDir 'node_modules'
  if (Test-Path $nm) {
    if ((Get-Item $nm -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      Log 'node_modules est une jonction (casse next build) : suppression de la jonction seule.'
      [System.IO.Directory]::Delete($nm)
    }
  }
  $lockFile = Join-Path $WorkDir 'package-lock.json'
  if (-not (Test-Path $lockFile)) { Log 'package-lock.json absent du worktree. Arret.'; Stop-Loop 2 }
  $hash = (Get-FileHash $lockFile -Algorithm SHA256).Hash
  $mark = Join-Path $nm '.roadmap-lock-hash'
  $cur = ''
  if (Test-Path $mark) { $cur = ([System.IO.File]::ReadAllText($mark)).Trim() }
  if ((Test-Path $nm) -and $cur -eq $hash) { return }
  Log 'npm ci dans le worktree (premiere fois ou package-lock.json change) ...'
  Push-Location $WorkDir
  try {
    & cmd /c 'npm ci --no-audit --no-fund' 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Log 'npm ci a echoue. Arret.'; Stop-Loop 2 }
    & cmd /c 'npx prisma generate' 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Log 'prisma generate a echoue. Arret.'; Stop-Loop 2 }
  } finally { Pop-Location }
  [System.IO.File]::WriteAllText($mark, $hash)
}
function Reset-Worktree {
  if (-not (Test-Path $WorkDir)) {
    $null = & git worktree add --detach $WorkDir origin/main 2>&1
    if (-not (Test-Path $WorkDir)) { Log 'Creation du worktree impossible. Arret.'; Stop-Loop 2 }
  }
  $status = G @('status', '--porcelain')
  if ($status.Code -ne 0 -or $status.Out.Trim()) { Log 'Worktree modifie : travail conserve, arret.'; Stop-Loop 2 }
  if ((G @('fetch', '-q', 'origin')).Code -ne 0) { Log 'Fetch impossible. Arret.'; Stop-Loop 2 }
  if ((G @('checkout', '-q', '--detach', 'origin/main')).Code -ne 0) { Log 'Checkout impossible. Arret.'; Stop-Loop 2 }
  if (-not (Test-Path (Join-Path $WorkDir '.claude\commands\next-item.md'))) {
    Log 'next-item.md absent de origin/main : la PR de mise en place est-elle fusionnee ? Arret.'; Stop-Loop 2
  }
  Ensure-Deps
}

# ---------- Appel de Claude (attente illimitee sur limite d'usage) ----------
function Invoke-Claude([string]$prompt) {
  while ($true) {
    Reset-Worktree
    Push-Location $WorkDir
    try {
      $raw = & claude -p $prompt --permission-mode acceptEdits --permission-prompts none `
        --allowedTools $allowed --disallowedTools $denied --model $Model `
        --max-budget-usd $BudgetUsd --output-format json --no-session-persistence 2>&1 | Out-String
      $code = $LASTEXITCODE
    } finally { Pop-Location }
    $j = $null; $text = $raw
    try { $j = $raw | ConvertFrom-Json; $text = [string]$j.result } catch { }
    $isError = ($null -eq $j) -or [bool]$j.is_error
    [System.IO.File]::AppendAllText($logFile, $text + [Environment]::NewLine, $utf8)
    $errored = $isError -or ($code -ne 0)
    # Limite d'usage : seulement si le run est en erreur (is_error ou code non nul), jamais sur le texte d'un run reussi.
    # 429 et libelles supposes (non confirmes) ; le brut est conserve dans logs\ pour verification.
    if ($errored -and ((($null -ne $j) -and ($j.api_error_status -eq 429)) -or ($raw -match '(?i)usage limit|rate limit|limit reached|limit will reset|quota exceeded'))) {
      [System.IO.File]::WriteAllText((Join-Path $logDir ("roadmap-raw-limite-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".json")), $raw, $utf8)
      Log ("Limite d'usage detectee. Reprise a " + (Get-Date).AddMinutes($WaitMinutes).ToString('HH:mm') + ".")
      if (-not (Sleep-Interruptible ($WaitMinutes * 60))) { Stop-Loop 0 }
      continue
    }
    if ($errored) {
      [System.IO.File]::WriteAllText((Join-Path $logDir ("roadmap-raw-echec-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".json")), $raw, $utf8)
    }
    return @{ Code = $code; Raw = $raw; Text = $text; IsError = $isError }
  }
}

# ---------- Porte, CI, fusion, deploiement ----------
function Get-Gate([int]$n) {
  for ($i = 0; $i -lt 3; $i++) {
    $o = & node $gateJs gate $n 2>$null | Out-String
    try { $g = $o | ConvertFrom-Json; if ($g) { return $g } } catch { }
    Start-Sleep -Seconds 20
  }
  return $null
}
function Get-CiState($checks) {
  $c = @($checks | Where-Object { $_ -ne $null })
  $bad = @($c | Where-Object { $_.bucket -eq 'fail' -or $_.bucket -eq 'cancel' })
  $vercel = @($bad | Where-Object { $_.name -like 'Vercel*' })
  if ($vercel.Count -gt 0) { return @{ State = 'blocked'; Names = 'Vercel'; Link = $vercel[0].link } }
  if ($bad.Count -gt 0) { return @{ State = 'fail'; Names = (($bad | ForEach-Object { $_.name }) -join ', '); Link = $bad[0].link } }
  $verify = @($c | Where-Object { $_.name -eq 'verify' -and $_.bucket -eq 'pass' })
  $preview = @($c | Where-Object { $_.name -eq 'Vercel' -and $_.bucket -eq 'pass' })
  $unfinished = @($c | Where-Object { $_.bucket -ne 'pass' })
  if ($verify.Count -gt 0 -and $preview.Count -gt 0 -and $unfinished.Count -eq 0) { return @{ State = 'pass'; Names = ''; Link = '' } }
  return @{ State = 'pending'; Names = ''; Link = '' }
}
function Wait-Ci([int]$n) {
  $deadline = (Get-Date).AddMinutes(45)
  Start-Sleep -Seconds 45
  while ((Get-Date) -lt $deadline) {
    $c = @(GhJson @('pr', 'checks', "$n", '--json', 'bucket,name,state,link') | Where-Object { $_ -ne $null })
    $result = Get-CiState $c
    if ($result.State -ne 'pending') { return $result }
    Start-Sleep -Seconds 60
  }
  return @{ State = 'timeout'; Names = ''; Link = '' }
}
function Wait-Deploy([string]$sha) {
  $deadline = (Get-Date).AddMinutes(25)
  while ((Get-Date) -lt $deadline) {
    $deps = @(GhJson @('api', ("repos/" + $repoName + "/deployments?sha=" + $sha + "&environment=Production")) | Where-Object { $_ -ne $null })
    $d = $deps | Where-Object { $_.creator.login -eq 'vercel[bot]' } | Select-Object -First 1
    if ($d) {
      $sts = @(GhJson @('api', ("repos/" + $repoName + "/deployments/" + $d.id + "/statuses")) | Where-Object { $_ -ne $null })
      $s = $sts | Select-Object -First 1
      if ($s) {
        if ($s.state -eq 'success') { return @{ Ok = $true; Url = $s.target_url } }
        if ($s.state -eq 'failure' -or $s.state -eq 'error') { return @{ Ok = $false; Url = $s.target_url } }
      }
    }
    Start-Sleep -Seconds 30
  }
  return @{ Ok = $false; Url = $null }
}
function Get-PrItem($pr) {
  $m = [regex]::Match([string]$pr.body, '<!-- roadmap-item: (L[1-7]-\d\d) -->')
  if ($m.Success) { return $m.Groups[1].Value }
  $m = [regex]::Match([string]$pr.title, '\[(L[1-7]-\d\d)\]\s*$')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}
function Get-OpenLotPrs {
  $l = @(GhJson @('pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,headRefName,baseRefName,title,body') | Where-Object { $_ -ne $null })
  return @($l | Where-Object { $_.headRefName -match '^claude/lot[1-7]-' } | Sort-Object number)
}
function Comment-Pr([int]$n, [string]$text) {
  $f = Join-Path $logDir 'pr-comment.md'
  [System.IO.File]::WriteAllText($f, $text, $utf8)
  $null = & gh pr comment "$n" --body-file $f 2>&1
}

$script:Skip = @{}
function New-StatusPr([string]$item, [string]$kind, [string]$reason) {
  Reset-Worktree
  $lot = $item.Substring(1, 1)
  $branch = 'claude/lot' + $lot + '-' + $item.ToLower() + '-' + (Get-Date -Format 'MMddHHmmss') + '-statut'
  $null = G @('switch', '-q', '-c', $branch, 'origin/main')
  Push-Location $WorkDir
  try {
    $reason | & node $gateJs status $item $kind 2>&1 | Out-Null
    $null = G @('add', 'docs/ROADMAP.md')
    if ((G @('diff', '--cached', '--quiet')).Code -eq 0) { Log ("Statut deja a jour pour " + $item); return $null }
    $null = G @('commit', '-q', '-m', ("docs(roadmap): " + $item + " " + $kind))
    $push = G @('push', '-q', '-u', 'origin', $branch)
    if ($push.Code -ne 0) { Log ("push du statut impossible : " + (Short $push.Out)); return $null }
    $body = Join-Path $logDir 'pr-statut.md'
    [System.IO.File]::WriteAllText($body, ("Statut pose par la boucle roadmap (" + $kind + ").`n`nRaison : " + $reason + "`n`n<!-- roadmap-item: " + $item + " -->"), $utf8)
    $o = & gh pr create --draft --base main --head $branch --title ("docs(roadmap): " + $item + " " + $kind + " [" + $item + "]") --body-file $body 2>&1 | Out-String
    $m = [regex]::Match($o, '/pull/(\d+)')
    if ($m.Success) { return [int]$m.Groups[1].Value }
    Log ("creation de la PR de statut impossible : " + (Short $o))
    return $null
  } finally { Pop-Location }
}

function Fail-Pr([int]$n, $item, [string]$reason, [bool]$isStatus) {
  $short = Short $reason 400
  Log ("PR #" + $n + " en echec (" + $item + ") : " + $short)
  Add-State 'failed' @{ pr = $n; item = $item; reason = $short }
  Comment-Pr $n ("Boucle roadmap : cette PR reste en Draft.`n`nRaison : " + $reason)
  $script:Skip[$n] = $true
  if ($isStatus) { Write-Morning; return 'failed' }
  if ($item) {
    $sp = New-StatusPr $item 'echec' $short
    if ($sp) {
      $r = Process-Pr $sp $true
      if ($r -eq 'deploy-failed') { return $r }
    }
  }
  Write-Morning
  Register-Failure ("PR #" + $n + " " + $short)
  return 'failed'
}

function Process-Pr([int]$n, [bool]$isStatus) {
  $fixes = 0
  while ($true) {
    $g = Get-Gate $n
    if ($null -eq $g) { Log ("Porte illisible pour la PR #" + $n + " (gh indisponible ?) : PR ignoree pour cette session."); $script:Skip[$n] = $true; return 'skipped' }
    if (-not $g.ok) { return (Fail-Pr $n $g.item ("porte : " + ($g.reasons -join ' ; ')) $isStatus) }
    $sha = $g.headSha
    Log ("PR #" + $n + " (" + $g.item + ") : porte OK, attente de la CI ...")
    $ci = Wait-Ci $n
    if ($ci.State -eq 'blocked') {
      Log ("PR #" + $n + " bloquee par Vercel (quota ou deploiement) : aucune relance, correction ni fusion. " + $ci.Link)
      Add-State 'failed' @{ pr = $n; item = $g.item; reason = 'Vercel bloque : aucune relance automatique' }
      $script:Skip[$n] = $true
      Write-Morning
      return 'skipped'
    }
    if ($ci.State -eq 'timeout') { return (Fail-Pr $n $g.item 'CI : delai de 45 min depasse' $isStatus) }
    if ($ci.State -eq 'fail') {
      if ($isStatus -or $fixes -ge 2) { return (Fail-Pr $n $g.item ("CI rouge : " + $ci.Names + " " + $ci.Link) $isStatus) }
      $fixes++
      Log ("CI rouge (" + $ci.Names + ") : passe de correction " + $fixes + "/2")
      $f = Invoke-Claude ("/fix-ci " + $n)
      if ($f.Code -ne 0 -or $f.IsError -or ($f.Text -notmatch 'CI CORRIGEE')) {
        return (Fail-Pr $n $g.item ("correction de la CI impossible : " + (Short $f.Text 200)) $isStatus)
      }
      Start-Sleep -Seconds 90
      continue
    }
    $g2 = Get-Gate $n
    if ($null -eq $g2 -or -not $g2.ok) { return (Fail-Pr $n $g.item 'porte refusee au moment de la fusion' $isStatus) }
    if ($g2.headSha -ne $sha) { Log ("PR #" + $n + " : nouveau commit pendant la CI, on recommence."); continue }
    $null = & gh pr ready "$n" 2>&1
    $m = & gh pr merge "$n" --merge --match-head-commit $sha 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { return (Fail-Pr $n $g.item ("fusion refusee : " + (Short $m 250)) $isStatus) }
    $mergeSha = (& gh pr view "$n" --json mergeCommit --jq .mergeCommit.oid 2>$null | Out-String).Trim()
    Log ("PR #" + $n + " fusionnee (" + $mergeSha + "). Attente du deploiement de production ...")
    $url = (& gh pr view "$n" --json url --jq .url 2>$null | Out-String).Trim()
    Add-State 'merged' @{ pr = $n; item = $g.item; url = $url }
    if (-not $isStatus) { Register-Success }
    $null = G @('fetch', '-q', 'origin')
    $d = Wait-Deploy $mergeSha
    if (-not $d.Ok) {
      Log ("DEPLOIEMENT EN ECHEC apres la PR #" + $n + " : " + $d.Url)
      $script:State.deployFailure = @{ pr = $n; url = $d.Url }
      Write-Morning
      return 'deploy-failed'
    }
    Log ("Deploiement OK : " + $d.Url)
    Write-Morning
    return 'merged'
  }
}

function Process-OpenPrs {
  while ($true) {
    $summary = $null
    if (Test-Path $WorkDir) { $null = G @('fetch', '-q', 'origin') }
    $md = Get-RoadmapMain
    if ($md) {
      $tmp = Join-Path $logDir 'roadmap-main.md'
      [System.IO.File]::WriteAllText($tmp, $md, $utf8)
      $summary = @((& node $gateJs summary $tmp 2>$null | Out-String) | ConvertFrom-Json)
    }
    $next = $null
    foreach ($pr in (Get-OpenLotPrs)) {
      if ($script:Skip.ContainsKey([int]$pr.number)) { continue }
      $item = Get-PrItem $pr
      $parked = $false
      if ($item -and $summary) {
        $row = $summary | Where-Object { $_.id -eq $item } | Select-Object -First 1
        $reParked = '^(' + [char]0x00C9 + 'CHEC|' + [char]0x00C0 + ' TOI|Fait)'
        if ($row -and ($row.status -match $reParked)) { $parked = $true }
      }
      if ($parked) { $script:Skip[[int]$pr.number] = $true; Log ("PR #" + $pr.number + " (" + $item + ") deja traitee ou en pause : ignoree."); continue }
      $next = $pr; break
    }
    if ($null -eq $next) { return 'ok' }
    $r = Process-Pr ([int]$next.number) ($next.headRefName -match '-statut$')
    if ($r -eq 'deploy-failed') { return $r }
    if ($r -eq 'merged') { $script:Skip[[int]$next.number] = $true }
  }
}

# ---------- Boucle principale ----------
$exitCode = 0
$script:Processed = 0
$sleepOk = Set-NoSleep $true
Log ("Boucle demarree (MaxItems=" + $MaxItems + ", WorkDir=" + $WorkDir + ", veille bloquee=" + $sleepOk + ")")
try {
  while ($true) {
    if (Test-Stop) { Log 'logs\STOP present : arret propre.'; break }
    $r = Process-OpenPrs
    if ($r -eq 'deploy-failed') { $exitCode = 4; break }
    Write-Morning
    if ($MaxItems -gt 0 -and $script:Processed -ge $MaxItems) { Log ("MaxItems atteint (" + $script:Processed + ")."); break }
    if (Test-Stop) { Log 'logs\STOP present : arret propre.'; break }
    $script:Processed++
    Log ("Lancement de /next-item (execution " + $script:Processed + ")")
    $res = Invoke-Claude '/next-item'
    $t = $res.Text
    if ($t -match 'ROADMAP TERMINEE') { Log 'Roadmap terminee.'; break }
    $bad = ($res.Code -ne 0) -or $res.IsError -or ($t -match 'ECHEC :') -or ($t -notmatch 'PR OUVERTE :|ELEMENT BLOQUE :')
    if ($bad) {
      Register-Failure ("next-item : code=" + $res.Code + " " + (Short $t 200))
      continue
    }
    $mt = [regex]::Match($t, 'ELEMENT BLOQUE : (L[1-7]-\d\d)\s*\S{1,3}\s*(.+)')
    if ($mt.Success) { Add-State 'toi' @{ item = $mt.Groups[1].Value; reason = (Short $mt.Groups[2].Value 200) }; Log ("Element bloque (a toi) : " + $mt.Groups[1].Value) }
  }
} catch {
  $msg = [string]$_.Exception.Message
  if ($msg -match '^HALT:(\d+)') { $exitCode = [int]$Matches[1]; Log ("Arret demande (code " + $exitCode + ").") }
  else { $exitCode = 1; Log ("Erreur inattendue : " + $msg + " | " + (Short ([string]$_.ScriptStackTrace) 300)) }
} finally {
  try { Write-Morning } catch { }
  $null = Set-NoSleep $false
  $lock.Dispose()
  Log ("Fin (code " + $exitCode + ").")
}
exit $exitCode
