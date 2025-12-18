Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$dotnet = "C:\Program Files\dotnet\dotnet.exe"
if (!(Test-Path $dotnet))
{
  throw "dotnet.exe not found at $dotnet"
}

$project = Join-Path $PSScriptRoot "..\native\win\win.csproj"
$outDir = Join-Path $PSScriptRoot "..\assets"
$publishDir = Join-Path $PSScriptRoot "..\native\win\bin\Release\net9.0-windows\win-x64\publish"

& $dotnet publish $project -c Release -r win-x64 --self-contained false /p:PublishSingleFile=true /p:IncludeNativeLibrariesForSelfExtract=true /p:PublishTrimmed=false

$exe = Join-Path $publishDir "win.exe"
if (!(Test-Path $exe))
{
  throw "publish output not found at $exe"
}

Copy-Item $exe (Join-Path $outDir "win.exe") -Force
Write-Host "Wrote assets\\win.exe"


