/** Separate the penalty paragraph in published cards from the positive action. */
export function splitRuleActionText(text: string) {
  const marker = /(?:^|\n\s*\n)Pénalités\s*:\s*/.exec(text);
  if (!marker) return { action: text, penalties: "" };
  const penalties = text.slice(marker.index + marker[0].length).trim();
  return {
    action: text.slice(0, marker.index).trimEnd(),
    penalties: penalties.charAt(0).toLocaleUpperCase("fr") + penalties.slice(1),
  };
}
