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
$deployment = Wait-Deploy 'sha'
Assert ($script:polls -eq 1 -and $deployment.Url -eq 'nouveau') 'Un ancien statut vert ne doit pas masquer le deploiement en attente'

# Simulation d'une fusion : aucun gh/git reel n'est appele.
function Get-Gate { return @{ok=$true; headSha='abc123'; item='L1-01'} }
function Wait-Ci { return @{State='pass'} }
function Log { }
function Add-State { }
function Register-Success { }
function G { }
function Wait-Deploy { return @{Ok=$true; Url='mock'} }
function Write-Morning { }
function gh {
  $global:LASTEXITCODE = 0
  if ($args[1] -eq 'merge') {
    Assert (($args -join ' ') -match '--match-head-commit abc123') 'La fusion doit verrouiller le SHA'
    $script:mergeSeen = $true
  }
  if ($args -contains 'mergeCommit') { return 'merge123' }
}
$script:mergeSeen = $false
Assert ((Process-Pr 1 $false) -eq 'merged') 'La simulation doit atteindre la fusion'
Assert $script:mergeSeen 'La fusion simulee doit avoir ete appelee'
Write-Output 'roadmap-selfcheck : 10 controles reussis (aucun reseau, aucune fusion reelle)'
