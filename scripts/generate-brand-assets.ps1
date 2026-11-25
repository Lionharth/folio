param()

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$fontDir = Join-Path $root 'node_modules\@expo-google-fonts\cormorant-garamond'
$wordmarkFontPath = Join-Path $fontDir '500Medium\CormorantGaramond_500Medium.ttf'
$imagesDir = Join-Path $root 'assets\images'
$iconPath = Join-Path $imagesDir 'icon.png'

foreach ($path in @($wordmarkFontPath, $iconPath)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Required brand asset not found at $path. Run npm install and keep the serif f icon in assets/images."
  }
}

$ink = [System.Drawing.ColorTranslator]::FromHtml('#171717')
$paper = [System.Drawing.ColorTranslator]::FromHtml('#F5F4F0')
$transparent = [System.Drawing.Color]::Transparent
$white = [System.Drawing.Color]::White

function Open-FontFamily {
  param([Parameter(Mandatory = $true)][string]$Path)

  $collection = [System.Drawing.Text.PrivateFontCollection]::new()
  $collection.AddFontFile($Path)
  $family = $collection.Families[0]
  $style = [System.Drawing.FontStyle]::Regular
  if (-not $family.IsStyleAvailable($style)) {
    foreach ($candidate in @([System.Drawing.FontStyle]::Bold, [System.Drawing.FontStyle]::Italic)) {
      if ($family.IsStyleAvailable($candidate)) {
        $style = $candidate
        break
      }
    }
  }

  return @{ Collection = $collection; Family = $family; Style = $style }
}

function Get-GlyphMask {
  param([Parameter(Mandatory = $true)][string]$Path)

  $loaded = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $rect = [System.Drawing.Rectangle]::new(0, 0, $loaded.Width, $loaded.Height)
    $bitmap = $loaded.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  }
  finally {
    $loaded.Dispose()
  }

  try {
    $data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $stride = $data.Stride
      $bytes = New-Object byte[] ($stride * $bitmap.Height)
      [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    }
    finally {
      $bitmap.UnlockBits($data)
    }
  }
  finally {
    $bitmap.Dispose()
  }

  $backgroundRed = [int]$bytes[2]
  $backgroundGreen = [int]$bytes[1]
  $backgroundBlue = [int]$bytes[0]

  $foregroundRed = $backgroundRed
  $foregroundGreen = $backgroundGreen
  $foregroundBlue = $backgroundBlue
  $bestDistance = -1

  for ($index = 0; $index -lt $bytes.Length; $index += 4) {
    $red = [int]$bytes[$index + 2]
    $green = [int]$bytes[$index + 1]
    $blue = [int]$bytes[$index]
    $distance = [Math]::Pow($red - $backgroundRed, 2) + [Math]::Pow($green - $backgroundGreen, 2) + [Math]::Pow($blue - $backgroundBlue, 2)
    if ($distance -gt $bestDistance) {
      $bestDistance = $distance
      $foregroundRed = $red
      $foregroundGreen = $green
      $foregroundBlue = $blue
    }
  }

  $redRange = [Math]::Abs($foregroundRed - $backgroundRed)
  $greenRange = [Math]::Abs($foregroundGreen - $backgroundGreen)
  $blueRange = [Math]::Abs($foregroundBlue - $backgroundBlue)
  $channelOffset = 2
  $range = $foregroundRed - $backgroundRed
  $backgroundValue = $backgroundRed
  if ($greenRange -gt $redRange -and $greenRange -ge $blueRange) {
    $channelOffset = 1
    $range = $foregroundGreen - $backgroundGreen
    $backgroundValue = $backgroundGreen
  }
  elseif ($blueRange -gt $redRange -and $blueRange -gt $greenRange) {
    $channelOffset = 0
    $range = $foregroundBlue - $backgroundBlue
    $backgroundValue = $backgroundBlue
  }

  if ($range -eq 0) {
    throw "Could not separate the f glyph from the background in $Path."
  }

  $width = $rect.Width
  $height = $rect.Height
  $alpha = New-Object byte[] ($width * $height)
  $minX = $width
  $minY = $height
  $maxX = -1
  $maxY = -1

  for ($y = 0; $y -lt $height; $y++) {
    $row = $y * $stride
    for ($x = 0; $x -lt $width; $x++) {
      $value = ([int]$bytes[$row + (4 * $x) + $channelOffset] - $backgroundValue) / $range
      if ($value -lt 0) { $value = 0 }
      elseif ($value -gt 1) { $value = 1 }

      $alphaByte = [int][Math]::Round($value * 255)
      if ($alphaByte -le 8) { continue }

      $alpha[($y * $width) + $x] = [byte]$alphaByte
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }

  if ($maxX -lt 0) {
    throw "No f glyph pixels found in $Path."
  }

  return @{
    Alpha = $alpha
    Width = $width
    Height = $height
    Bounds = [System.Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
  }
}

function New-ColoredGlyph {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Mask,
    [Parameter(Mandatory = $true)][System.Drawing.Color]$Color
  )

  $bounds = $Mask.Bounds
  $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $rect = [System.Drawing.Rectangle]::new(0, 0, $bounds.Width, $bounds.Height)
  $data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $stride = $data.Stride
    $bytes = New-Object byte[] ($stride * $bounds.Height)
    for ($y = 0; $y -lt $bounds.Height; $y++) {
      $sourceRow = ($bounds.Y + $y) * $Mask.Width
      $targetRow = $y * $stride
      for ($x = 0; $x -lt $bounds.Width; $x++) {
        $alpha = $Mask.Alpha[$sourceRow + $bounds.X + $x]
        if ($alpha -eq 0) { continue }
        $index = $targetRow + (4 * $x)
        $bytes[$index] = $Color.B
        $bytes[$index + 1] = $Color.G
        $bytes[$index + 2] = $Color.R
        $bytes[$index + 3] = $alpha
      }
    }
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  }
  finally {
    $bitmap.UnlockBits($data)
  }

  return $bitmap
}

function Save-GlyphLayer {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Mask,
    [Parameter(Mandatory = $true)][string]$FileName,
    [Parameter(Mandatory = $true)][int]$CanvasSize,
    [Parameter(Mandatory = $true)][double]$TargetHeight,
    [Parameter(Mandatory = $true)][System.Drawing.Color]$Color
  )

  $glyph = New-ColoredGlyph -Mask $Mask -Color $Color
  try {
    $scale = $TargetHeight / $glyph.Height
    $drawWidth = [int][Math]::Round($glyph.Width * $scale)
    $drawHeight = [int][Math]::Round($TargetHeight)
    $destX = [int][Math]::Round(($CanvasSize - $drawWidth) / 2)
    $destY = [int][Math]::Round(($CanvasSize - $drawHeight) / 2)

    $canvas = [System.Drawing.Bitmap]::new($CanvasSize, $CanvasSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($canvas)
      try {
        $graphics.Clear($transparent)
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $destination = [System.Drawing.Rectangle]::new($destX, $destY, $drawWidth, $drawHeight)
        $graphics.DrawImage($glyph, $destination, 0, 0, $glyph.Width, $glyph.Height, [System.Drawing.GraphicsUnit]::Pixel)
      }
      finally {
        $graphics.Dispose()
      }

      $outputPath = Join-Path $imagesDir $FileName
      $canvas.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Host "Wrote $outputPath ($CanvasSize x $CanvasSize)"
    }
    finally {
      $canvas.Dispose()
    }
  }
  finally {
    $glyph.Dispose()
  }
}

function New-WordmarkPath {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Font,
    [Parameter(Mandatory = $true)][string]$Text
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $format = [System.Drawing.StringFormat]::GenericTypographic
  $point = [System.Drawing.PointF]::new(0, 0)
  $path.AddString($Text, $Font.Family, [int]$Font.Style, 1000, $point, $format)
  return $path
}

function Save-Wordmark {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Font,
    [Parameter(Mandatory = $true)][string]$FileName,
    [Parameter(Mandatory = $true)][System.Drawing.Color]$Color,
    [int]$Padding = 8
  )

  $path = New-WordmarkPath -Font $Font -Text 'folio'
  try {
    $bounds = $path.GetBounds()
    if ($bounds.Width -le 0 -or $bounds.Height -le 0) {
      throw 'The wordmark font produced an empty path.'
    }

    $scale = 1000 / $bounds.Width
    $bitmapWidth = [int][Math]::Ceiling($bounds.Width * $scale) + (2 * $Padding)
    $bitmapHeight = [int][Math]::Ceiling($bounds.Height * $scale) + (2 * $Padding)
    $offsetX = $Padding - ($bounds.X * $scale)
    $offsetY = $Padding - ($bounds.Y * $scale)

    $matrix = [System.Drawing.Drawing2D.Matrix]::new()
    try {
      $matrix.Scale([single]$scale, [single]$scale)
      $matrix.Translate([single]$offsetX, [single]$offsetY, [System.Drawing.Drawing2D.MatrixOrder]::Append)
      $path.Transform($matrix)
    }
    finally {
      $matrix.Dispose()
    }

    $bitmap = [System.Drawing.Bitmap]::new($bitmapWidth, $bitmapHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear($transparent)
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

        $brush = [System.Drawing.SolidBrush]::new($Color)
        try {
          $graphics.FillPath($brush, $path)
        }
        finally {
          $brush.Dispose()
        }
      }
      finally {
        $graphics.Dispose()
      }

      $outputPath = Join-Path $imagesDir $FileName
      $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Host "Wrote $outputPath ($bitmapWidth x $bitmapHeight)"
    }
    finally {
      $bitmap.Dispose()
    }
  }
  finally {
    $path.Dispose()
  }
}

$wordmarkFont = Open-FontFamily -Path $wordmarkFontPath
$mask = Get-GlyphMask -Path $iconPath

try {
  Save-GlyphLayer -Mask $mask -FileName 'android-icon-foreground.png' `
    -CanvasSize 1080 -TargetHeight 560 -Color $paper

  Save-GlyphLayer -Mask $mask -FileName 'android-icon-monochrome.png' `
    -CanvasSize 1080 -TargetHeight 560 -Color $white

  Save-Wordmark -Font $wordmarkFont -FileName 'splash-wordmark.png' -Color $ink
  Save-Wordmark -Font $wordmarkFont -FileName 'splash-wordmark-dark.png' -Color $paper
}
finally {
  $wordmarkFont.Collection.Dispose()
}

Write-Host 'Brand assets generated.'
