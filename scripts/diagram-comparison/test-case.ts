import { renderAllPaths } from './render.ts';
import { FLOWCHART_DIAGRAM_TESTCASES } from './cases.ts';

const case1 = FLOWCHART_DIAGRAM_TESTCASES[0];
console.log('Case 1:', case1.name);
const result = await renderAllPaths(case1.definition, case1.name, 0);
console.log('Error:', result.error);
console.log('Mermaid SVG:', result.svgMermaid ? result.svgMermaid.substring(0, 200) : 'empty');
console.log('Dagre SVG:', result.svgDagre ? result.svgDagre.substring(0, 200) : 'empty');
console.log('Excalidraw SVG:', result.svgExcalidraw ? result.svgExcalidraw.substring(0, 200) : 'empty');
process.exit(0);
