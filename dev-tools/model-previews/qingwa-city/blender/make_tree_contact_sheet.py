from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

review = Path(__file__).resolve().parents[1] / "docs" / "review"
items = [
    ("pine-tree-main.png", "01  PINE"),
    ("cypress-tree-main.png", "02  CYPRESS"),
    ("maple-tree-main.png", "03  RED MAPLE"),
    ("willow-tree-main.png", "04  WILLOW"),
]
tile = 700
label_height = 54
sheet = Image.new("RGB", (tile * 2, (tile + label_height) * 2), (24, 31, 28))
draw = ImageDraw.Draw(sheet)
font = ImageFont.load_default(size=26)
for index, (filename, label) in enumerate(items):
    image = Image.open(review / filename).convert("RGB").resize((tile, tile), Image.Resampling.LANCZOS)
    x = (index % 2) * tile
    y = (index // 2) * (tile + label_height)
    sheet.paste(image, (x, y))
    draw.text((x + 18, y + tile + 12), label, font=font, fill=(220, 226, 213))
output = review / "tree-varieties.png"
sheet.save(output, optimize=True)
print(output, output.stat().st_size)
