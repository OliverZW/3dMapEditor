"""从 favicon 的几何图形生成 Windows 图标，不需要外部素材。"""
from pathlib import Path
from PIL import Image, ImageDraw

size = 1024
image = Image.new('RGBA', (size, size))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=208, fill='#25423f')
points = [(9, 47), (25, 16), (33, 31), (40, 20), (55, 47), (9, 47)]
draw.line([(x * 16, y * 16) for x, y in points], fill='#c8d6c7', width=56, joint='curve')
draw.line([(18 * 16, 44 * 16), (46 * 16, 44 * 16)], fill='#c8d6c7', width=56)
draw.line([(25 * 16, 16 * 16), (29 * 16, 35 * 16), (36 * 16, 40 * 16)], fill='#c8d6c7', width=56, joint='curve')
image.save(Path(__file__).resolve().parent.parent / 'editor-assets' / 'app.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
