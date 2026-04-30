import { accordoSkill } from "./accordo.js";
import { browserSkill } from "./browser.js";
import { diagramSkill } from "./diagram.js";
import { presentationSkill } from "./presentation.js";
import { walkthroughSkill } from "./walkthrough.js";
import type { SkillResource, SkillResourceSummary } from "./types.js";

export const SKILL_RESOURCE_URIS = [
  "accordo://skills/accordo",
  "accordo://skills/diagram",
  "accordo://skills/browser",
  "accordo://skills/presentation",
  "accordo://skills/walkthrough",
] as const;

export const SKILL_RESOURCES: readonly SkillResource[] = [
  {
    uri: "accordo://skills/accordo",
    name: "accordo",
    title: "Accordo IDE MCP Skill",
    description: "General Accordo IDE workflow: editor, layout, terminal, comments, voice, and VS Code command gateway.",
    text: accordoSkill,
  },
  {
    uri: "accordo://skills/diagram",
    name: "diagram",
    title: "Accordo Diagram Skill",
    description: "Diagram creation, styling, patching, and rendering workflow.",
    text: diagramSkill,
  },
  {
    uri: "accordo://skills/browser",
    name: "browser",
    title: "Accordo Browser Skill",
    description: "Browser page inspection, tab targeting, screenshots, and control recovery.",
    text: browserSkill,
  },
  {
    uri: "accordo://skills/presentation",
    name: "presentation",
    title: "Accordo Presentation Skill",
    description: "Marp deck authoring, navigation, narration, and capture workflow.",
    text: presentationSkill,
  },
  {
    uri: "accordo://skills/walkthrough",
    name: "walkthrough",
    title: "Accordo Walkthrough Skill",
    description: "Narrated demos, presentation shows, code reviews, and guided UI walkthroughs.",
    text: walkthroughSkill,
  },
];

export function listSkillResources(): SkillResourceSummary[] {
  return SKILL_RESOURCES.map(({ uri, name, title, description }) => ({
    uri,
    name,
    title,
    description,
    mimeType: "text/markdown",
  }));
}

export function readSkillResource(uri: string): SkillResource | undefined {
  return SKILL_RESOURCES.find((resource) => resource.uri === uri);
}
