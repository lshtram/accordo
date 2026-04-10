import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STROKE = "#1e1e1e";
const TRANSPARENT = "transparent";
const BLACK_FILL = "#1e1e1e";
const CREATED = Date.UTC(2026, 3, 4, 0, 0, 0, 0);
const SOURCE = "https://github.com/accordo/accordo";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(
  scriptDir,
  "../assets/excalidraw/accordo-mermaid-shapes.excalidrawlib",
);

function hashString(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) || 1;
}

function makeBaseElement(id, type, x, y, extra = {}) {
  return {
    id,
    type,
    x,
    y,
    version: 1,
    versionNonce: hashString(`${id}:nonce`),
    isDeleted: false,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    angle: 0,
    strokeColor: STROKE,
    backgroundColor: TRANSPARENT,
    seed: hashString(`${id}:seed`),
    groupIds: [],
    strokeSharpness: "sharp",
    boundElementIds: [],
    updated: CREATED,
    link: null,
    locked: false,
    ...extra,
  };
}

function rectangle(id, x, y, width, height, extra = {}) {
  return makeBaseElement(id, "rectangle", x, y, { width, height, ...extra });
}

function ellipse(id, x, y, width, height, extra = {}) {
  return makeBaseElement(id, "ellipse", x, y, { width, height, ...extra });
}

function diamond(id, x, y, width, height, extra = {}) {
  return makeBaseElement(id, "diamond", x, y, { width, height, ...extra });
}

function line(id, x, y, points, extra = {}) {
  const xs = points.map(([pointX]) => pointX);
  const ys = points.map(([, pointY]) => pointY);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);

  return makeBaseElement(id, "line", x, y, {
    width,
    height,
    points,
    strokeSharpness: "round",
    startBinding: null,
    endBinding: null,
    lastCommittedPoint: null,
    startArrowhead: null,
    endArrowhead: null,
    ...extra,
  });
}

function segment(id, x1, y1, x2, y2, extra = {}) {
  return line(id, x1, y1, [[0, 0], [x2 - x1, y2 - y1]], extra);
}

function capsulePoints(width, height, segmentCount = 6) {
  const radius = height / 2;
  const leftCenterX = radius;
  const rightCenterX = width - radius;
  const centerY = radius;
  const points = [];

  for (let index = 0; index <= segmentCount; index += 1) {
    const angle = -Math.PI / 2 + (Math.PI * index) / segmentCount;
    points.push([
      rightCenterX + Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius,
    ]);
  }

  for (let index = 0; index <= segmentCount; index += 1) {
    const angle = Math.PI / 2 + (Math.PI * index) / segmentCount;
    points.push([
      leftCenterX + Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius,
    ]);
  }

  points.push(points[0]);
  return points.map(([x, y]) => [Math.round(x), Math.round(y)]);
}

function withGroup(name, elements) {
  const groupId = `group-${name}`;
  return elements.map((element) => ({ ...element, groupIds: [groupId] }));
}

function makeItem(name, elements) {
  return {
    id: name,
    status: "unpublished",
    created: CREATED,
    name,
    elements: withGroup(name, elements),
  };
}

const items = [
  makeItem("mermaid-rectangle", [rectangle("mermaid-rectangle--0", 0, 0, 180, 60)]),
  makeItem("mermaid-rounded-rectangle", [
    rectangle("mermaid-rounded-rectangle--0", 0, 0, 180, 60, {
      strokeSharpness: "round",
    }),
  ]),
  makeItem("mermaid-stadium", [
    line("mermaid-stadium--0", 150, 0, capsulePoints(180, 60)),
  ]),
  makeItem("mermaid-circle", [ellipse("mermaid-circle--0", 0, 0, 80, 80)]),
  makeItem("mermaid-double-circle", [
    ellipse("mermaid-double-circle--0", 0, 0, 80, 80),
    ellipse("mermaid-double-circle--1", 10, 10, 60, 60),
  ]),
  makeItem("mermaid-ellipse", [ellipse("mermaid-ellipse--0", 0, 0, 120, 72)]),
  makeItem("mermaid-diamond", [diamond("mermaid-diamond--0", 0, 0, 140, 90)]),
  makeItem("mermaid-hexagon", [
    line("mermaid-hexagon--0", 0, 45, [
      [0, 0],
      [35, -45],
      [105, -45],
      [140, 0],
      [105, 45],
      [35, 45],
      [0, 0],
    ]),
  ]),
  makeItem("mermaid-parallelogram", [
    line("mermaid-parallelogram--0", 24, 0, [
      [0, 0],
      [156, 0],
      [132, 60],
      [-24, 60],
      [0, 0],
    ]),
  ]),
  makeItem("mermaid-parallelogram-alt", [
    line("mermaid-parallelogram-alt--0", 0, 0, [
      [0, 0],
      [156, 0],
      [180, 60],
      [24, 60],
      [0, 0],
    ]),
  ]),
  makeItem("mermaid-trapezoid", [
    line("mermaid-trapezoid--0", 24, 0, [
      [0, 0],
      [132, 0],
      [156, 60],
      [-24, 60],
      [0, 0],
    ]),
  ]),
  makeItem("mermaid-inverted-trapezoid", [
    line("mermaid-inverted-trapezoid--0", 0, 0, [
      [0, 0],
      [180, 0],
      [156, 60],
      [24, 60],
      [0, 0],
    ]),
  ]),
  makeItem("mermaid-cylinder", [
    ellipse("mermaid-cylinder--0", 12, 0, 96, 24),
    segment("mermaid-cylinder--1", 12, 12, 12, 68),
    segment("mermaid-cylinder--2", 108, 12, 108, 68),
    ellipse("mermaid-cylinder--3", 12, 56, 96, 24),
  ]),
  makeItem("mermaid-subroutine", [
    rectangle("mermaid-subroutine--0", 0, 0, 180, 60),
    segment("mermaid-subroutine--1", 12, 0, 12, 60),
    segment("mermaid-subroutine--2", 168, 0, 168, 60),
  ]),
  makeItem("mermaid-subgraph", [
    rectangle("mermaid-subgraph--0", 0, 0, 220, 140, {
      strokeStyle: "dashed",
    }),
  ]),
  makeItem("mermaid-note", [
    line("mermaid-note--0", 0, 0, [
      [0, 0],
      [140, 0],
      [170, 30],
      [170, 110],
      [0, 110],
      [0, 0],
    ]),
    line("mermaid-note--1", 140, 0, [
      [0, 0],
      [0, 30],
      [30, 30],
    ]),
  ]),
  makeItem("mermaid-document", [
    line("mermaid-document--0", 0, 0, [
      [0, 0],
      [170, 0],
      [170, 80],
      [136, 92],
      [102, 84],
      [68, 96],
      [34, 88],
      [0, 100],
      [0, 0],
    ]),
  ]),
  makeItem("mermaid-package", [
    rectangle("mermaid-package--0", 0, 20, 180, 100),
    rectangle("mermaid-package--1", 0, 0, 64, 24),
  ]),
  makeItem("mermaid-fork-join-horizontal", [
    rectangle("mermaid-fork-join-horizontal--0", 0, 0, 180, 16, {
      backgroundColor: BLACK_FILL,
      fillStyle: "solid",
    }),
  ]),
  makeItem("mermaid-fork-join-vertical", [
    rectangle("mermaid-fork-join-vertical--0", 0, 0, 16, 120, {
      backgroundColor: BLACK_FILL,
      fillStyle: "solid",
    }),
  ]),
  makeItem("mermaid-class-box", [
    rectangle("mermaid-class-box--0", 0, 0, 180, 120),
    segment("mermaid-class-box--1", 0, 30, 180, 30),
    segment("mermaid-class-box--2", 0, 76, 180, 76),
  ]),
  makeItem("mermaid-er-entity", [
    rectangle("mermaid-er-entity--0", 0, 0, 180, 110),
    segment("mermaid-er-entity--1", 0, 32, 180, 32),
  ]),
  makeItem("mermaid-cloud", [
    line("mermaid-cloud--0", 24, 48, [
      [0, 0],
      [10, -26],
      [34, -40],
      [64, -32],
      [82, -48],
      [118, -42],
      [142, -18],
      [166, -16],
      [190, 4],
      [182, 30],
      [154, 44],
      [122, 40],
      [96, 52],
      [58, 48],
      [28, 56],
      [4, 44],
      [0, 0],
    ]),
  ]),
];

const library = {
  type: "excalidrawlib",
  version: 2,
  source: SOURCE,
  libraryItems: items,
};

function validateLibrary(libraryData) {
  const itemIds = new Set();
  const elementIds = new Set();

  for (const item of libraryData.libraryItems) {
    if (itemIds.has(item.id)) {
      throw new Error(`Duplicate item id: ${item.id}`);
    }
    itemIds.add(item.id);

    for (const element of item.elements) {
      if (elementIds.has(element.id)) {
        throw new Error(`Duplicate element id: ${element.id}`);
      }
      elementIds.add(element.id);
    }
  }
}

validateLibrary(library);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(library, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      outputPath,
      itemCount: library.libraryItems.length,
      itemNames: library.libraryItems.map((item) => item.name),
    },
    null,
    2,
  ),
);
