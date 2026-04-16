import { renderAllPaths, cleanup } from './render.ts';

async function main() {
  const def = `flowchart TD
A-->B
`;
  const r = await renderAllPaths(def, 't', 0);
  console.log('error:', r.error);
  console.log('lengths:', r.svgMermaid.length, r.svgDagre.length, r.svgExcalidraw.length);
  await cleanup();
}

main().catch(async (e) => {
  console.error('fatal:', e);
  await cleanup();
  process.exit(1);
});
