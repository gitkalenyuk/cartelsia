$ErrorActionPreference = 'Stop'
$user = 'nameofsewar@gmail.com'
$pass = '"kvti mrvs iqmr wufe"'
$verdict = 'NONE'
for ($i = 1; $i -le 15; $i++) {
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
      Write-Host ('probe {0}: backend={1} NOOP no-go ({2})' -f $i, $tok, $line)
      continue
    }
    & $send ('A2 LOGIN ' + $user + ' ' + $pass)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $line = $sr.ReadLine()
    $untagged = @()
    while ($line -and -not $line.StartsWith('A2')) {
      $u = $line
      if ($u.Length -gt 70) { $u = $u.Substring(0, 70) + '...' }
      $untagged += $u
      $line = $sr.ReadLine()
    }
    $ms = $sw.ElapsedMilliseconds
    Write-Host ('probe {0}: backend={1} LOGIN -> ' -f $i, $tok)
    Write-Host ('    tagged: ' + $line + ' (in ' + $ms + 'ms)')
    if ($untagged.Count -gt 0) { Write-Host ('    untagged: ' + ([string]::Join(' | ', $untagged))) }
    if ($line -like 'A2 OK*') { $verdict = 'OK-LOGGED-IN'; break }
    if ($line -like 'A2 NO*') { $verdict = 'NO-AUTH-FAILED'; break }
    if ($line -like '*BYE*') { $verdict = 'BYE-CLOSED'; break }
    $verdict = 'OTHER'
    break
  } catch [System.Net.Sockets.SocketException] {
    Write-Host ('probe {0}: backend={1} SILENT' -f $i, $tok)
  } catch {
    Write-Host ('probe {0}: backend={1} EXCEPTION {2}' -f $i, $tok, $_.Exception.Message)
  } finally { if ($tcp) { $tcp.Close() } }
}
Write-Host ('FINAL VERDICT after ' + $i + ' probes: ' + $verdict)
