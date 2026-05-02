export function readString(
  payload: Record<string, unknown>,
  field: string,
): string {
  const val = payload[field];
  return typeof val === "string" ? val : "";
}

export function readOptionalString(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const val = payload[field];
  return typeof val === "string" ? val : undefined;
}

export function readOptionalStringArray(
  payload: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const val = payload[field];
  if (!Array.isArray(val)) return undefined;
  if (val.every((item) => typeof item === "string")) {
    return val as string[];
  }
  return undefined;
}

export function readOptionalNumber(
  payload: Record<string, unknown>,
  field: string,
): number | undefined {
  const val = payload[field];
  return typeof val === "number" ? val : undefined;
}

export function readOptionalBoolean(
  payload: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const val = payload[field];
  return typeof val === "boolean" ? val : undefined;
}
