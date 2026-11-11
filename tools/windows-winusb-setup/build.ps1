[CmdletBinding()]
param([string] $Output = (Join-Path $PSScriptRoot 'Toffee-Windows-Setup.exe'))
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
$manifest = Join-Path $PSScriptRoot 'ToffeeWinUsbSetup.manifest'
$source = Join-Path $PSScriptRoot 'ToffeeWinUsbSetup.cs'
& $compiler /nologo /warnaserror+ /optimize+ /platform:anycpu /target:winexe /r:System.Windows.Forms.dll "/win32manifest:$manifest" "/out:$Output" $source
if ($LASTEXITCODE -ne 0) { throw "C# compilation failed (exit $LASTEXITCODE)." }
Get-FileHash -Algorithm SHA256 -LiteralPath $Output
