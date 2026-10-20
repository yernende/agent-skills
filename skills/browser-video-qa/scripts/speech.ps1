param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$request = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $synthesizer.SelectVoice($request.voice)
  $synthesizer.Rate = 0
  $synthesizer.Volume = 100
  $clips = @()
  $index = 0
  foreach ($text in $request.texts) {
    $wavePath = Join-Path (Split-Path -Parent $OutputPath) ('speech-{0:D3}.wav' -f $index)
    if (Test-Path -LiteralPath $wavePath) { throw "Speech output already exists: $wavePath" }
    $synthesizer.SetOutputToWaveFile($wavePath)
    $synthesizer.Speak([string]$text)
    $synthesizer.SetOutputToNull()
    $clips += [pscustomobject]@{ text = $text; path = $wavePath }
    $index++
  }
  $report = @{ status = 'ready'; voice = $synthesizer.Voice.Name; clips = @($clips) } | ConvertTo-Json -Depth 5
} catch {
  $report = @{ status = 'unavailable'; reason = $_.Exception.GetBaseException().Message } | ConvertTo-Json
} finally {
  $synthesizer.Dispose()
}
[System.IO.File]::WriteAllText($OutputPath, $report, (New-Object System.Text.UTF8Encoding($false)))
