$ErrorActionPreference = 'Stop'

function Read-RawLine {
  param($stream, [string]$Tag)
  $sb = New-Object System.Text.StringBuilder
  $buf = New-Object byte[] 1
  $bytes = 0
  while ($true) {
    $n = $stream.Read($buf, 0, 1)
    if ($n -eq 0) { Write-Host ('    [{0}] EOF after {1} bytes' -f $Tag, $bytes); return [PSCustomObject]@{ Line = ''; Eof = $true; Bytes = $bytes } }
    $bytes++
    [void]$sb.Append([char]$buf[0])
    if ($buf[0] -eq 10) { break }
    if ($bytes -gt 600) { break }
  }
  return [PSCustomObject]@{ Line = $sb.ToString(); Eof = $false; Bytes = $bytes }
}

function Send-Raw {
  param($stream, [string]$Text)
  $b = [System.Text.Encoding]::ASCII.GetBytes($Text + "
")
  $stream.Write($b, 0, $b.Length)
  $stream.Flush()
  Write-Host ('    sent ' + $b.Length + ' bytes: "' + $Text + '"')
}

function Read-Trace {
  param($stream, [double]$TotalSec, [string]$Tag)
  $t0 = Get-Date
  $got = 0
  while (((Get-Date) - $t0).TotalSeconds -lt $TotalSec) {
    $stream.ReadTimeout = 1000
    $buf = New-Object byte[] 256
    try {
      $n = $stream.Read($buf, 0, 256)
      if ($n -gt 0) {
        $got += $n
        $txt = [System.Text.Encoding]::ASCII.GetString($buf, 0, $n).Replace("", '').Replace("
", '
')
        Write-Host ('    [{0}] +{1:N1}s RX {2}B: "{3}"' -f $Tag, ((Get-Date) - $t0).TotalSeconds, $n, $txt)
      }
    } catch {}
  }
  return $got
}

Write-Host '== P1 gmail:143 PLAINTEXT (no TLS) NOOP =='
$tcp = $null
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect('imap.gmail.com', 143)
  $tcp.Client.ReceiveTimeout = 10000
  $s = $tcp.GetStream()
  $g = Read-RawLine $s 'P1'
  Write-Host ('    greeting ({0}B): {1}' -f $g.Bytes, $g.Line.TrimEnd())
  Send-Raw $s 'A1 NOOP'
  $got = Read-Trace $s 10 'P1'
  Write-Host ('    P1 VERDICT: ' + $(if ($got -gt 0) { 'RESPONSED (' + $got + ' bytes)' } else { 'SILENT (0 bytes in 10s)' }))
} catch { Write-Host ('    P1 EXCEPTION: ' + $_.Exception.Message) }
finally { if ($tcp) { $tcp.Close() } }

Write-Host '== P2 outlook.office365.com:143 PLAINTEXT (no TLS) NOOP =='
$tcp = $null
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect('outlook.office365.com', 143)
  $tcp.Client.ReceiveTimeout = 10000
  $s = $tcp.GetStream()
  $g = Read-RawLine $s 'P2'
  Write-Host ('    greeting ({0}B): {1}' -f $g.Bytes, $g.Line.TrimEnd())
  Send-Raw $s 'A1 NOOP'
  $got = Read-Trace $s 10 'P2'
  Write-Host ('    P2 VERDICT: ' + $(if ($got -gt 0) { 'RESPONSED (' + $got + ' bytes)' } else { 'SILENT (0 bytes in 10s)' }))
} catch { Write-Host ('    P2 EXCEPTION: ' + $_.Exception.Message) }
finally { if ($tcp) { $tcp.Close() } }

Write-Host '== T1 gmail:993 TLS NOOP + certificate identity =='
$tcp = $null
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect('imap.gmail.com', 993)
  $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, { param($a, $b, $c, $d) $true })
  $ssl.AuthenticateAsClient('imap.gmail.com')
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
  Write-Host ('    TLS protocol: ' + $ssl.SslProtocol + ', cipher: ' + $ssl.CipherAlgorithm)
  Write-Host ('    cert SUBJECT : ' + $cert.Subject)
  Write-Host ('    cert ISSUER  : ' + $cert.Issuer)
  Write-Host ('    thumbprint16 : ' + $cert.Thumbprint.Substring(0, 16) + ', validTo: ' + $cert.NotAfter)
  $g = Read-RawLine $ssl 'T1'
  Write-Host ('    greeting ({0}B): {1}' -f $g.Bytes, $g.Line.TrimEnd())
  Send-Raw $ssl 'A1 NOOP'
  $got = Read-Trace $ssl 12 'T1'
  Write-Host ('    T1 VERDICT: ' + $(if ($got -gt 0) { 'RESPONSED (' + $got + ' bytes)' } else { 'SILENT (0 bytes in 12s)' }))
} catch { Write-Host ('    T1 EXCEPTION: ' + $_.Exception.Message) }
finally { if ($tcp) { $tcp.Close() } }

Write-Host '== T3 regular HTTPS control (example.com) =='
try {
  $req = [System.Net.HttpWebRequest]::Create('https://example.com')
  $r = $req.GetResponse()
  Write-Host ('    HTTPS GET status: ' + [int]$r.StatusCode + ' (local TLS/HTTPS path OK)')
  $r.Close()
} catch { Write-Host ('    T3 EXCEPTION: ' + $_.Exception.Message) }

Write-Host '== local network facts =='
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' } | ForEach-Object { Write-Host ('    iface ' + $_.InterfaceAlias + ' ip ' + $_.IPAddress) }
Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Where-Object { $_.NextHop } | ForEach-Object { Write-Host ('    default-gw ' + $_.NextHop) }
