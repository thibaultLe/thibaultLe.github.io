const fs = require('fs');
const path = require('path');
const htmlPath = path.join(process.env.USERPROFILE || '', 'Downloads', 'FBR Slides.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const base = 'https://wwwmpa.mpa-garching.mpg.de/fbrslides/';
const re = /<img src="\.\/FBR Slides_files\/([^"]+)"[^>]*>.*?<h3>([^<]*)<\/h3>/g;
const out = [];
let m;
while ((m = re.exec(html)) !== null) {
  const filename = m[1];
  const name = m[2].trim();
  const imageUrl = base + 'FBR%20Slides_files/' + encodeURIComponent(filename);
  out.push({ id: String(out.length + 1), name, imageUrl });
}
fs.writeFileSync(path.join(__dirname, 'candidates.json'), JSON.stringify(out, null, 2));
console.log('Extracted', out.length, 'candidates to candidates.json');
