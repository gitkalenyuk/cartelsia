param([string]$PW, [int]$Max)
$ErrorActionPreference = 'Stop'
$ok = 0; $no = 0; $silent = 0
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
      Write-Host ('probe {0}: backend={1} SILENT (noop no response)' -f $i, $tok)
      $silent++
      continue
    }
    & $send ('A2 LOGIN nameofsewar@gmail.com ' + $PW)
    $line = $sr.ReadLine()
    while ($line -and -not $line.StartsWith('A2')) { $line = $sr.ReadLine() }
    if ($line -like 'A2 OK*') { $ok++; Write-Host ('probe {0}: backend={1} LOGIN OK (live)' -f $i, $tok) }
    else { $no++; Write-Host ('probe {0}: backend={1} LOGIN -> {2} (live but rejected?)' -f $i, $tok, $line) }
  } catch [System.Net.Sockets.SocketException] {
    $silent++
    Write-Host ('probe {0}: backend={1} SILENT (exception)' -f $i, $tok)
  } catch {
    $silent++
    Write-Host ('probe {0}: backend={1} EXCEPTION' -f $i, $tok)
  } finally { if ($tcp) { $tcp.Close() } }
}
Write-Host ('SUMMARY: live={0}/{1} silent={2} loginOK={3} loginOther={4}' -f ($ok + $no), $Max, $silent, $ok, $no)
