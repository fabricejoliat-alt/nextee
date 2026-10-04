const placeholder = /\{\{([a-z_]+)\}\}/g;

export function legalTemplateVariables(text: string): string[] {
  return [...text.matchAll(placeholder)].map((match) => match[1]).sort();
}

export function legalTemplateValid(text: string, allowed: readonly string[]): boolean {
  const remainder = text.replace(placeholder, "");
  return !remainder.includes("{{") && !remainder.includes("}}")
    && legalTemplateVariables(text).every((variable) => allowed.includes(variable));
}

export function legalTranslationsMatch(
  source: { title: string; body: string; action_label: string },
  translation: { title: string; body: string; action_label: string },
  allowed: readonly string[],
): boolean {
  const fields = (item: typeof source) => [item.title, item.body, item.action_label];
  if (![...fields(source), ...fields(translation)].every((field) => legalTemplateValid(field, allowed))) return false;
  return JSON.stringify(legalTemplateVariables(fields(source).join("")))
    === JSON.stringify(legalTemplateVariables(fields(translation).join("")));
}
