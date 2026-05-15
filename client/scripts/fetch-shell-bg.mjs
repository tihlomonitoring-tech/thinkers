#!/usr/bin/env node
/**
 * Downloads the bundled login/shell background (mining haul trucks).
 * Run: npm run fetch-bg   (from client/)
 */
import { mkdir, writeFile } from 'fs/promises';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../public/backgrounds');
const outFile = path.join(outDir, 'shell-bg.jpg');

const SOURCES = [
  'https://images.unsplash.com/photo-1711012604128-8339024a3e12?auto=format&fit=crop&w=1920&q=88',
  'https://images.unsplash.com/photo-1523848309072-c199db53f137?auto=format&fit=crop&w=1920&q=88',
  'https://images.unsplash.com/photo-1680463990599-9d318aaecf71?auto=format&fit=crop&w=1920&q=88',
];

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'ThinkersApp/1.0 (shell background setup)',
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 8) {
            const next = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, url).href;
            fetchUrl(next, redirects + 1).then(resolve, reject);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            res.resume();
            return;
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        }
      )
      .on('error', reject);
  });
}

await mkdir(outDir, { recursive: true });

for (const url of SOURCES) {
  try {
    const buf = await fetchUrl(url);
    if (buf.length < 20_000 || buf[0] !== 0xff || buf[1] !== 0xd8) {
      throw new Error(`Unexpected response (${buf.length} bytes)`);
    }
    await writeFile(outFile, buf);
    console.log(`Saved ${outFile} (${Math.round(buf.length / 1024)} KB) from ${url}`);
    process.exit(0);
  } catch (err) {
    console.warn(`Skip ${url}: ${err.message}`);
  }
}

console.error('Could not download shell background. Check your network and try again.');
process.exit(1);
