export type BasicDetailFields = {
  rect: DOMRect;
  id: string | undefined;
  classList: string[] | undefined;
  role: string | undefined;
  ariaLabel: string | undefined;
  textContent: string | undefined;
  attributes: Record<string, string>;
  testIds: Record<string, string> | undefined;
  bounds: { x: number; y: number; width: number; height: number };
  visibleConfidence: "high" | "medium" | "low";
};

export type DetailStateData = {
  states: string[];
  ariaStates: Record<string, boolean | undefined>;
  hasPointerEvents: boolean;
  isObstructed: boolean | undefined;
};
