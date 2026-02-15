export default function TestCard() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="rounded-2xl border bg-white p-8 shadow-sm max-w-md w-full">
        <h1 className="text-3xl font-bold text-gray-900">
          Tailwind fonctionne 🎉
        </h1>

        <p className="mt-4 text-gray-600">
          Si tu vois :
        </p>

        <ul className="mt-4 space-y-2 text-sm">
          <li className="text-green-600 font-medium">
            ✓ Texte vert
          </li>
          <li className="text-red-500 font-semibold">
            ✓ Texte rouge
          </li>
          <li className="text-blue-500 underline">
            ✓ Texte bleu souligné
          </li>
        </ul>

        <button className="mt-6 w-full rounded-xl bg-black text-white py-3 hover:bg-gray-800 transition">
          Bouton test
        </button>
      </div>
    </div>
  );
}
