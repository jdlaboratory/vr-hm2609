<#
    make-web-equirect.ps1

    Rebuilds the web-sized equirectangular panoramas used by the tour from the
    untouched originals in assets/source-panoramas/.

    The originals are 8192 x 4096. Marzipano loads an equirectangular panorama
    as a single GPU texture, and a 32-megapixel texture is both a large download
    and beyond the safe texture limit on older mobile GPUs, so the tour ships
    4096 x 2048 copies plus a 1024 x 512 preview level.

    Output (two files per scene, {z} in tour.json selects the level):
        assets/panoramas/equirect/sceneNN_0.jpg     1024 x 512   loads first
        assets/panoramas/equirect/sceneNN_1.jpg     4096 x 2048  full quality

    Scene ids follow the source file numbers: 006.jpg -> scene06.

    Usage:
        pwsh tools/make-web-equirect.ps1
        pwsh tools/make-web-equirect.ps1 -FullWidth 8192      # keep more detail

    Requires ffmpeg on PATH. This script never modifies assets/source-panoramas.
#>

[CmdletBinding()]
param(
    [int] $FullWidth = 4096,
    [int] $PreviewWidth = 1024,
    [int] $Quality = 3          # ffmpeg -q:v, lower is better (2-5 is sensible)
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDir   = Join-Path $projectRoot 'assets\source-panoramas'
$outputDir   = Join-Path $projectRoot 'assets\panoramas\equirect'

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    throw 'ffmpeg was not found on PATH. Install it and try again.'
}
if (-not (Test-Path $sourceDir)) {
    throw "Source folder not found: $sourceDir"
}
New-Item -ItemType Directory -Force $outputDir | Out-Null

$sources = Get-ChildItem -Path $sourceDir -Filter '*.jpg' | Sort-Object Name
Write-Host "Converting $($sources.Count) panorama(s) into $outputDir"

foreach ($source in $sources) {
    $number = [int]$source.BaseName
    $sceneId = 'scene{0:D2}' -f $number

    $full    = Join-Path $outputDir "${sceneId}_1.jpg"
    $preview = Join-Path $outputDir "${sceneId}_0.jpg"

    & ffmpeg -y -loglevel error -i $source.FullName `
        -vf "scale=${FullWidth}:$($FullWidth / 2):flags=lanczos" -q:v $Quality $full
    & ffmpeg -y -loglevel error -i $source.FullName `
        -vf "scale=${PreviewWidth}:$($PreviewWidth / 2):flags=lanczos" -q:v 5 $preview

    Write-Host ("  {0} -> {1}  ({2} KB + {3} KB)" -f $source.Name, $sceneId,
        [math]::Round((Get-Item $full).Length / 1KB),
        [math]::Round((Get-Item $preview).Length / 1KB))
}

Write-Host "`nDone. tour.json should reference them as:"
Write-Host '  "panorama": {'
Write-Host '    "type": "equirectangular",'
Write-Host '    "url": "assets/panoramas/equirect/sceneNN_{z}.jpg",'
Write-Host ('    "levels": [{{ "width": {0} }}, {{ "width": {1} }}]' -f $PreviewWidth, $FullWidth)
Write-Host '  }'
