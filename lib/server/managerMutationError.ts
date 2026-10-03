/** Keep internal SQL details out of responses and fail closed if a migration is missing. */
export function managerMutationError(error: { code?: string; message?: string }) {
  if (error.code === "42501") return { status: 403, error: "Cette opération n’est pas autorisée." };
  if (error.code === "P0002") return { status: 404, error: "La personne demandée est introuvable dans ce club." };
  if (error.code?.startsWith("22")) return { status: 400, error: "Les informations saisies sont invalides." };
  return { status: 503, error: "L’enregistrement est indisponible. Aucun changement n’a été appliqué." };
}
