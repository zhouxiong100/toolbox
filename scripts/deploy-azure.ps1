param(
    [Parameter(Mandatory = $true, HelpMessage = "存储账户名称，例如 mystoragetools")]
    [string]$StorageAccountName,

    [Parameter(HelpMessage = '目标容器，静态网站固定为 $web')]
    [string]$ContainerName = '$web',

    [Parameter(HelpMessage = "构建输出目录（相对本脚本的上级目录）")]
    [string]$SourceDir = 'out'
)

$ErrorActionPreference = 'Stop'

$outDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' $SourceDir))

if (-not (Test-Path -LiteralPath (Join-Path $outDir 'index.html'))) {
    Write-Error "未找到构建输出目录: $outDir，请先运行: npm run build"
}

Write-Host "==> 检查 Azure CLI" -ForegroundColor Cyan
$null = az version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "未安装 Azure CLI，请先安装: https://aka.ms/installazurecliwindows"
}

Write-Host "==> 检查登录状态" -ForegroundColor Cyan
$null = az account show 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "需要登录 Azure..." -ForegroundColor Yellow
    az login
    if ($LASTEXITCODE -ne 0) {
        Write-Error "登录失败"
    }
}

Write-Host "==> 校验存储账户（需已启用静态网站，角色需为 Storage Blob Data Contributor 以上）" -ForegroundColor Cyan
$endpoint = az storage account show `
    --name $StorageAccountName `
    --query "primaryEndpoints.web" `
    -o tsv 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "无法读取存储账户 $StorageAccountName，请检查账户名与权限。"
}

Write-Host "==> 上传 $outDir -> https://$StorageAccountName.blob.core.windows.net/$ContainerName" -ForegroundColor Cyan
az storage blob sync `
    --account-name $StorageAccountName `
    --auth-mode login `
    --container $ContainerName `
    --source $outDir `
    --delete-destination true

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "部署完成，访问: $endpoint" -ForegroundColor Green
    Write-Host "（若首次部署，请先在 Azure 门户为该存储账户启用“静态网站”，并将错误文档路径设为 404.html）" -ForegroundColor Yellow
} else {
    Write-Error "部署失败，请查看上方错误信息。"
}
