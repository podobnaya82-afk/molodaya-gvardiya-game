$ErrorActionPreference = "Stop"

$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$game = Join-Path $PSScriptRoot "index.html"
$profile = Join-Path $env:TEMP ("mg-game-smoke-" + [Guid]::NewGuid().ToString("N"))
$port = Get-Random -Minimum 12000 -Maximum 18000
$uri = ([System.Uri]$game).AbsoluteUri

$edge = Start-Process -FilePath $edgePath -ArgumentList @(
  "--headless",
  "--disable-gpu",
  "--allow-file-access-from-files",
  "--remote-debugging-port=$port",
  "--user-data-dir=$profile",
  $uri
) -PassThru

try {
  $page = $null
  for ($attempt = 0; $attempt -lt 30 -and -not $page; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $pages = Invoke-RestMethod "http://127.0.0.1:$port/json"
       $page = $pages | Where-Object { $_.type -eq "page" -and $_.url -eq $uri } | Select-Object -First 1
    } catch {}
  }
  if (-not $page) { throw "Edge DevTools did not start" }

  $socket = New-Object System.Net.WebSockets.ClientWebSocket
  $webSocketUrl = [string]($page.webSocketDebuggerUrl | Select-Object -First 1)
  $socket.ConnectAsync((New-Object Uri($webSocketUrl)), [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  $script:commandId = 0

  function Invoke-DevTools([string]$method, [hashtable]$params) {
    $script:commandId++
    $id = $script:commandId
    $payload = @{ id = $id; method = $method; params = $params } | ConvertTo-Json -Depth 20 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
    $segment = New-Object ArraySegment[byte] -ArgumentList (,$bytes)
    $socket.SendAsync($segment, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null

    while ($true) {
      $buffer = New-Object byte[] 65536
      $responseSegment = New-Object ArraySegment[byte] -ArgumentList (,$buffer)
      $result = $socket.ReceiveAsync($responseSegment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      $json = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count) | ConvertFrom-Json
      if ($json.id -eq $id) { return $json }
    }
  }

  function Evaluate([string]$expression) {
    $response = Invoke-DevTools "Runtime.evaluate" @{
      expression = $expression
      returnByValue = $true
      awaitPromise = $true
    }
    if ($response.result.exceptionDetails) {
      throw $response.result.exceptionDetails.exception.description
    }
    return $response.result.result.value
  }

  function Assert-Page([string]$label, [string]$expression) {
    if (-not (Evaluate $expression)) { throw "Failed: $label" }
    "PASS: $label"
  }

  Invoke-DevTools "Runtime.enable" @{} | Out-Null
  "PAGE: $(Evaluate 'document.location.href')"
  "TITLE: $(Evaluate 'document.title')"
  Evaluate "localStorage.removeItem('molodaya-gvardiya-results-v1'); window.__testErrors = []; window.addEventListener('error', e => window.__testErrors.push(e.message)); true" | Out-Null

  Assert-Page "home screen" "document.querySelector('#participant-name') !== null"
  Evaluate "document.querySelector('#participant-name').value='Test User'; document.querySelector('#start-form').requestSubmit(); true" | Out-Null
  Assert-Page "personal briefing" "document.querySelector('#begin-button') !== null"
  Evaluate "document.querySelector('#begin-button').click(); true" | Out-Null

  Evaluate "document.querySelector('#check-button').click(); true" | Out-Null
  Assert-Page "wrong answer feedback" "document.querySelector('#feedback').innerText.length > 0"
  Evaluate "['occupation','union','flags','fire','arrests','liberation'].forEach(id => document.querySelector('[data-id='+id+']').click()); document.querySelector('#check-button').click(); true" | Out-Null
  Assert-Page "mission 1" "document.querySelector('.clue-stamp') !== null"
  Evaluate "document.querySelector('#continue-button').click(); document.querySelector('#hint-button').click(); true" | Out-Null
  Assert-Page "hint shown" "document.querySelector('#hint-text').hidden === false"
  Evaluate "document.querySelector('#cipher-answer').value='\u041b\u0418\u0421\u0422\u041e\u0412\u041a\u0410'; document.querySelector('#check-button').click(); true" | Out-Null
  Assert-Page "mission 2" "document.querySelector('.clue-stamp') !== null"
  Evaluate "document.querySelector('#continue-button').click(); document.querySelector('input[value=b]').checked=true; document.querySelector('#check-button').click(); true" | Out-Null
  Assert-Page "mission 3" "document.querySelector('.clue-stamp') !== null"
  Evaluate "document.querySelector('#continue-button').click(); document.querySelectorAll('[data-person]').forEach(x => x.value=x.dataset.person); document.querySelector('#check-button').click(); true" | Out-Null
  Assert-Page "mission 4" "document.querySelector('.clue-stamp') !== null"
  Evaluate "document.querySelector('#continue-button').click(); const sourceAnswers={flags:'fact',quote:'art',count:'check',novel:'fact'}; document.querySelectorAll('[data-source]').forEach(x => x.value=sourceAnswers[x.dataset.source]); document.querySelector('#check-button').click(); true" | Out-Null
  Assert-Page "mission 5" "document.querySelector('.clue-stamp') !== null"
  Evaluate "document.querySelector('#continue-button').click(); document.querySelector('#memory-toggle').click(); const memoryAnswers={code:'\u0421\u0415\u0412\u0415\u0420',time:'06:40',place:'\u041c\u0415\u041b\u042c\u041d\u0418\u0426\u0410',count:'12'}; document.querySelectorAll('[data-memory]').forEach(x => x.value=memoryAnswers[x.dataset.memory]); document.querySelector('#check-button').click(); true" | Out-Null
  Assert-Page "mission 6" "document.querySelector('.clue-stamp') !== null"
  Evaluate "document.querySelector('#continue-button').click(); document.querySelector('#final-answer').value='\u041a\u0420\u0410\u0421\u041d\u041e\u0414\u041e\u041d'; document.querySelector('#final-form').requestSubmit(); true" | Out-Null
  Assert-Page "final result" "document.querySelector('#results-button') !== null"
  Assert-Page "result saved" "JSON.parse(localStorage.getItem('molodaya-gvardiya-results-v1')).length === 1"
  Evaluate "state.participant='Slow User'; state.score=500; state.resultSaved=false; saveResult(999); true" | Out-Null
  Evaluate "document.querySelector('#results-button').click(); true" | Out-Null
  Assert-Page "leaderboard" "document.querySelectorAll('.leaderboard-row').length === 3 && document.querySelectorAll('.leaderboard-row')[1].innerText.includes('Test User')"
  Assert-Page "no runtime errors" "window.__testErrors.length === 0"
} finally {
  if ($socket) { $socket.Dispose() }
  if ($edge -and -not $edge.HasExited) { Stop-Process -Id $edge.Id -Force }
}
