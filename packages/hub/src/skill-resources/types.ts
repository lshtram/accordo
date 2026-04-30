export interface SkillResource {
  readonly uri: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly text: string;
}

export interface SkillResourceSummary {
  readonly uri: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly mimeType: "text/markdown";
}
