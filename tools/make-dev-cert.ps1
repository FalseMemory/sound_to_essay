<#
.SYNOPSIS
    生成 / 更新本地自签证书，供手机通过 HTTPS 访问开发服务器（录音需要安全上下文）。

.DESCRIPTION
    为什么需要它：
      浏览器只在 https:// 或 localhost 下暴露麦克风接口。手机用局域网 IP 走 http 访问时
      navigator.mediaDevices 直接不存在，录音功能不可用。

    这个脚本会：
      1. 首次运行时创建一个本地 CA（证书颁发机构）；
      2. 用该 CA 签发服务器证书，SAN 自动包含 localhost、127.0.0.1 与**当前**局域网 IP；
      3. 把 CA 证书复制到 public/ 下，方便手机下载安装。

    重要：**CA 只创建一次，永不重建**。局域网 IP 变了（DHCP 重新分配）只需重跑本脚本重签服务器证书，
    手机**不需要**重新安装 CA。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\tools\make-dev-cert.ps1
#>
[CmdletBinding()]
param()

# 注意：openssl 会把密钥生成进度写到 stderr，PowerShell 会把它当成错误记录。
# 若设为 'Stop'，这些正常输出会被误判为失败并中断脚本。这里改用 'Continue'，
# 每一步显式检查 $LASTEXITCODE 并 throw。
$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root 'certs'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

# --- 找 openssl ---
$opensslCandidates = @(
    (Get-Command openssl -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    'C:\Users\Administrator\.workbuddy\binaries\PortableGit\versions\1.2.0\usr\bin\openssl.exe',
    'C:\Program Files\Git\usr\bin\openssl.exe',
    'C:\Program Files\Git\mingw64\bin\openssl.exe'
) | Where-Object { $_ -and (Test-Path $_) }

if (-not $opensslCandidates) {
    throw "未找到 openssl。请安装 Git for Windows（自带 openssl），或把 openssl 加入 PATH。"
}
$openssl = $opensslCandidates[0]
Write-Host "使用 openssl: $openssl" -ForegroundColor DarkGray

# --- 检测当前局域网 IP（取默认路由所在网卡，排除 WSL/Hyper-V 虚拟网卡）---
$defaultRoute = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric | Select-Object -First 1
$lanIps = @()
if ($defaultRoute) {
    $lanIps = @(
        Get-NetIPAddress -InterfaceIndex $defaultRoute.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty IPAddress
    )
}
if (-not $lanIps) {
    $lanIps = @(
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -ExpandProperty IPAddress
    )
}
if (-not $lanIps) {
    throw "没有检测到局域网 IPv4 地址。请确认已连接 Wi-Fi / 网线。"
}

Write-Host "检测到局域网 IP: $($lanIps -join ', ')" -ForegroundColor Green

# --- 写 SAN 配置 ---
$sanLines = @()
$index = 1
$sanLines += "DNS.1 = localhost"
$sanLines += "IP.1 = 127.0.0.1"
foreach ($ip in $lanIps) {
    $index++
    $sanLines += "IP.$index = $ip"
}

$sanPath = Join-Path $certDir 'san.cnf'
@"
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
CN = $($lanIps[0])

[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
$($sanLines -join "`n")
"@ | Set-Content -Path $sanPath -Encoding ASCII

Push-Location $certDir
try {
    $caCrt = Join-Path $certDir 'ca.crt'
    $caKey = Join-Path $certDir 'ca.key'

    # --- CA：只在缺失时创建，保证手机信任一次即可长期使用 ---
    if (-not (Test-Path $caCrt) -or -not (Test-Path $caKey)) {
        Write-Host "首次运行：创建本地 CA…" -ForegroundColor Yellow
        & $openssl req -x509 -newkey rsa:2048 -nodes -keyout 'ca.key' -out 'ca.crt' -days 3650 `
            -subj '/CN=Sound to Essay Local CA/O=SoundToEssay' 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "创建 CA 失败。" }
    } else {
        Write-Host "复用已有 CA（手机无需重新安装）。" -ForegroundColor Green
    }

    # --- 服务器证书：每次重签，纳入当前 IP ---
    & $openssl req -newkey rsa:2048 -nodes -keyout 'server.key' -out 'server.csr' -config $sanPath 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "生成服务器 CSR 失败。" }

    & $openssl x509 -req -in 'server.csr' -CA 'ca.crt' -CAkey 'ca.key' -CAcreateserial `
        -out 'server.crt' -days 3650 -sha256 -extfile $sanPath -extensions v3_req 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "签发服务器证书失败。" }
} finally {
    Pop-Location
}

# --- 发布 CA 供手机下载 ---
$publicDir = Join-Path $root 'public'
New-Item -ItemType Directory -Force -Path $publicDir | Out-Null
Copy-Item (Join-Path $certDir 'ca.crt') (Join-Path $publicDir 'sound-to-essay-ca.crt') -Force

Write-Host ""
Write-Host "完成。证书 SAN 内容：" -ForegroundColor Green
$san = & $openssl x509 -in (Join-Path $certDir 'server.crt') -noout -text 2>$null |
    Select-String -Pattern 'Subject Alternative Name' -Context 0, 1
$san

Write-Host ""
Write-Host "下一步：" -ForegroundColor Cyan
Write-Host "  1) 启动 HTTPS 开发服务： `$env:VITE_HTTPS='1'; npm run dev"
Write-Host "  2) 手机先访问 http://$($lanIps[0]):57123/sound-to-essay-ca.crt 安装并信任 CA"
Write-Host "     （安装后到 设置 → 通用 → 关于本机 → 证书信任设置 里打开信任开关）"
Write-Host "  3) 手机打开 https://$($lanIps[0]):57124/mobile.html 即可录音"
Write-Host ""
Write-Host "注意：若以后局域网 IP 变化，重跑本脚本即可（CA 不变，手机无需重新安装）。" -ForegroundColor DarkGray
