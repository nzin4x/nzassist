# Deploy nzassist backend as a Lambda Function URL. No API Gateway (see TODO.md D14) --
# a single personal endpoint doesn't need REST resources/stages/mappings.
#
# Usage:
#   node scripts/build-lambda.mjs
#   powershell -File scripts/deploy-lambda.ps1 -CorsOrigin "https://nzassist.pages.dev"
#
# First run creates an IAM role, the Lambda function, and its Function URL.
# Later runs just update code/config (idempotent).
#
# Native exes (aws.exe) ignore $ErrorActionPreference, so existence checks use
# $LASTEXITCODE instead. stderr is not redirected -- "not found" style messages on
# first run are expected and harmless.

param(
  [string]$FunctionName = "nzassist-api",
  [string]$RoleName = "nzassist-lambda-role",
  [string]$EnvFile = ".env",
  [string]$CorsOrigin = "*"
)

if (-not (Test-Path "dist/lambda/index.mjs")) {
  Write-Error "dist/lambda is missing. Run first: node scripts/build-lambda.mjs"
  exit 1
}

# --- parse .env ---
$envVars = @{}
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $k, $v = $_ -split '=', 2
    $envVars[$k.Trim()] = $v.Trim()
  }
}
foreach ($k in @('GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN')) {
  if (-not $envVars[$k]) { Write-Error "$EnvFile is missing $k"; exit 1 }
}
if (-not $envVars['API_TOKEN']) {
  Write-Output "API_TOKEN not found in .env -- generating a new one. Put this same value in public/config.js too."
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $envVars['API_TOKEN'] = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').Replace('=', '')
  Add-Content $EnvFile "API_TOKEN=$($envVars['API_TOKEN'])"
}

$lambdaEnv = @{
  GOOGLE_OAUTH_CLIENT_ID     = $envVars['GOOGLE_OAUTH_CLIENT_ID']
  GOOGLE_OAUTH_CLIENT_SECRET = $envVars['GOOGLE_OAUTH_CLIENT_SECRET']
  GOOGLE_OAUTH_REFRESH_TOKEN = $envVars['GOOGLE_OAUTH_REFRESH_TOKEN']
  API_TOKEN                  = $envVars['API_TOKEN']
  DEFAULT_TZ                 = $(if ($envVars['DEFAULT_TZ']) { $envVars['DEFAULT_TZ'] } else { 'Asia/Seoul' })
  DEFAULT_DUE_TIME           = $(if ($envVars['DEFAULT_DUE_TIME']) { $envVars['DEFAULT_DUE_TIME'] } else { '09:00' })
}
$envJsonPath = "dist/lambda-env.json"
@{ Variables = $lambdaEnv } | ConvertTo-Json -Depth 5 | Set-Content -Encoding ascii $envJsonPath

# --- zip ---
$zipPath = "dist/lambda.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "dist/lambda/*" -DestinationPath $zipPath
Write-Output "Created zip: $zipPath"

# --- IAM role (create if missing) ---
$roleArn = aws iam get-role --role-name $RoleName --query "Role.Arn" --output text
$roleExists = ($LASTEXITCODE -eq 0)
if (-not $roleExists) {
  Write-Output "Creating IAM role: $RoleName"
  $trustPath = "dist/trust-policy.json"
  Set-Content -Encoding ascii $trustPath '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  $roleArn = aws iam create-role --role-name $RoleName --assume-role-policy-document "file://$trustPath" --query "Role.Arn" --output text
  aws iam attach-role-policy --role-name $RoleName --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" | Out-Null
  Write-Output "Waiting for role propagation (10s)..."
  Start-Sleep -Seconds 10
} else {
  Write-Output "Reusing existing IAM role: $roleArn"
}

# --- Lambda function (update if exists, create otherwise) ---
aws lambda get-function --function-name $FunctionName | Out-Null
$functionExists = ($LASTEXITCODE -eq 0)

if ($functionExists) {
  Write-Output "Updating existing function: $FunctionName"
  aws lambda update-function-code --function-name $FunctionName --zip-file "fileb://$zipPath" | Out-Null
  Start-Sleep -Seconds 3
  aws lambda update-function-configuration --function-name $FunctionName --environment "file://$envJsonPath" --timeout 15 --runtime nodejs22.x | Out-Null
} else {
  Write-Output "Creating new function: $FunctionName"
  aws lambda create-function `
    --function-name $FunctionName `
    --runtime nodejs22.x `
    --role $roleArn `
    --handler index.handler `
    --zip-file "fileb://$zipPath" `
    --timeout 15 `
    --environment "file://$envJsonPath" | Out-Null
}

# --- Function URL (create if missing, else just refresh CORS) ---
$corsPath = "dist/cors.json"
@{ AllowOrigins = @($CorsOrigin); AllowMethods = @("*"); AllowHeaders = @("content-type", "authorization") } |
  ConvertTo-Json -Compress | Set-Content -Encoding ascii $corsPath

$functionUrl = aws lambda get-function-url-config --function-name $FunctionName --query "FunctionUrl" --output text
$urlExists = ($LASTEXITCODE -eq 0)

if (-not $urlExists) {
  Write-Output "Creating Function URL"
  $functionUrl = aws lambda create-function-url-config --function-name $FunctionName --auth-type NONE --cors "file://$corsPath" --query "FunctionUrl" --output text
  aws lambda add-permission `
    --function-name $FunctionName `
    --statement-id FunctionURLAllowPublicAccess `
    --action lambda:InvokeFunctionUrl `
    --principal "*" `
    --function-url-auth-type NONE | Out-Null
} else {
  Write-Output "Updating CORS on existing Function URL (origin: $CorsOrigin)"
  aws lambda update-function-url-config --function-name $FunctionName --cors "file://$corsPath" | Out-Null
}

Write-Output ""
Write-Output "Done."
Write-Output "Function URL : $functionUrl"
Write-Output "API_TOKEN    : $($lambdaEnv.API_TOKEN)"
Write-Output ""
Write-Output "Set these in public/config.js (or as Cloudflare Pages env vars API_BASE_URL / API_TOKEN):"
Write-Output "  API_BASE_URL = $functionUrl"
Write-Output "  API_TOKEN    = $($lambdaEnv.API_TOKEN)"
