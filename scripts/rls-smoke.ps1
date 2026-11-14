$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_URL)) {
    throw 'Set SUPABASE_URL before running this check.'
}
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_ANON_KEY)) {
    throw 'Set SUPABASE_ANON_KEY before running this check.'
}

$headers = @{
    apikey = $env:SUPABASE_ANON_KEY
    Authorization = "Bearer $($env:SUPABASE_ANON_KEY)"
}

function Invoke-CheckedRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [ValidateSet('Get', 'Post')][string]$Method = 'Get',
        [string]$Body
    )
    try {
        $request = @{
            UseBasicParsing = $true
            Uri = $Uri
            Headers = $headers
            Method = $Method
        }
        if ($PSBoundParameters.ContainsKey('Body')) {
            $request.Body = $Body
            $request.ContentType = 'application/json'
        }
        $response = Invoke-WebRequest @request
        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            Body = [string]$response.Content
        }
    }
    catch {
        $response = $_.Exception.Response
        if ($null -eq $response) { throw }
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            Body = $body
        }
    }
}

foreach ($table in @('reports', 'report_confirmations', 'geocode_cache')) {
    $result = Invoke-CheckedRequest -Uri "$($env:SUPABASE_URL)/rest/v1/$table`?select=*`&limit=1"
    if (($result.Body -ne '[]') -and ($result.Body -notmatch '"code"')) {
        throw "FAIL: anon can read $table"
    }
    Write-Output "ok: anon blocked on $table"
}

foreach ($column in @('image_path', 'reporter_id', 'processing_error', 'confidence')) {
    $result = Invoke-CheckedRequest -Uri "$($env:SUPABASE_URL)/rest/v1/public_reports`?select=$column`&limit=1"
    if ($result.Body -notmatch '"code"') {
        throw "FAIL: public_reports exposes $column"
    }
    Write-Output "ok: public_reports has no $column"
}

$duplicates = Invoke-CheckedRequest -Uri "$($env:SUPABASE_URL)/rest/v1/public_reports`?select=id`&status=eq.duplicate`&limit=1"
if ($duplicates.Body -ne '[]') {
    throw 'FAIL: duplicates visible in public_reports'
}
Write-Output 'ok: public_reports readable, no duplicates'

$rpcCalls = @(
    @{
        Name = 'find_nearby_report'
        Body = '{"p_lat":45,"p_lon":25,"p_radius_m":20,"p_damage_type":"pothole","p_exclude_id":null}'
    },
    @{
        Name = 'add_report_corroboration'
        Body = '{"p_original_report_id":"00000000-0000-0000-0000-000000000001","p_corroborating_report_id":"00000000-0000-0000-0000-000000000002","p_reporter_id":"00000000-0000-0000-0000-000000000002"}'
    }
)
foreach ($rpc in $rpcCalls) {
    $result = Invoke-CheckedRequest -Uri "$($env:SUPABASE_URL)/rest/v1/rpc/$($rpc.Name)" -Method Post -Body $rpc.Body
    if (($result.StatusCode -ge 200) -and ($result.StatusCode -lt 300)) {
        throw "FAIL: anon RPC call succeeded for $($rpc.Name)"
    }
    if ($result.Body -notmatch '"code"') {
        throw "FAIL: anon RPC call did not return a permission error for $($rpc.Name)"
    }
    Write-Output "ok: anon blocked from RPC $($rpc.Name)"
}

Write-Output 'manual: verify anonymous sign-in, select-own reports, cross-user denial, and storage folder isolation with two sessions'

