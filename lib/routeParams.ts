export type RouteParamValue = string | string[] | null | undefined;

export function getRouteParam(value: RouteParamValue): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}
