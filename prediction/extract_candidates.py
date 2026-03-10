import re
import json
from urllib.parse import quote

path = r"C:\Users\Thibault Lechien\Downloads\FBR Slides.html"
html = open(path, encoding="utf-8").read()
base = "https://wwwmpa.mpa-garching.mpg.de/fbrslides/"
re_pat = re.compile(r'<img src="\./FBR Slides_files/([^"]+)"[^>]*>.*?<h3>([^<]*)</h3>')
out = []
for m in re_pat.finditer(html):
    filename, name = m.group(1), m.group(2).strip()
    image_url = base + "FBR%20Slides_files/" + quote(filename, safe="")
    out.append({"id": str(len(out) + 1), "name": name, "imageUrl": image_url})
json_path = r"c:\Users\Thibault Lechien\Documents\GitHub\Personal Website\thibaultLe.github.io\prediction\candidates.json"
open(json_path, "w", encoding="utf-8").write(json.dumps(out, indent=2, ensure_ascii=False))
print(len(out), "candidates written")
