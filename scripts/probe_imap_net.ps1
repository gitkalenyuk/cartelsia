$ErrorActionPreference = 'Stop'
$c = New-Object System.Net.Sockets.TcpClient
$c.Connect('imap.gmail.com', 993)
$s = New-Object System.Net.Security.SslStream($c.GetStream(), $false, { param($cn,$cert,$chain,$p) $true })
$s.AuthenticateAsClient('imap.gmail.com')
$w = New-Object System.IO.StreamWriter($s, [System.Text.Encoding]::UTF8, 16, $true)
$r = New-Object System.IO.StreamReader($s)
Start-Sleep -Milliseconds 600
Write-Output ('GREET: ' + $r.ReadLine())
$w.WriteLine('A1 LOGIN "nameofsewar@gmail.com" "kvti mrvs iqmr wufe"')
$w.Flush()
Write-Output 'SENT LOGIN'
$deadline = (Get-Date).AddSeconds(12)
while ((Get-Date) -lt $deadline -and -not $s.DataAvailable) { Start-Sleep -Milliseconds 200 }
if ($s.DataAvailable) { while ($s.DataAvailable) { Write-Output ('SRV: ' + $r.ReadLine()) } } else { Write-Output 'NO DATA (12s)' }
$c.Close()