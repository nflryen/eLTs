// Only optimized public demonstration assets. Never place customer media here.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const assets = [
  ["hero", "1606216794050-6ff7db8cb43d", 1920],
  ["bride", "1571984128445-91f01fd094ae", 900],
  ["hands", "1495609000883-209fc68187ef", 700],
  ["wedding", "1606216794079-73f85bbd57d5", 1200],
  ["prewedding", "1563808599481-34a342e44508", 1400],
  ["graduation", "1632761637833-b8be546ff075", 700],
  ["couple", "1591969851586-adbbd4accf81", 900],
  ["event", "1527529482837-4698179dc6ce", 900],
  ["hillside", "1532712938310-34cb3982ef74", 1600],
];
const target = path.resolve("public/images");
await mkdir(target, { recursive: true });
for (const [name, id, width] of assets) {
  const response = await fetch(
    `https://images.unsplash.com/photo-${id}?auto=format&fm=webp&fit=max&w=${width}&q=82`,
  );
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith("image/")
  )
    throw new Error(`Cannot fetch ${name}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(target, `${name}.webp`), bytes);
  console.log(`${name}: ${Math.round(bytes.length / 1024)} KB`);
}
