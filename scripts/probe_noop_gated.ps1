param([string]$Pass, [int]$Max)
$ErrorActionPreference = 'Stop'
$verdict = 'NONE'
for ($i = 1; $i -le $Max; $i++) {
  $tok = '?'; $tcp = $null
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect('imap.gmail.com', 993)
    $tcp.Client.ReceiveTimeout = 6000
    $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, { param($a, $b, $c, $d) $true })
    $ssl.AuthenticateAsClient('imap.gmail.com')
    $sr = New-Object System.IO.StreamReader($ssl, [System.Text.Encoding]::ASCII, $true)
    $greet = ''
    for ($j = 0; $j -lt 5; $j++) { $l = $sr.ReadLine(); if ($null -eq $l) { break }; $greet = $l; if ($l -like '*OK*') { break } }
    $m = [regex]::Match($greet, 'mb\d+[0-9a-f]*$')
    if ($m.Success) { $tok = $m.Value }
    $send = { param($cmd) $b = [System.Text.Encoding]::ASCII.GetBytes($cmd + "
"); $ssl.Write($b, 0, $b.Length); $ssl.Flush() }
    & $send 'A1 NOOP'
    $line = $sr.ReadLine()
    while ($line -and -not $line.StartsWith('A1')) { $line = $sr.ReadLine() }
    if ($null -eq $line -or $line -notlike 'A1 OK*') {
      Write-Host ('probe {0}: backend={1} SILENT' -f $i, $tok)
      continue
    }
    & $send ('A2 LOGIN nameofsewar@gmail.com ' + $Pass)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $line = $sr.ReadLine()
    while ($line -and -not $line.StartsWith('A2')) { $line = $sr.ReadLine() }
    Write-Host ('probe {0}: backend={1} -> {2} (in {3}ms)' -f $i, $tok, $line, $sw.ElapsedMilliseconds)
    if ($line -like 'A2 OK*') { $verdict = 'OK-LOGGED-IN'; break }
    if ($line -like 'A2 NO*') { $verdict = 'NO-AUTH-FAILED'; break }
    if ($null -eq $line) { $verdict = 'EOF'; break }
    $verdict = 'OTHER'; break
  } catch {
    Write-Host ('probe {0}: backend={1} SILENT ({2})' -f $i, $tok, $_.Exception.GetType().Name)
  } finally { if ($tcp) { $tcp.Close() } }
}
Write-Host ('FINAL: ' + $verdict + ' after ' + $i + ' probes')
