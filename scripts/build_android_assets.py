import os
import subprocess
import shutil
from PIL import Image, ImageDraw

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RES_DIR = os.path.join(ROOT_DIR, "android", "app", "src", "main", "res")
TMP_DIR = os.path.join(ROOT_DIR, "scratch", "icon_build")
os.makedirs(TMP_DIR, exist_ok=True)

EDGE_EXE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

# 1. Full squircle icon SVG
FULL_ICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="512" height="512" fill="none">
  <defs>
    <linearGradient id="qrBg" x1="0" y1="0" x2="256" y2="256" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1e3a8a"/>
      <stop offset="50%" stop-color="#1d4ed8"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <linearGradient id="qrSweep" x1="128" y1="36" x2="210" y2="128" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0"/>
    </linearGradient>
    <filter id="qrShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.4"/>
    </filter>
  </defs>

  <rect x="14" y="14" width="228" height="228" rx="54" fill="url(#qrBg)" filter="url(#qrShadow)"/>
  <rect x="15" y="15" width="226" height="226" rx="53" stroke="#ffffff" stroke-opacity="0.22" stroke-width="3"/>

  <!-- Calendar Tabs -->
  <rect x="78" y="28" width="16" height="26" rx="8" fill="#ffffff" fill-opacity="0.95"/>
  <rect x="162" y="28" width="16" height="26" rx="8" fill="#ffffff" fill-opacity="0.95"/>

  <!-- Radar Rings -->
  <circle cx="128" cy="136" r="76" stroke="#ffffff" stroke-opacity="0.25" stroke-width="5"/>
  <circle cx="128" cy="136" r="50" stroke="#ffffff" stroke-opacity="0.38" stroke-width="4" stroke-dasharray="10 8"/>
  <circle cx="128" cy="136" r="24" stroke="#ffffff" stroke-opacity="0.52" stroke-width="4"/>

  <!-- Radar Sweep -->
  <path d="M128 136 L128 60 A76 76 0 0 1 198 106 Z" fill="url(#qrSweep)"/>
  <line x1="128" y1="136" x2="184" y2="84" stroke="#facc15" stroke-width="6.5" stroke-linecap="round"/>

  <!-- Center Core -->
  <circle cx="128" cy="136" r="10.5" fill="#ffffff"/>
  <circle cx="128" cy="136" r="5" fill="#1d4ed8"/>

  <!-- Exam Blips -->
  <circle cx="174" cy="93" r="9" fill="#facc15"/>
  <circle cx="174" cy="93" r="15" stroke="#facc15" stroke-opacity="0.45" stroke-width="3"/>

  <circle cx="92" cy="112" r="6.5" fill="#34d399"/>
  <circle cx="156" cy="166" r="6.5" fill="#f87171"/>
</svg>"""

# 2. Foreground-only symbol SVG (centered on 108dp canvas for Android adaptive icons)
FOREGROUND_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="864" height="864" fill="none">
  <defs>
    <linearGradient id="qrSweep" x1="128" y1="36" x2="210" y2="128" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#93c5fd" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0"/>
    </linearGradient>
  </defs>

  <g transform="translate(54, 54) scale(0.35) translate(-128, -132)">
    <!-- Calendar Tabs -->
    <rect x="78" y="28" width="16" height="26" rx="8" fill="#ffffff" fill-opacity="0.95"/>
    <rect x="162" y="28" width="16" height="26" rx="8" fill="#ffffff" fill-opacity="0.95"/>

    <!-- Radar Rings -->
    <circle cx="128" cy="136" r="76" stroke="#ffffff" stroke-opacity="0.32" stroke-width="5.5"/>
    <circle cx="128" cy="136" r="50" stroke="#ffffff" stroke-opacity="0.45" stroke-width="4.5" stroke-dasharray="10 8"/>
    <circle cx="128" cy="136" r="24" stroke="#ffffff" stroke-opacity="0.6" stroke-width="4.5"/>

    <!-- Radar Sweep -->
    <path d="M128 136 L128 60 A76 76 0 0 1 198 106 Z" fill="url(#qrSweep)"/>
    <line x1="128" y1="136" x2="184" y2="84" stroke="#facc15" stroke-width="7" stroke-linecap="round"/>

    <!-- Center Core -->
    <circle cx="128" cy="136" r="11" fill="#ffffff"/>
    <circle cx="128" cy="136" r="5.5" fill="#1d4ed8"/>

    <!-- Exam Blips -->
    <circle cx="174" cy="93" r="9.5" fill="#facc15"/>
    <circle cx="174" cy="93" r="15.5" stroke="#facc15" stroke-opacity="0.5" stroke-width="3"/>

    <circle cx="92" cy="112" r="7" fill="#34d399"/>
    <circle cx="156" cy="166" r="7" fill="#f87171"/>
  </g>
</svg>"""

def render_svg_to_png(svg_str, output_png, width, height):
    tmp_svg_path = os.path.join(TMP_DIR, "temp_render.svg")
    tmp_html_path = os.path.join(TMP_DIR, "temp_render.html")
    
    html_content = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {{
    margin: 0;
    padding: 0;
    width: {width}px;
    height: {height}px;
    background: transparent !important;
    overflow: hidden;
  }}
  svg {{
    display: block;
    width: {width}px;
    height: {height}px;
  }}
</style>
</head>
<body>
{svg_str}
</body>
</html>"""
    
    with open(tmp_html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
        
    cmd = [
        EDGE_EXE,
        "--headless",
        "--disable-gpu",
        "--default-background-color=00000000",
        f"--window-size={width},{height}",
        f"--screenshot={output_png}",
        f"file:///{tmp_html_path.replace(os.sep, '/')}"
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    print(f"Rendered: {output_png} ({width}x{height})")

def make_round(img):
    size = img.size
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size[0], size[1]), fill=255)
    result = img.copy()
    result.putalpha(Image.composite(result.split()[3], mask, mask))
    return result

def main():
    print("=== Generating Android Adaptive & Legacy Icons ===")
    
    full_png = os.path.join(TMP_DIR, "full_icon_512.png")
    render_svg_to_png(FULL_ICON_SVG, full_png, 512, 512)
    
    fg_png = os.path.join(TMP_DIR, "foreground_864.png")
    render_svg_to_png(FOREGROUND_SVG, fg_png, 864, 864)
    
    full_img = Image.open(full_png).convert("RGBA")
    fg_img = Image.open(fg_png).convert("RGBA")
    
    # Mipmap configurations: (folder, launcher_size, foreground_size)
    mipmaps = [
        ("mipmap-mdpi", 48, 108),
        ("mipmap-hdpi", 72, 162),
        ("mipmap-xhdpi", 96, 216),
        ("mipmap-xxhdpi", 144, 324),
        ("mipmap-xxxhdpi", 192, 432),
    ]
    
    for folder, l_size, fg_size in mipmaps:
        dir_path = os.path.join(RES_DIR, folder)
        os.makedirs(dir_path, exist_ok=True)
        
        # 1. ic_launcher.png
        l_img = full_img.resize((l_size, l_size), Image.Resampling.LANCZOS)
        l_img.save(os.path.join(dir_path, "ic_launcher.png"), "PNG")
        
        # 2. ic_launcher_round.png
        r_img = make_round(l_img)
        r_img.save(os.path.join(dir_path, "ic_launcher_round.png"), "PNG")
        
        # 3. ic_launcher_foreground.png
        fg_resized = fg_img.resize((fg_size, fg_size), Image.Resampling.LANCZOS)
        fg_resized.save(os.path.join(dir_path, "ic_launcher_foreground.png"), "PNG")
        
        print(f"Updated {folder}: launcher {l_size}x{l_size}, foreground {fg_size}x{fg_size}")
        
    # Update adaptive icon background drawable & color
    bg_xml_path = os.path.join(RES_DIR, "drawable", "ic_launcher_background.xml")
    os.makedirs(os.path.dirname(bg_xml_path), exist_ok=True)
    with open(bg_xml_path, "w", encoding="utf-8") as f:
        f.write("""<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <gradient
        android:angle="315"
        android:startColor="#1e3a8a"
        android:centerColor="#1d4ed8"
        android:endColor="#2563eb"
        android:type="linear" />
</shape>
""")
        
    color_xml_path = os.path.join(RES_DIR, "values", "ic_launcher_background.xml")
    with open(color_xml_path, "w", encoding="utf-8") as f:
        f.write("""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#1d4ed8</color>
</resources>
""")
        
    # Ensure mipmap-anydpi-v26 files point to proper drawables
    anydpi_dir = os.path.join(RES_DIR, "mipmap-anydpi-v26")
    os.makedirs(anydpi_dir, exist_ok=True)
    
    with open(os.path.join(anydpi_dir, "ic_launcher.xml"), "w", encoding="utf-8") as f:
        f.write("""<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
""")
        
    with open(os.path.join(anydpi_dir, "ic_launcher_round.xml"), "w", encoding="utf-8") as f:
        f.write("""<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
""")

    # 4. Generate splash screens
    print("\n=== Generating Splash Screens ===")
    splash_configs = [
        ("drawable", 480, 800),
        ("drawable-land-mdpi", 480, 320),
        ("drawable-land-hdpi", 800, 480),
        ("drawable-land-xhdpi", 1280, 720),
        ("drawable-land-xxhdpi", 1600, 960),
        ("drawable-land-xxxhdpi", 1920, 1080),
        ("drawable-port-mdpi", 320, 480),
        ("drawable-port-hdpi", 480, 800),
        ("drawable-port-xhdpi", 720, 1280),
        ("drawable-port-xxhdpi", 960, 1600),
        ("drawable-port-xxxhdpi", 1080, 1920),
    ]
    
    for s_folder, sw, sh in splash_configs:
        s_dir = os.path.join(RES_DIR, s_folder)
        os.makedirs(s_dir, exist_ok=True)
        
        # Dark navy background (#0f172a)
        splash_bg = Image.new("RGBA", (sw, sh), (15, 23, 42, 255))
        
        # Scale icon to ~22% of min dimension
        min_dim = min(sw, sh)
        icon_dim = max(64, int(min_dim * 0.28))
        scaled_icon = full_img.resize((icon_dim, icon_dim), Image.Resampling.LANCZOS)
        
        # Center the icon
        pos_x = (sw - icon_dim) // 2
        pos_y = (sh - icon_dim) // 2
        
        splash_bg.paste(scaled_icon, (pos_x, pos_y), scaled_icon)
        splash_bg.save(os.path.join(s_dir, "splash.png"), "PNG")
        print(f"Generated splash: {s_folder}/splash.png ({sw}x{sh})")

    print("\nAll Android icons and splash assets successfully generated!")

if __name__ == "__main__":
    main()
