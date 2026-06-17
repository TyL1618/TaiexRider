import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dir, "../public/favicon.svg");
const svg = readFileSync(svgPath);

for (const size of [192, 512]) {
  const outPath = join(__dir, `../public/icon-${size}.png`);
  await sharp(svg).resize(size, size).png().toFile(outPath);
  console.log(`✓ icon-${size}.png`);
}
