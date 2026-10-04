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
