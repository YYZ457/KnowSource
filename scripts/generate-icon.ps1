# 生成知源应用图标 PNG
$prompt = "A modern app icon for a knowledge graph builder called KnowSource. The icon features an open book at the bottom symbolizing knowledge source, with 5 glowing circular nodes floating above connected by thin lines forming a network graph. Dark navy gradient background deep blue to dark purple, golden amber nodes, cyan connecting lines. Flat design with subtle 3D depth, premium feel similar to VS Code icon. Centered composition, clean, professional, high contrast, minimalist."
$encoded = [System.Uri]::EscapeDataString($prompt)
$url = "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=$encoded&image_size=square_hd"
$out = "C:\Users\YANYZ\Documents\trae_projects\Games\知源-Demo\build\icon.png"

try {
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 120
    $f = Get-Item $out
    Write-Host "SUCCESS: $($f.FullName) ($($f.Length) bytes)"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    exit 1
}
