param(
    [ValidateSet('all', 'win', 'linux', 'mac', 'android', 'test', 'clean')]
    [string]$Target = 'all',
    [switch]$NoTests,
    [switch]$NoFfmpeg,
    [switch]$CleanCache
)

$ErrorActionPreference = 'Stop'
$software = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $software
$assets = Join-Path $repo 'settings'
$translations = Join-Path $repo 'translations'
$coreAssets = Join-Path $software 'Bulkut.Core\Assets'
$coreTranslations = Join-Path $coreAssets 'translations'
$resources = Join-Path $software 'Bulkut.Core\Resources'
$embedded = Join-Path $resources 'ffmpeg.bin'
$cache = Join-Path $software 'ffmpeg-cache'
$dist = Join-Path $software 'dist'

$ffmpegVersion = 'n8.1.2-1'
$ffmpegBase = "https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/$ffmpegVersion"
$platforms = @(
    @{ Rid = 'win-x64';   File = 'ffmpeg-win-x64.exe';   Output = 'Bulkut-win-x64.exe' },
    @{ Rid = 'linux-x64'; File = 'ffmpeg-linux-x64';     Output = 'Bulkut-linux-x64' },
    @{ Rid = 'osx-x64';   File = 'ffmpeg-osx-x64';       Output = 'Bulkut-osx-x64' },
    @{ Rid = 'osx-arm64'; File = 'ffmpeg-osx-arm64';     Output = 'Bulkut-osx-arm64' }
)

function Write-Step([string]$message) {
    Write-Host ''
    Write-Host "==> $message" -ForegroundColor Cyan
}

function Sync-WebAssets {
    Write-Step 'Copying the web settings and translations into the solution'
    New-Item -ItemType Directory -Force -Path $coreTranslations | Out-Null
    foreach ($name in @('config.json', 'default.json')) {
        Copy-Item (Join-Path $assets $name) (Join-Path $coreAssets $name) -Force
    }
    foreach ($name in @('en.json', 'fr.json', 'es.json')) {
        Copy-Item (Join-Path $translations $name) (Join-Path $coreTranslations $name) -Force
    }
}

function Invoke-Tests {
    Write-Step 'Running the unit tests'
    dotnet test (Join-Path $software 'Bulkut.Tests\Bulkut.Tests.csproj') -c Release --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
}

function Get-Ffmpeg([string]$rid, [string]$file) {
    $folder = Join-Path $cache $rid
    $binaryName = if ($rid -like 'win-*') { 'ffmpeg.exe' } else { 'ffmpeg' }
    $binary = Join-Path $folder $binaryName
    if (Test-Path $binary) {
        Write-Host "    cached: $binary"
        return $binary
    }

    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $url = "$ffmpegBase/$file"
    $temporary = "$binary.download"
    Write-Host "    downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $temporary -UseBasicParsing
    if ((Get-Item $temporary).Length -lt 10MB) {
        Remove-Item $temporary -Force
        throw "The FFmpeg download for $rid looks truncated."
    }
    Move-Item $temporary $binary -Force
    return $binary
}

function Publish-Android {
    Write-Step 'Publishing the Android APK'

    dotnet publish (Join-Path $software 'Bulkut.Android\Bulkut.Android.csproj') `
        -c Release `
        -f net10.0-android36.0 `
        -p:AndroidPackageFormats=apk `
        -p:DebugType=None `
        -p:DebugSymbols=false `
        --nologo
    if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed for Android' }

    # The SDK names the artifact after the application id; the signed one is
    # the file to ship, the other is only its unsigned twin.
    $built = Get-ChildItem (Join-Path $software 'Bulkut.Android\bin\Release\net10.0-android36.0') -Filter '*-Signed.apk' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $built) { throw 'The Android publish did not produce a signed APK' }

    $final = Join-Path $dist 'Bulkut-android.apk'
    Copy-Item $built.FullName $final -Force
    Write-Host ("    {0} ({1:N1} MB)" -f $final, ((Get-Item $final).Length / 1MB)) -ForegroundColor Green
}

function Publish-One([hashtable]$platform) {
    $rid = $platform.Rid
    $outputName = $platform.Output
    Write-Step "Publishing $rid"

    if (-not $NoFfmpeg) {
        $binary = Get-Ffmpeg $rid $platform.File
        Copy-Item $binary $embedded -Force
        Write-Host ("    embedding FFmpeg ({0:N1} MB)" -f ((Get-Item $binary).Length / 1MB))
    } elseif (Test-Path $embedded) {
        Remove-Item $embedded -Force
    }

    $out = Join-Path $dist $rid
    if (Test-Path $out) { Remove-Item $out -Recurse -Force }

    dotnet publish (Join-Path $software 'Bulkut\Bulkut.csproj') `
        -c Release `
        -r $rid `
        --self-contained true `
        -p:PublishSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:EnableCompressionInSingleFile=true `
        -p:DebugType=None `
        -p:DebugSymbols=false `
        -p:PublishTrimmed=false `
        -p:InvariantGlobalization=false `
        -o $out
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed for $rid" }

    $produced = if ($rid -like 'win-*') { Join-Path $out 'Bulkut.exe' } else { Join-Path $out 'Bulkut' }
    if (-not (Test-Path $produced)) { throw "The $rid publish did not produce Bulkut" }

    $final = Join-Path $dist $outputName
    Move-Item $produced $final -Force
    $leftovers = Get-ChildItem $out -File
    foreach ($leftover in $leftovers) {
        if ($leftover.Name -like '*.pdb' -or $leftover.Name -like '*.dbg') {
            Remove-Item $leftover.FullName -Force
        }
    }

    Remove-Item $out -Recurse -Force
    Write-Host ("    {0} ({1:N1} MB)" -f $final, ((Get-Item $final).Length / 1MB)) -ForegroundColor Green
}

try {
    if ($Target -eq 'clean') {
        Write-Step 'Cleaning build outputs'
        Remove-Item (Join-Path $dist '*') -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $software 'Bulkut\bin') -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $software 'Bulkut\obj') -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $software 'Bulkut.Core\bin') -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $software 'Bulkut.Core\obj') -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $software 'Bulkut.Tests\bin') -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $software 'Bulkut.Tests\obj') -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $software 'Bulkut.Shared\bin') -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $software 'Bulkut.Shared\obj') -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $software 'Bulkut.Android\bin') -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $software 'Bulkut.Android\obj') -Recurse -Force -ErrorAction SilentlyContinue
        if ($CleanCache) { Remove-Item $cache -Recurse -Force -ErrorAction SilentlyContinue }
        Write-Host 'Done.'
        exit 0
    }

    Sync-WebAssets

    if ($Target -eq 'test') {
        Invoke-Tests
        Write-Step 'Tests passed'
        exit 0
    }

    New-Item -ItemType Directory -Force -Path $dist | Out-Null
    New-Item -ItemType Directory -Force -Path $resources | Out-Null

    if (-not $NoTests) { Invoke-Tests }

    $selected = switch ($Target) {
        'win'     { $platforms | Where-Object { $_.Rid -eq 'win-x64' } }
        'linux'   { $platforms | Where-Object { $_.Rid -eq 'linux-x64' } }
        'mac'     { $platforms | Where-Object { $_.Rid -like 'osx-*' } }
        'android' { @() }
        default   { $platforms }
    }

    foreach ($platform in $selected) { Publish-One $platform }
    if ($Target -in @('all', 'android')) { Publish-Android }

    Write-Step 'Done'
    Get-ChildItem $dist -File | Select-Object Name, @{ Name = 'MB'; Expression = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize
}
finally {
    if (Test-Path $embedded) { Remove-Item $embedded -Force -ErrorAction SilentlyContinue }
}
