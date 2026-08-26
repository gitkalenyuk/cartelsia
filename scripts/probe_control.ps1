param()
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

function Read-ImapGreeting {
  param($sr)
  $lines = @()
  for ($i = 0; $i -lt 5; $i++) {
    $line = $sr.ReadLine()
    if ($null -eq $line) { break }
    $lines += $line
    if ($line -like '*OK*') { break }
  }
  return ($lines -join ' | ')
}

function Send-Cmd {
  param($ssl, $cmd)
  $b = [System.Text.Encoding]::ASCII.GetBytes($cmd + "
")
  $ssl.Write($b, 0, $b.Length)
  $ssl.Flush()
}

function Read-Resp {
  param($sr, $tag, $timeoutSec)
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $out = @()
  $noResp = $false
  try {
    while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
      $line = $sr.ReadLine()
      if ($null -eq $line) { $out += '<eof>'; break }
      $out += $line
      if ($line.StartsWith($tag)) { break }
    }
  } catch {
    $noResp = $true
    $out += ("NO RESPONSE after {0:N1}s ({1}: {2})" -f $sw.Elapsed.TotalSeconds, $_.Exception.GetType().Name, $_.Exception.Message)
  }
  return [PSCustomObject]@{ lines = ($out -join ' | '); elapsed = [math]::Round($sw.Elapsed.TotalSeconds, 1); noResponse = $noResp }
}

function Read-OneLine {
  param($sr, $timeoutSec)
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $l = $sr.ReadLine()
    if ($null -eq $l) { return [PSCustomObject]@{ line = '<eof>'; elapsed = [math]::Round($sw.Elapsed.TotalSeconds,1); noResponse = $false } }
    return [PSCustomObject]@{ line = $l; elapsed = [math]::Round($sw.Elapsed.TotalSeconds,1); noResponse = $false }
  } catch {
    return [PSCustomObject]@{ line = ("NO RESPONSE after {0:N1}s" -f $sw.Elapsed.TotalSeconds); elapsed = [math]::Round($sw.Elapsed.TotalSeconds,1); noResponse = $true }
  }
}

function New-Ssl {
  param($tcp, $hostName)
  $tcp.Client.ReceiveTimeout = 12000
  $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, { param($s, $c, $ch, $e) $true })
  $ssl.AuthenticateAsClient($hostName)
  return $ssl
}

function Test-ImapLogin {
  param([string]$Server, [int]$Port, [string]$User, [string]$Pass, [double]$TimeoutSec, [string]$Label)
  $out = [PSCustomObject]@{ label = $Label; target = ($Server + ':' + $Port); outcome = ''; detail = ''; elapsed = 0.0 }
  $tcp = $null
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect($Server, $Port)
    $ssl = New-Ssl -tcp $tcp -hostName $Server
    $sr = New-Object System.IO.StreamReader($ssl, [System.Text.Encoding]::ASCII, $true)
    $greet = Read-ImapGreeting -sr $sr
    Send-Cmd -ssl $ssl -cmd ('A1 LOGIN ' + $User + ' ' + $Pass)
    $resp = Read-Resp -sr $sr -tag 'A1' -timeoutSec $TimeoutSec
    $out.outcome = if ($resp.noResponse) { 'SILENT' } else { 'RESPONDED' }
    $out.detail = 'greeting: ' + $greet + ' || resp: ' + $resp.lines
    $out.elapsed = $resp.elapsed
  } catch {
    $out.outcome = 'EXCEPTION'
    $out.detail = ($_.Exception.GetType().Name + ': ' + $_.Exception.Message)
  } finally { if ($tcp) { $tcp.Close() } }
  return $out
}

function Test-Pop3Login {
  param([string]$Server, [int]$Port, [string]$User, [string]$Pass, [double]$TimeoutSec, [string]$Label)
  $out = [PSCustomObject]@{ label = $Label; target = ($Server + ':' + $Port); outcome = ''; detail = ''; elapsed = 0.0 }
  $tcp = $null
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect($Server, $Port)
    $ssl = New-Ssl -tcp $tcp -hostName $Server
    $sr = New-Object System.IO.StreamReader($ssl, [System.Text.Encoding]::ASCII, $true)
    $greet = Read-OneLine -sr $sr -timeoutSec $TimeoutSec
    Send-Cmd -ssl $ssl -cmd ('USER ' + $User)
    $u = Read-OneLine -sr $sr -timeoutSec $TimeoutSec
    Send-Cmd -ssl $ssl -cmd ('PASS ' + $Pass)
    $p = Read-OneLine -sr $sr -timeoutSec $TimeoutSec
    $out.outcome = if ($p.noResponse -or $u.noResponse) { 'SILENT' } else { 'RESPONDED' }
    $out.detail = 'greeting: ' + $greet.line + ' || USER->' + $u.line + ' || PASS->' + $p.line
    $out.elapsed = [math]::Round($greet.elapsed + $u.elapsed + $p.elapsed, 1)
  } catch {
    $out.outcome = 'EXCEPTION'
    $out.detail = ($_.Exception.GetType().Name + ': ' + $_.Exception.Message)
  } finally { if ($tcp) { $tcp.Close() } }
  return $out
}

function Test-ImapCmd {
  param([string]$Server, [int]$Port, [string]$Cmd, [double]$TimeoutSec, [string]$Label)
  $out = [PSCustomObject]@{ label = $Label; target = ($Server + ':' + $Port); outcome = ''; detail = ''; elapsed = 0.0 }
  $tcp = $null
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect($Server, $Port)
    $ssl = New-Ssl -tcp $tcp -hostName $Server
    $sr = New-Object System.IO.StreamReader($ssl, [System.Text.Encoding]::ASCII, $true)
    $greet = Read-ImapGreeting -sr $sr
    Send-Cmd -ssl $ssl -cmd $Cmd
    $resp = Read-Resp -sr $sr -tag 'A1' -timeoutSec $TimeoutSec
    $out.outcome = if ($resp.noResponse) { 'SILENT' } else { 'RESPONDED' }
    $out.detail = 'greeting: ' + $greet + ' || resp: ' + $resp.lines
    $out.elapsed = $resp.elapsed
  } catch {
    $out.outcome = 'EXCEPTION'
    $out.detail = ($_.Exception.GetType().Name + ': ' + $_.Exception.Message)
  } finally { if ($tcp) { $tcp.Close() } }
  return $out
}
$wrongPass = 'wrongpass12345'
$results = @(
  (Test-ImapCmd -Server 'imap.gmail.com' -Port 993 -Cmd 'A1 NOOP' -TimeoutSec 10 -Label 'H1 gmail IMAP A1 NOOP'),
  (Test-ImapCmd -Server 'imap.gmail.com' -Port 993 -Cmd 'A1 CAPABILITY' -TimeoutSec 10 -Label 'H2 gmail IMAP A1 CAPABILITY'),
  (Test-ImapCmd -Server 'imap.gmail.com' -Port 993 -Cmd 'A1 LOGIN nameofsewar@gmail.com "kvti mrvs iqmr wufe"' -TimeoutSec 10 -Label 'H3 gmail IMAP well-formed LOGIN (expected silent control)'),
  (Test-ImapCmd -Server 'outlook.office365.com' -Port 993 -Cmd 'A1 NOOP' -TimeoutSec 10 -Label 'H4 outlook IMAP A1 NOOP'),
  (Test-ImapCmd -Server 'outlook.office365.com' -Port 993 -Cmd 'A1 LOGIN doesnotexist-zx91k2@outlook.com "wrongpass12345"' -TimeoutSec 12 -Label 'H5 outlook IMAP well-formed LOGIN (expected silent control)')
)
foreach ($r in $results) {
  Write-Host ('[{0}] {1} -> {2} ({3}s)' -f $r.label, $r.target, $r.outcome, $r.elapsed)
  Write-Host ('    ' + $r.detail)
}
