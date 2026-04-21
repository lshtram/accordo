import * as fs from "node:fs";

/** Append a line to .gitignore if it is not already present. */
export function appendGitignore(gitignorePath: string, entry: string): void {
  let contents = "";
  try {
    contents = fs.readFileSync(gitignorePath, "utf8");
  } catch {
    // absent — will create it
  }
  const lines = contents.split("\n").map((line) => line.trim());
  if (lines.includes(entry)) {
    return;
  }

  const separator = contents.length > 0 && !contents.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(gitignorePath, contents + separator + entry + "\n", "utf8");
}
