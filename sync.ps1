param(
    [string]$Message = "Update website content and styles"
)

$gitPath = "$env:LOCALAPPDATA\Programs\Git\cmd"
$ghPath = "$env:LOCALAPPDATA\Programs\gh"
$env:Path = "$gitPath;$ghPath;$env:Path"

Write-Host ">>> Checking Git status..." -ForegroundColor Cyan
git status --short

Write-Host ">>> Staging all changes..." -ForegroundColor Cyan
git add .

$status = git status --porcelain
if (-not $status) {
    Write-Host ">>> No changes detected to commit." -ForegroundColor Yellow
    exit 0
}

Write-Host ">>> Committing: $Message" -ForegroundColor Cyan
git commit -m $Message

Write-Host ">>> Pushing to GitHub (origin/main)..." -ForegroundColor Cyan
git push origin main

Write-Host ">>> Successfully pushed to GitHub!" -ForegroundColor Green
Write-Host ">>> Netlify will automatically detect the commit and deploy live." -ForegroundColor Green
