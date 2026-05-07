from PIL import Image
import os

path = "src/landing_page/public/logo.png"
if os.path.exists(path):
    img = Image.open(path).convert("RGBA")
    datas = img.getdata()

    newData = []
    for item in datas:
        # Si le pixel est très proche du blanc (r > 240, g > 240, b > 240)
        if item[0] > 240 and item[1] > 240 and item[2] > 240:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)

    img.putdata(newData)
    img.save(path, "PNG")
    print(f"Logo processed and saved to {path}")
else:
    print(f"File {path} not found")
