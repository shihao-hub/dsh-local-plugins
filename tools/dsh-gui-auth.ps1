<#
.SYNOPSIS
    Mint a valid browser-session cookie for the dsh web GUI without restarting it.

.DESCRIPTION
    `dsh web` authenticates browsers with a launch token that is exchanged for an
    HttpOnly cookie. The launch token is per-process and only ever printed to the
    service stdout, so it is unrecoverable for an already-running process. The
    cookie value however is an HMAC over a payload, keyed by a secret that is
    PERSISTED in ~/.dsh/.credentials.yaml under client-connection/browser-session,
    with a default lifetime of 30 days (cookieMaxAgeDays).

    Because that secret survives restarts, the cookie can be re-derived offline at
    any time. This script computes it, proves it against the live service, and
    writes it to a temp file for browser injection. The cookie value is never
    printed to the console.

    Recommended hand-off: give the -OutFile path to chrome-devtools `upload_file`
    on the page, let page JS assign `document.cookie`, then delete the file.

    NOTE: keep this file ASCII-only. Windows PowerShell 5.1 parses .ps1 as ANSI
    (GBK here) and multi-byte Chinese text can swallow string terminators.

.PARAMETER Authority
    Cookie audience; must match the browser address bar exactly. Default 127.0.0.1:11111.

.PARAMETER OutFile
    Where to write the cookie. Default %TEMP%\dsh-gui-cookie.txt. Delete after use.

.PARAMETER Verify
    Only verify authentication (print the HTTP status), write nothing.

.EXAMPLE
    .\dsh-gui-auth.ps1 -Verify
    .\dsh-gui-auth.ps1 -OutFile "$env:TEMP\dsh-gui-cookie.txt"
#>
[CmdletBinding()]
param(
    [string]$Authority = '127.0.0.1:11111',
    [string]$OutFile = (Join-Path $env:TEMP 'dsh-gui-cookie.txt'),
    [switch]$Verify
)

$ErrorActionPreference = 'Stop'

function ConvertTo-B64Url([byte[]]$Bytes) {
    [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-BrowserSecret {
    param([string]$CredentialsPath)

    $lines = Get-Content -LiteralPath $CredentialsPath -Encoding UTF8
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\s*client-connection/browser-session:\s*$') {
            for ($j = $i + 1; $j -lt [Math]::Min($i + 10, $lines.Count); $j++) {
                if ($lines[$j] -match '^\s*secret:\s*(\S+)\s*$') { return $Matches[1] }
            }
        }
    }
    throw "No client-connection/browser-session secret found in $CredentialsPath"
}

function New-SessionCookie {
    param([string]$SecretB64, [string]$Audience, [int]$ValidDays = 29)

    $padded = $SecretB64.Replace('-', '+').Replace('_', '/')
    switch ($padded.Length % 4) { 2 { $padded += '==' } 3 { $padded += '=' } }
    $secret = [Convert]::FromBase64String($padded)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $name = 'dsh-auth-' + (ConvertTo-B64Url ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Audience))))
    } finally { $sha.Dispose() }

    $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $payload = [ordered]@{
        version   = 1
        authority = $Audience
        issuedAt  = $now
        expiresAt = $now + $ValidDays * 86400000L
    } | ConvertTo-Json -Compress

    $body = ConvertTo-B64Url ([Text.Encoding]::UTF8.GetBytes($payload))
    $hmac = [System.Security.Cryptography.HMACSHA256]::new($secret)
    try {
        $sig = ConvertTo-B64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)))
    } finally { $hmac.Dispose() }

    return "$name=v1.$body.$sig"
}

function Test-SessionCookie {
    param([string]$Cookie, [string]$Audience)

    $req = [System.Net.HttpWebRequest]::Create("http://$Audience/")
    $req.Method = 'GET'
    $req.AllowAutoRedirect = $false
    $req.Timeout = 5000
    $req.Headers.Add('Cookie', $Cookie)
    try {
        $resp = $req.GetResponse()
        try { return [int]$resp.StatusCode } finally { $resp.Close() }
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            try { return [int]$_.Exception.Response.StatusCode } finally { $_.Exception.Response.Close() }
        }
        throw
    }
}

$credentials = Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'
if (-not (Test-Path -LiteralPath $credentials)) { throw "Credentials not found: $credentials" }

$cookie = New-SessionCookie -SecretB64 (Get-BrowserSecret -CredentialsPath $credentials) -Audience $Authority
$status = Test-SessionCookie -Cookie $cookie -Audience $Authority

if ($status -eq 401) {
    throw "Derived cookie rejected (401). The secret may have been re-issued; restart dsh web or check $credentials."
}

if ($Verify) {
    [pscustomobject]@{
        authority = $Authority
        status    = $status
        verified  = ($status -ne 401)
    } | Format-List
    return
}

$bytes = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($OutFile, $cookie, $bytes)

[pscustomobject]@{
    authority  = $Authority
    status     = $status
    cookieFile = $OutFile
    cookieSize = $cookie.Length
} | Format-List
