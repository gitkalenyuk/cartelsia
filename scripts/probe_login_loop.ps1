$ErrorActionPreference = 'Stop'
$user = 'nameofsewar@gmail.com'
$pass = '"kvti mrvs iqmr wufe"'
$verdict = 'NONE'
for ($i = 1; $i -le 12; $i++) {
  $tok = '?'
  $tcp = $null
  Write-Host ('attempt {0}: ' -f $i)
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect('imap.gmail.com', 993)
    $tcp.Client.ReceiveTimeout = 8000
    $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, { param($a, $b, $c, $d) $true })
    $ssl.AuthenticateAsClient('imap.gmail.com')
    $sr = New-Object System.IO.StreamReader($ssl, [System.Text.Encoding]::ASCII, $true)
    $greet = ''
    for ($j = 0; $j -lt 5; $j++) { $l = $sr.ReadLine(); if ($null -eq $l) { break }; $greet = $l; if ($l -like '*OK*') { break } }
    $m = [regex]::Match($greet, 'mb\d+[0-9a-f]*$')
    if ($m.Success) { $tok = $m.Value }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $b = [System.Text.Encoding]::ASCII.GetBytes(('A1 LOGIN ' + $user + ' ' + $pass + "
"))
    $ssl.Write($b, 0, $b.Length); $ssl.Flush()
    $line = $sr.ReadLine()
    $untagged = @()
    while ($line -and -not $line.StartsWith('A1')) {
      $u = $line
      if ($u.Length -gt 80) { $u = $u.Substring(0, 80) + '...' }
      $untagged += $u
      $line = $sr.ReadLine()
    }
    $ms = $sw.ElapsedMilliseconds
    Write-Host ('    backend=' + $tok + ' -> ' + $line + ' (responded in ' + $ms + 'ms; untagged: ' + [string]::Join(' | ', $untagged) + ')')
    if ($null -eq $line) { $verdict = 'EOF'; break }
    if ($line -like 'A1 OK*') { $verdict = 'OK-LOGGED-IN'; break }
    if ($line -like 'A1 NO*') { $verdict = 'NO-AUTH-FAILED'; break }
    if ($line -like '*BYE*') { $verdict = 'BYE'; break }
    $verdict = 'OTHER'
    break
  } catch [System.Net.Sockets.SocketException] {
    Write-Host ('    backend=' + $tok + ' -> SILENT (8s)')
  } catch {
    Write-Host ('    backend=' + $tok + ' -> EXCEPTION ' + $_.Exception.Message)
  } finally { if ($tcp) { $tcp.Close() } }
}
Write-Host ('LOOP VERDICT after ' + $i + ' attempt(s): ' + $verdict)
