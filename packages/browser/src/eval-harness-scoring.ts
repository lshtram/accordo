import type {
  CategoryScore,
  CategoryScoreResult,
  CategoryScoringFn,
  EvalCategory,
  EvidenceItem,
} from "./eval-types.js";

function scoreCategory(
  items: readonly EvidenceItem[],
  category: EvalCategory,
  categoryLabel: string,
): CategoryScoreResult {
  const relevant = items.filter((item) => item.category === category);

  if (relevant.length === 0) {
    return {
      score: 0 as CategoryScore,
      rationale: `No evidence items found for category ${categoryLabel}.`,
    };
  }

  let weightedPasses = 0;
  let fails = 0;
  for (const item of relevant) {
    if (item.status === "pass") {
      weightedPasses += 1;
    } else if (item.status === "partial") {
      weightedPasses += 0.5;
    } else if (item.status === "fail") {
      fails += 1;
    }
  }

  const total = relevant.length;
  const passRate = weightedPasses / total;

  let score: CategoryScore;
  if (passRate >= 1.0) {
    score = 5;
  } else if (passRate >= 0.8) {
    score = 4;
  } else if (passRate >= 0.6) {
    score = 3;
  } else if (passRate >= 0.4) {
    score = 2;
  } else if (weightedPasses > 0) {
    score = 1;
  } else {
    score = 0;
  }

  const passCount = relevant.filter((i) => i.status === "pass").length;
  const partialCount = relevant.filter((i) => i.status === "partial").length;
  const failCount = relevant.filter((i) => i.status === "fail").length;
  const rationale =
    `Category ${categoryLabel}: ${passCount} pass, ${partialCount} partial, ` +
    `${failCount} fail out of ${total} items (weighted pass rate: ${(passRate * 100).toFixed(0)}%).`;

  return { score, rationale };
}

export const scoreSessionContext: CategoryScoringFn = (items) => {
  return scoreCategory(items, "session-context", "A (Session & Context)");
};

export const scoreTextExtraction: CategoryScoringFn = (items) => {
  return scoreCategory(items, "text-extraction", "B (Text Extraction)");
};

export const scoreSemanticStructure: CategoryScoringFn = (items) => {
  return scoreCategory(items, "semantic-structure", "C (Semantic Structure)");
};

export const scoreLayoutGeometry: CategoryScoringFn = (items) => {
  return scoreCategory(items, "layout-geometry", "D (Layout & Geometry)");
};

export const scoreVisualCapture: CategoryScoringFn = (items) => {
  return scoreCategory(items, "visual-capture", "E (Visual Capture)");
};

export const scoreInteractionModel: CategoryScoringFn = (items) => {
  return scoreCategory(items, "interaction-model", "F (Interaction Model)");
};

export const scoreDeltasEfficiency: CategoryScoringFn = (items) => {
  return scoreCategory(items, "deltas-efficiency", "G (Deltas & Efficiency)");
};

export const scoreRobustness: CategoryScoringFn = (items) => {
  return scoreCategory(items, "robustness", "H (Robustness)");
};

export const scoreSecurityPrivacy: CategoryScoringFn = (items) => {
  return scoreCategory(items, "security-privacy", "I (Security & Privacy)");
};

export const SCORING_FUNCTIONS: Readonly<Record<EvalCategory, CategoryScoringFn>> = {
  "session-context": scoreSessionContext,
  "text-extraction": scoreTextExtraction,
  "semantic-structure": scoreSemanticStructure,
  "layout-geometry": scoreLayoutGeometry,
  "visual-capture": scoreVisualCapture,
  "interaction-model": scoreInteractionModel,
  "deltas-efficiency": scoreDeltasEfficiency,
  robustness: scoreRobustness,
  "security-privacy": scoreSecurityPrivacy,
};
