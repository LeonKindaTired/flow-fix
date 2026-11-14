param([Parameter(Mandatory = $true)][string]$ImagePath)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_URL) -or [string]::IsNullOrWhiteSpace($env:SUPABASE_ANON_KEY)) { throw 'Set SUPABASE_URL and SUPABASE_ANON_KEY before running this check.' }

function Request($method, $uri, $headers, $body = $null, $contentType = 'application/json') {
    try {
        $args = @{ UseBasicParsing = $true; Method = $method; Uri = $uri; Headers = $headers }
        if ($null -ne $body) { $args.Body = $body; $args.ContentType = $contentType }
        $response = Invoke-WebRequest @args
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = [string]$response.Content }
    } catch {
        if ($null -eq $_.Exception.Response) { throw }
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        try { $bodyText = $reader.ReadToEnd() } finally { $reader.Dispose() }
        return [pscustomobject]@{ Status = [int]$_.Exception.Response.StatusCode; Body = $bodyText }
    }
}

function Session {
    $result = Request 'Post' "$($env:SUPABASE_URL)/auth/v1/signup" @{ apikey = $env:SUPABASE_ANON_KEY } '{}'
    if ($result.Status -lt 200 -or $result.Status -ge 300) { throw 'anonymous signup failed' }
    $auth = $result.Body | ConvertFrom-Json
    return [pscustomobject]@{ UserId = [string]$auth.user.id; Headers = @{ apikey = $env:SUPABASE_ANON_KEY; Authorization = "Bearer $($auth.access_token)" } }
}

function Check($name, [scriptblock]$test) {
    try { if (& $test) { "ok: $name"; return $true } } catch { }
    "FAIL: $name"
    return $false
}

$a = Session
$b = Session
$path = "$($a.UserId)/$([guid]::NewGuid()).jpg"
$upload = Request 'Post' "$($env:SUPABASE_URL)/storage/v1/object/report-photos/$path" $a.Headers ([System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $ImagePath))) 'image/jpeg'
$bUpload = Check 'B cannot upload into A folder' { (Request 'Post' "$($env:SUPABASE_URL)/storage/v1/object/report-photos/$path" $b.Headers ([System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $ImagePath))) 'image/jpeg').Status -ge 400 }
$bRead = Check 'B cannot read A photo' { (Request 'Get' "$($env:SUPABASE_URL)/storage/v1/object/report-photos/$path" $b.Headers).Status -ge 400 }
$payload = @{ image_path = $path; latitude = 45.747285; longitude = 21.235311; location_source = 'gps' } | ConvertTo-Json -Compress
$created = Request 'Post' "$($env:SUPABASE_URL)/functions/v1/create-report" $a.Headers $payload
$reportId = $null
try { $reportId = [string](($created.Body | ConvertFrom-Json).report_id) } catch { }
$createOk = Check 'create-report works for A' { $created.Status -ge 200 -and $created.Status -lt 300 -and -not [string]::IsNullOrWhiteSpace($reportId) }
$own = Request 'Get' "$($env:SUPABASE_URL)/rest/v1/reports?select=id&reporter_id=eq.$($a.UserId)" $a.Headers
$aOwn = Check 'A sees its own report' { $own.Status -eq 200 -and $own.Body -ne '[]' }
$fresh = Request 'Get' "$($env:SUPABASE_URL)/rest/v1/reports?select=id&reporter_id=eq.$($a.UserId)" $b.Headers
$bNone = Check 'fresh B sees none of A reports' { $fresh.Status -eq 200 -and $fresh.Body -eq '[]' }
$insert = Request 'Post' "$($env:SUPABASE_URL)/rest/v1/reports" $a.Headers '{"status":"processing"}'
$aInsert = Check 'A cannot insert into reports' { $insert.Status -ge 400 }
$delete = Request 'Delete' "$($env:SUPABASE_URL)/rest/v1/reports?id=eq.$reportId" $a.Headers
$aDelete = Check 'A cannot delete from reports' { $delete.Status -ge 400 }

if (-not ($bUpload -and $bRead -and $createOk -and $aOwn -and $bNone -and $aInsert -and $aDelete)) { exit 1 }
