export type MailTransport = (url: string, init: RequestInit) => Promise<Pick<Response, "ok">>;

export async function sendLegalParentCode(args: {
  email: string;
  code: string;
  apiKey: string;
  from: string;
  transport?: MailTransport;
}) {
  const transport = args.transport ?? fetch;
  const response = await transport("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": args.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "ActiviTee", email: args.from },
      to: [{ email: args.email }],
      subject: "Confirmation de votre décision ActiviTee",
      textContent: `Votre code de confirmation : ${args.code}. Il expire dans 10 minutes.`,
    }),
  });
  return response.ok;
}
