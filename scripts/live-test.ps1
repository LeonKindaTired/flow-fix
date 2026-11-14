param([Parameter(Mandatory)][string]$ImagePath, [double]$Lat = 45.7489, [double]$Lon = 21.2087)
$url = $env:SUPABASE_URL; $anon = $env:SUPABASE_ANON_KEY
$s = Invoke-RestMethod -Method Post -Uri "$url/auth/v1/signup" -Headers @{ apikey = $anon } -ContentType 'application/json' -Body '{}'
$h = @{ apikey = $anon; Authorization = "Bearer $($s.access_token)" }
$path = "$($s.user.id)/$([guid]::NewGuid()).jpg"
Invoke-RestMethod -Method Post -Uri "$url/storage/v1/object/report-photos/$path" -Headers $h -ContentType 'image/jpeg' -InFile $ImagePath | Out-Null
$body = @{ image_path = $path; latitude = $Lat; longitude = $Lon; location_source = 'gps' } | ConvertTo-Json
try {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Invoke-RestMethod -Method Post -Uri "$url/functions/v1/create-report" -Headers $h -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 6
  "seconds: " + [math]::Round($sw.Elapsed.TotalSeconds, 1)
} catch {
  $r = $_.Exception.Response
  "STATUS: " + [int]$r.StatusCode
  "BODY: " + (New-Object System.IO.StreamReader($r.GetResponseStream())).ReadToEnd()
}