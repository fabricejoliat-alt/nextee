# Préparation App Store et Google Play — écarts à examiner

Ce module ne certifie aucune conformité Store. Refaire l'inventaire sur le binaire Capacitor et les SDK effectivement embarqués avant toute déclaration.

| Sujet | Preuve ou travail requis avant soumission |
|---|---|
| Politique publique | URL HTML stable, accessible sans connexion et cohérente avec les fonctions réellement déployées ; les pages locales sont vides tant qu'aucun texte validé n'est activé. |
| Apple App Privacy / Google Data Safety | Inventaire données collectées, partage, suivi, finalités, SDK, mesures de sécurité, suppression et transferts ; comparer avec réseau réel de l'app et web/PWA. |
| Âge et enfants | Définir audience, capacité et parcours parent/junior par pays et base ; vérifier restrictions enfants/familles et fiches Store. |
| IA | Documenter données envoyées, prestataire, conservation, contrôles et choix ; vérifier fonction réelle et déclaration. |
| Compte et suppression | Une demande persistée existe mais n'exécute pas la suppression. Concevoir et tester l'exécution réelle, les exceptions de conservation, la route externe et le suivi avant de revendiquer cette capacité. |
| Permissions et WebView | Examiner photos, caméra, notifications, localisation éventuelle ; cases juridiques distinctes des permissions système. Vérifier Capacitor, cookies, cache hors ligne, safe areas iOS. |
| Messagerie/modération | Vérifier signalement, blocage, modération, contacts et contenus générés par utilisateurs selon les fonctionnalités effectives. |

Références officielles : [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Google Play User Data](https://support.google.com/googleplay/android-developer/answer/10144311?hl=fr), [Google Play Families](https://support.google.com/googleplay/android-developer/answer/9893335?hl=fr). Recontrôler les textes lors de la soumission.

## Relecture officielle du 5 octobre 2026 — lancement suisse

L’utilisateur confirme un lancement auprès des clubs suisses et l’exploitant déclaré ActiviTee — Fabrice Joliat. Cela ne décide pas de la catégorie d’âge Store, de la forme juridique ni des déclarations de collecte. Les recommandations ci-dessous restent à vérifier sur le binaire livré.

- **Apple** : politique accessible dans l’application et sa fiche, description de conservation/suppression, parcours de suppression si l’application permet la création de comptes. La section 5.1.2(i) vise explicitement l’information et la permission avant partage de données personnelles avec une IA tierce. Le contrôle club/coach existant n’établit pas, à lui seul, la permission de la personne concernée ou de son représentant. Les exigences Kids et les droits sur les données des enfants doivent être examinés selon le public réel. [App Review Guidelines, 5.1.1–5.1.4](https://developer.apple.com/app-store/review/guidelines/).
- **Google Play** : si le produit permet la création de comptes, prévoir le parcours dans l’application et une ressource web permettant de demander leur suppression, puis traiter effectivement les demandes et expliquer les conservations justifiées. Le formulaire actuel ne prouve que la réception. [Exigences de suppression](https://support.google.com/googleplay/android-developer/answer/13327111?hl=fr).
- **Public enfant** : l’accès d’enfants fait partie du produit prévu ; la déclaration des tranches d’âge doit refléter ce public. Une application dont le public cible inclut des enfants doit satisfaire les exigences Families applicables. [Public cible et contenu](https://support.google.com/googleplay/android-developer/answer/9867159?hl=fr).

Aucune fiche Store consultée ou modifiée, aucune soumission, aucun inventaire réseau du binaire réalisé dans cette phase. Il reste à vérifier les SDK, permissions, modération et procédures de suppression effectifs. Les propositions de [decisions.md](decisions.md) et les [brouillons FR](drafts.md) ne constituent pas une autorisation de publier.


### Précision : comptes attribués par le club

Règle confirmée : aucune inscription autonome Junior/Parent/Coach ; le club crée les comptes et l’invitation ouvre un accès existant. Décrire ce fonctionnement dans les informations destinées aux équipes de revue des Stores, avec des comptes de démonstration adaptés aux rôles.

Les exigences Store conditionnées à la création de comptes doivent être qualifiées sur les fonctions réellement accessibles dans le binaire et les parcours web liés, y compris la création par un Manager. L’absence de bouton d’inscription pour les juniors ne suffit pas à conclure à une exemption globale. Les comptes Supabase créés en ligne par un club ne sont pas automatiquement des comptes créés et gérés hors connexion au sens de l’exception Google. [Google, périmètre et exceptions](https://support.google.com/googleplay/android-developer/answer/13327111?hl=fr), [Apple, création et suppression](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

Conserver un parcours de demande relatif au compte et aux données ; qualifier son exécution et les éventuelles conservations. La création administrative d’un compte ne remplace pas l’information des personnes ni les choix nécessaires. Aucun abandon du travail sur les droits ou affirmation de conformité Store ne résulte de cette précision.
