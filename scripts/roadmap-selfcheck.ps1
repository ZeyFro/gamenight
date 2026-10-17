# Tests sans reseau : extrait les fonctions sans executer la boucle ni ses prerequis.
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'work-roadmap.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($name in @('Get-CiState', 'Process-Pr', 'Wait-Deploy')) {
  $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (-not $fn) { throw "Fonction absente : $name" }
  Invoke-Expression $fn.Extent.Text
}
function Assert($condition, $message) { if (-not $condition) { throw $message } }
$verify = @{ name = 'verify'; bucket = 'pass' }
$vercel = @{ name = 'Vercel'; bucket = 'pass' }
Assert ((Get-CiState @($verify, $vercel)).State -eq 'pass') 'Les deux controles verts doivent passer'
Assert ((Get-CiState @($verify)).State -eq 'pending') 'Vercel absent doit bloquer'
Assert ((Get-CiState @($vercel, @{name='verify'; bucket='skipping'})).State -eq 'pending') 'verify ignore doit bloquer'
Assert ((Get-CiState @($verify, @{name='Vercel'; bucket='fail'; link='quota'})).State -eq 'blocked') 'Quota Vercel ne doit pas declencher fix-ci'
Assert ((Get-CiState @($verify, $vercel, @{name='requis'; bucket='pending'})).State -eq 'pending') 'Un controle en attente doit bloquer'
Assert ((Get-CiState @(@{name='verify'; bucket='fail'})).State -eq 'fail') 'La CI rouge doit echouer'
Assert ((Get-CiState @()).State -eq 'pending') 'Une reponse vide doit bloquer'

$script:polls = 0
function Start-Sleep { $script:polls++ }
function GhJson {
  if ($args[0][1] -like '*/statuses') {
    if ($script:polls -eq 0) { return @(@{state='pending'}, @{state='success'; target_url='ancien'}) }
    return @(@{state='success'; target_url='nouveau'})
  }
  return @(@{id=1; creator=@{login='vercel[bot]'}})
}
$deployment = Wait-Deploy ('a' * 40)
Assert ($script:polls -eq 1 -and $deployment.Url -eq 'nouveau') 'Un ancien statut vert ne doit pas masquer le deploiement en attente'
function GhJson { throw 'Un SHA vide ou invalide ne doit jamais consulter les deploiements' }
Assert (-not (Wait-Deploy '').Ok) 'Un SHA absent doit bloquer le suivi du deploiement'
Assert (-not (Wait-Deploy 'invalide').Ok) 'Un SHA invalide doit bloquer le suivi du deploiement'

# Simulation d'une fusion : aucun gh/git reel n'est appele.
function Get-Gate { return @{ok=$true; headSha='abc123'; baseSha='base123'; item='L1-01'} }
function Wait-Ci { return @{State='pass'} }
function Log { }
function Add-State { }
function Register-Success { }
function G { }
function Wait-Deploy { return @{Ok=$true; Url='mock'} }
function Write-Morning { }
function Fail-Pr { return 'failed' }
function GhJson {
  if ($args[0][1] -eq 'checks') { return @($verify, $vercel) }
  return @{headRefOid='abc123'; baseRefOid='base123'}
}
function gh {
  $global:LASTEXITCODE = 0
  if ($args[1] -eq 'merge') {
    Assert (($args -join ' ') -match '--match-head-commit abc123') 'La fusion doit verrouiller le SHA'
    $script:mergeSeen = $true
  }
  if ($args -contains 'mergeCommit') {
    if ($script:missingMergeSha) { $global:LASTEXITCODE = 1; return '' }
    return ('b' * 40)
  }
}
$script:mergeSeen = $false
$script:Skip = @{}
Assert ((Process-Pr 1 $false) -eq 'merged') 'La simulation doit atteindre la fusion'
Assert $script:mergeSeen 'La fusion simulee doit avoir ete appelee'

$script:mergeSeen = $false
$script:gates = 0
function Get-Gate {
  $script:gates++
  return @{ok=$true; headSha='abc123'; baseSha=$(if ($script:gates -eq 1) {'base123'} else {'base456'}); item='L1-01'}
}
$null = Process-Pr 1 $false
Assert (-not $script:mergeSeen) 'Une base avancee pendant la CI doit interdire la fusion'
function Get-Gate { return @{ok=$true; headSha='abc123'; baseSha='base123'; item='L1-01'} }
function GhJson {
  if ($args[0][1] -eq 'checks') { return @($verify, @{name='Vercel'; bucket='pending'}) }
  return @{headRefOid='abc123'; baseRefOid='base123'}
}
$null = Process-Pr 1 $false
Assert (-not $script:mergeSeen) 'Un controle relance apres Wait-Ci doit interdire la fusion'
function GhJson {
  if ($args[0][1] -eq 'checks') { return @($verify, $vercel) }
  return @{headRefOid='autre'; baseRefOid='base123'}
}
$null = Process-Pr 1 $false
Assert (-not $script:mergeSeen) 'Le SHA doit etre relu apres les controles finaux'
function GhJson {
  if ($args[0][1] -eq 'checks') { return @($verify, $vercel) }
  return @{headRefOid='abc123'; baseRefOid='base456'}
}
$null = Process-Pr 1 $false
Assert (-not $script:mergeSeen) 'La base doit etre relue apres les controles finaux'
function GhJson {
  if ($args[0][1] -eq 'checks') { return @($verify, $vercel) }
  return $null
}
$null = Process-Pr 1 $false
Assert (-not $script:mergeSeen) 'Une panne de lecture des SHA doit interdire la fusion'
function GhJson {
  if ($args[0][1] -eq 'checks') { return @($verify, $vercel) }
  return @{headRefOid='abc123'; baseRefOid='base123'}
}
$script:State = @{}
$script:missingMergeSha = $true
Assert ((Process-Pr 1 $false) -eq 'deploy-failed') 'Une panne de lecture du SHA apres fusion doit arreter la boucle'
Write-Output 'roadmap-selfcheck : 18 controles reussis (aucun reseau, aucune fusion reelle)'
