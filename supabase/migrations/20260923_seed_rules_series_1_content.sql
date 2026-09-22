-- Complete editorial draft for series 1. Content and original questions remain
-- non-publishable until reviewed by a qualified golf rules official.

with content(stable_key,situation,simple_explanation,action_text,common_mistake,coach_tip,official_reference,illustration_prompt,image_alt) as (values
  ('junior-rule-01',
   $t$Lina trouve sa balle au bord du fairway, dans une petite touffe d’herbe. Elle aimerait l’en sortir avec le pied avant de jouer.$t$,
   $t$En règle générale, la balle se joue là où elle s’est arrêtée. Il ne faut ni la déplacer ni améliorer volontairement son emplacement, sauf lorsqu’une règle autorise une procédure précise.$t$,
   $t$J’observe la position de ma balle, je vérifie si une règle m’accorde un dégagement et, sinon, je la joue comme elle repose.$t$,
   $t$Aplatir l’herbe, pousser la balle vers un meilleur endroit ou croire qu’un mauvais lie donne automatiquement droit à un dégagement.$t$,
   $t$Placez trois balles dans des lies différents et demandez au junior de distinguer « difficile » de « dégagement autorisé » avant de choisir son coup.$t$,
   'Règle 9.1 ; règle liée 9.4',
   $t$Vue à hauteur de balle d’une jeune golfeuse devant une balle immobile dans une touffe d’herbe du rough, club tenu sans toucher la balle, fairway visible, style illustré ActiviTee, sans texte.$t$,
   $t$Une jeune golfeuse observe sa balle posée dans une touffe d’herbe au bord du fairway.$t$),
  ('junior-rule-02',
   $t$Sur un trou, Noé voit le départ, un bunker, un étang rouge, le fairway et le green. Il doit nommer la zone où repose sa balle.$t$,
   $t$Le parcours comprend cinq zones : la zone générale, la zone de départ du trou joué, tous les bunkers, toutes les zones à pénalité et le green du trou joué. La zone détermine souvent la règle applicable.$t$,
   $t$Avant d’appliquer une procédure, j’identifie la zone du parcours où se trouve ma balle.$t$,
   $t$Croire que le rough et le fairway sont deux zones réglementaires différentes, ou compter le hors limites parmi les cinq zones du parcours.$t$,
   $t$Faites parcourir un trou en demandant aux juniors d’annoncer chaque changement de zone. Expliquez que fairway et rough appartiennent tous deux à la zone générale.$t$,
   'Définitions « Zones du parcours » ; Règle 2.2',
   $t$Plan aérien pédagogique d’un trou de golf montrant distinctement départ, zone générale, bunker, zone à pénalité rouge et green, sans légende ni texte, style illustré ActiviTee.$t$,
   $t$Vue aérienne d’un trou avec une zone de départ, un fairway, un bunker, un étang rouge et un green.$t$),
  ('junior-rule-03',
   $t$Avant une compétition, Inès compte quinze clubs dans son sac parce qu’elle a ajouté un putter sans retirer l’ancien.$t$,
   $t$Un joueur peut commencer un tour avec au maximum quatorze clubs. S’il en a moins, il peut en ajouter pendant le tour jusqu’à quatorze, sans retarder le jeu ni emprunter le club d’un autre joueur présent sur le parcours.$t$,
   $t$Je compte mes clubs avant le départ. Si j’en ai plus de quatorze, je déclare immédiatement le ou les clubs en trop hors jeu et j’applique la pénalité prévue.$t$,
   $t$Penser que quinze clubs sont permis si l’un d’eux n’est pas utilisé, ou partager librement un club avec un partenaire qui joue sur le parcours.$t$,
   $t$Organisez un contrôle de sac avant un départ fictif et faites verbaliser la conduite à tenir lorsqu’un club excédentaire est découvert.$t$,
   'Règle 4.1b',
   $t$Jeune golfeuse comptant soigneusement les clubs visibles dans un sac près du premier départ, un club supplémentaire posé à côté, style illustré ActiviTee, sans chiffre ni texte.$t$,
   $t$Une jeune golfeuse compte les clubs de son sac avant de prendre le départ.$t$),
  ('junior-rule-04',
   $t$Deux balles blanches identiques sont proches dans le rough. Sam pense reconnaître la sienne, mais sa marque n’est pas visible.$t$,
   $t$Une balle peut être identifiée grâce à une marque personnelle, par le joueur qui la voit s’arrêter, ou par une marque distinctive certaine. Si elle doit être relevée pour être identifiée, son emplacement est d’abord marqué et elle n’est nettoyée que le minimum nécessaire.$t$,
   $t$Je marque ma balle avant le tour. En cas de doute, je marque son emplacement avant de la relever, je vérifie son identité puis je la replace.$t$,
   $t$Ramasser une balle sans marquer sa position, la nettoyer entièrement alors qu’elle est relevée seulement pour identification, ou se fier à la marque et au numéro seuls.$t$,
   $t$Placez deux balles semblables dans l’herbe et faites jouer la procédure complète : annoncer, marquer, relever juste assez, identifier et replacer.$t$,
   'Règles 7.2 et 7.3',
   $t$Deux balles blanches proches dans un rough léger, l’une portant un petit point bleu partiellement caché, jeune joueur prêt à poser un marque-balle, style ActiviTee, sans texte.$t$,
   $t$Un jeune joueur compare deux balles semblables dans le rough avant d’en relever une après marquage.$t$),
  ('junior-rule-05',
   $t$La balle de Zoé entre dans de hautes herbes. Elle et son cadet commencent à la chercher pendant que le groupe chronomètre la recherche.$t$,
   $t$Une balle est perdue si elle n’est pas trouvée dans les trois minutes après que le joueur ou son cadet commence à la chercher. Si une balle est trouvée à temps, un délai raisonnable supplémentaire est accordé pour l’identifier.$t$,
   $t$Je lance la recherche sans perdre de temps, j’annonce clairement quand elle commence et, après trois minutes sans retrouver la balle, je poursuis selon la procédure applicable.$t$,
   $t$Compter cinq minutes, démarrer le temps seulement lorsque tous les partenaires cherchent, ou continuer à jouer la balle originale retrouvée après l’expiration du délai.$t$,
   $t$Simulez une recherche courte avec un chronomètre et distinguez le moment où la recherche commence du temps raisonnable d’identification d’une balle trouvée juste avant la limite.$t$,
   'Définition « Balle perdue » ; Règle 18.2a(1)',
   $t$Jeune golfeuse et cadet recherchant une balle dans de hautes herbes, un coach tenant discrètement un chronomètre, style illustré ActiviTee, sans texte ni chiffre.$t$,
   $t$Une jeune golfeuse et son cadet recherchent une balle dans de hautes herbes pendant qu’un coach mesure le temps.$t$),
  ('junior-rule-06',
   $t$En cherchant sa balle sous des feuilles, Yanis la touche accidentellement avec son pied et elle roule de quelques centimètres.$t$,
   $t$Lorsqu’un joueur, son adversaire ou une autre personne déplace accidentellement la balle en essayant de la trouver ou de l’identifier, il n’y a pas de pénalité. La balle doit être replacée à son emplacement d’origine estimé si nécessaire.$t$,
   $t$J’arrête la recherche, j’estime l’emplacement d’origine si je ne le connais pas exactement, puis je replace la balle avant de jouer.$t$,
   $t$Jouer la balle depuis son nouvel emplacement, ajouter automatiquement un coup de pénalité ou la dropper au lieu de la replacer.$t$,
   $t$Cachez une balle sous quelques feuilles et faites distinguer « replacer » de « dropper ». Insistez sur l’estimation raisonnable de l’emplacement d’origine.$t$,
   'Règle 7.4',
   $t$Pied d’un jeune golfeur ayant écarté des feuilles et déplacé accidentellement une balle de quelques centimètres, emplacement initial visible, style ActiviTee, sans texte.$t$,
   $t$Une balle déplacée de quelques centimètres par le pied d’un jeune golfeur pendant une recherche sous des feuilles.$t$)
)
update public.rules_card_versions cv set
  situation=content.situation,
  simple_explanation=content.simple_explanation,
  action_text=content.action_text,
  common_mistake=content.common_mistake,
  coach_tip=content.coach_tip,
  official_reference=content.official_reference,
  reference_version='R&A Rules of Golf 2023 + Additional Clarifications 2026-07-01',
  illustration_prompt=content.illustration_prompt,
  image_alt=content.image_alt,
  image_status='pending',
  human_review_required=true,
  approved_by=null,
  approved_at=null
from content
join public.rules_cards c on c.stable_key=content.stable_key
where cv.card_id=c.id and cv.version=1 and cv.locale='fr';

do $migration$
declare
  v_card_key text; v_kind text; v_variant integer; v_prompt text; v_explanation text;
  v_visual text; v_alt text; v_options jsonb; v_version_id uuid; v_question_id uuid; v_option jsonb; v_position integer;
begin
for v_card_key,v_kind,v_variant,v_prompt,v_explanation,v_visual,v_alt,v_options in
select * from (values
('junior-rule-01','practice',1,$q$Ta balle repose dans une touffe d’herbe sans condition anormale. Que fais-tu ?$q$,$q$Une position difficile ne donne pas à elle seule droit à un dégagement : la balle se joue comme elle repose.$q$,$q$Balle dans une touffe du rough, trois gestes suggérés autour d’elle sans texte.$q$,$q$Une balle repose dans une touffe d’herbe du rough.$q$,$json$[{"label":"Je la joue comme elle repose","is_correct":true,"explanation":"Oui. Aucune règle ne permet ici de changer son emplacement."},{"label":"Je l’avance vers le fairway","is_correct":false,"explanation":"Non. Déplacer volontairement la balle sans autorisation enfreint la règle."},{"label":"Je tasse l’herbe derrière la balle","is_correct":false,"explanation":"Non. Améliorer volontairement le lie ou la zone du mouvement n’est pas permis."}]$json$::jsonb),
('junior-rule-01','official',1,$q$Mila trouve sa balle enfoncée dans une touffe sèche, mais elle n’est pas dans son propre impact et aucune autre règle ne s’applique. Quelle décision est correcte ?$q$,$q$Le simple fait que le coup soit difficile n’autorise pas à améliorer le lie ou à déplacer la balle.$q$,$q$Gros plan d’une balle dans une touffe sèche, joueuse observant sans la toucher.$q$,$q$Une joueuse observe sa balle coincée dans une touffe sèche.$q$,$json$[{"label":"La jouer comme elle repose","is_correct":true,"explanation":"Correct. Sans règle de dégagement applicable, elle doit jouer depuis ce lie."},{"label":"La sortir sans pénalité","is_correct":false,"explanation":"Incorrect. Un mauvais lie n’accorde pas automatiquement un dégagement gratuit."},{"label":"Aplatir la touffe puis jouer","is_correct":false,"explanation":"Incorrect. Cela améliorerait volontairement les conditions du coup."}]$json$::jsonb),
('junior-rule-01','official',2,$q$Avant son coup, Hugo pousse sa balle de deux centimètres avec le club pour avoir un meilleur lie. Peut-il jouer sans autre action ?$q$,$q$Non. La balle a été déplacée volontairement et ne se trouve plus à son emplacement réglementaire ; la règle applicable exige de corriger la situation et peut entraîner une pénalité.$q$,$q$Club poussant une balle depuis un petit creux vers une herbe plus courte, vue claire des deux positions.$q$,$q$Un club pousse une balle d’un petit creux vers une zone d’herbe plus courte.$q$,$json$[{"label":"Non, il doit appliquer la règle de balle déplacée","is_correct":true,"explanation":"Correct. Déplacer volontairement la balle pour améliorer son lie n’est pas jouer la balle comme elle repose."},{"label":"Oui, si le déplacement est très court","is_correct":false,"explanation":"Incorrect. La distance ne rend pas le déplacement autorisé."},{"label":"Oui, s’il n’a pas encore commencé son swing","is_correct":false,"explanation":"Incorrect. L’interdiction ne dépend pas du début du swing."}]$json$::jsonb),

('junior-rule-02','practice',1,$q$Le fairway et le rough appartiennent-ils à deux zones différentes du parcours ?$q$,$q$Non. Tous deux font partie de la zone générale.$q$,$q$Vue partagée d’un fairway et de son rough continu, sans séparation réglementaire ajoutée.$q$,$q$Un fairway se prolonge dans le rough sur les côtés.$q$,$json$[{"label":"Non, ils sont dans la zone générale","is_correct":true,"explanation":"Exact. Fairway et rough relèvent tous deux de la zone générale."},{"label":"Oui, le fairway est une sixième zone","is_correct":false,"explanation":"Non. Le fairway n’est pas une zone réglementaire distincte."},{"label":"Oui, le rough est toujours une zone à pénalité","is_correct":false,"explanation":"Non. Une zone à pénalité doit être définie comme telle, généralement en rouge ou jaune."}]$json$::jsonb),
('junior-rule-02','official',1,$q$La balle de Léa repose dans un bunker du trou voisin. Dans quelle zone du parcours est-elle ?$q$,$q$Tous les bunkers du parcours sont une zone spécifique, même s’ils ne se trouvent pas sur le trou actuellement joué.$q$,$q$Balle dans un bunker d’un trou adjacent, joueuse et green du trou joué visibles au loin.$q$,$q$Une balle repose dans le sable d’un bunker situé sur un trou voisin.$q$,$json$[{"label":"Dans un bunker","is_correct":true,"explanation":"Correct. Tous les bunkers font partie des cinq zones du parcours."},{"label":"Dans la zone générale","is_correct":false,"explanation":"Incorrect. Le bunker est une zone spécifique, même sur un autre trou."},{"label":"Hors limites","is_correct":false,"explanation":"Incorrect. Un bunker voisin n’est pas hors limites sauf marquage particulier du Comité."}]$json$::jsonb),
('junior-rule-02','official',2,$q$Laquelle de ces propositions fait partie des cinq zones du parcours ?$q$,$q$Les zones à pénalité constituent l’une des cinq zones définies par les Règles.$q$,$q$Étang bordé de piquets rouges sur un parcours, départ et green en arrière-plan.$q$,$q$Un étang de golf est délimité par des piquets rouges.$q$,$json$[{"label":"Une zone à pénalité","is_correct":true,"explanation":"Correct. Les zones à pénalité sont l’une des cinq zones du parcours."},{"label":"Le hors limites","is_correct":false,"explanation":"Incorrect. Le hors limites se trouve en dehors du parcours."},{"label":"Le fairway seul","is_correct":false,"explanation":"Incorrect. Le fairway appartient à la zone générale."}]$json$::jsonb),

('junior-rule-03','practice',1,$q$Combien de clubs au maximum peux-tu emporter au début d’un tour ?$q$,$q$La limite est de quatorze clubs.$q$,$q$Sac de golf ouvert avec une rangée ordonnée de clubs, junior en train de les compter.$q$,$q$Un junior compte les clubs rangés dans son sac avant le tour.$q$,$json$[{"label":"14","is_correct":true,"explanation":"Oui. Quatorze est le maximum autorisé."},{"label":"15","is_correct":false,"explanation":"Non. Quinze dépasse la limite d’un club."},{"label":"Autant que le sac peut contenir","is_correct":false,"explanation":"Non. La capacité du sac ne change pas la limite réglementaire."}]$json$::jsonb),
('junior-rule-03','official',1,$q$Alice commence avec douze clubs. Peut-elle en ajouter deux pendant le tour ?$q$,$q$Oui, elle peut compléter jusqu’à quatorze si elle ne retarde pas indûment le jeu et ne prend pas le club d’une personne jouant sur le parcours.$q$,$q$Sac contenant douze clubs, deux clubs apportés près d’un passage entre deux trous.$q$,$q$Deux clubs sont apportés à une joueuse dont le sac n’en contenait que douze.$q$,$json$[{"label":"Oui, sous les conditions prévues par la règle","is_correct":true,"explanation":"Correct. Un joueur ayant commencé avec moins de quatorze peut compléter son équipement."},{"label":"Non, aucun club ne peut être ajouté après le départ","is_correct":false,"explanation":"Incorrect. L’ajout est permis jusqu’à la limite, sous conditions."},{"label":"Oui, elle peut en ajouter trois","is_correct":false,"explanation":"Incorrect. Trois clubs porteraient son total à quinze."}]$json$::jsonb),
('junior-rule-03','official',2,$q$Tom découvre un quinzième club dans son sac au deuxième trou. Quelle est sa première obligation ?$q$,$q$Dès qu’il connaît l’infraction, il doit clairement mettre le club excédentaire hors jeu et ne plus l’utiliser.$q$,$q$Joueur montrant clairement un club excédentaire retiré de son sac à son marqueur.$q$,$q$Un joueur retire un club excédentaire de son sac et le montre à son marqueur.$q$,$json$[{"label":"Le déclarer immédiatement hors jeu","is_correct":true,"explanation":"Correct. Le club excédentaire doit être mis hors jeu dès sa découverte."},{"label":"Continuer tant qu’il ne l’utilise pas","is_correct":false,"explanation":"Incorrect. Il doit effectuer clairement la mise hors jeu prévue par la règle."},{"label":"Le remplacer par un autre club","is_correct":false,"explanation":"Incorrect. Un remplacement ne corrige pas la présence initiale du club excédentaire."}]$json$::jsonb),

('junior-rule-04','practice',1,$q$Tu dois relever une balle dans le rough pour vérifier si elle est à toi. Que fais-tu d’abord ?$q$,$q$L’emplacement doit être marqué avant que la balle soit relevée pour identification.$q$,$q$Main posant un petit marque-balle juste derrière une balle dans le rough.$q$,$q$Une main place un marque-balle derrière une balle dans le rough.$q$,$json$[{"label":"Je marque son emplacement","is_correct":true,"explanation":"Oui. Le marquage précède le relèvement pour identifier la balle."},{"label":"Je la nettoie complètement","is_correct":false,"explanation":"Non. Elle ne peut être nettoyée que dans la mesure nécessaire à son identification."},{"label":"Je la déplace avec mon club","is_correct":false,"explanation":"Non. Cela ne respecte pas la procédure de relèvement pour identification."}]$json$::jsonb),
('junior-rule-04','official',1,$q$Deux balles de même marque et même numéro sont côte à côte. Laquelle est celle de Nina ?$q$,$q$La marque et le numéro identiques ne suffisent pas. Nina doit disposer d’un élément permettant d’identifier sa propre balle avec certitude.$q$,$q$Deux balles identiques côte à côte, une joueuse perplexe observant leurs marquages semblables.$q$,$q$Une joueuse observe deux balles blanches portant la même marque et le même numéro.$q$,$json$[{"label":"Elle doit l’identifier avec un élément certain","is_correct":true,"explanation":"Correct. Elle ne peut pas choisir au hasard entre deux balles identiques."},{"label":"La plus proche du trou est forcément la sienne","is_correct":false,"explanation":"Incorrect. La position ne constitue pas une identification certaine."},{"label":"Elle peut choisir l’une des deux","is_correct":false,"explanation":"Incorrect. Une balle doit être identifiée comme étant la sienne."}]$json$::jsonb),
('junior-rule-04','official',2,$q$Pour identifier sa balle, Louis la marque, la relève et enlève seulement la boue qui cache son point bleu. Est-ce permis ?$q$,$q$Oui. Lors d’un relèvement pour identification, la balle peut être nettoyée uniquement autant que nécessaire pour l’identifier.$q$,$q$Balle relevée au-dessus de son marque-balle, pouce retirant une petite trace de boue sur un point bleu.$q$,$q$Un joueur enlève un peu de boue d’une balle relevée au-dessus de son marque-balle.$q$,$json$[{"label":"Oui, le nettoyage est limité à l’identification","is_correct":true,"explanation":"Correct. Il a marqué et ne nettoie que la partie nécessaire."},{"label":"Non, une balle relevée ne peut jamais être touchée","is_correct":false,"explanation":"Incorrect. Le relèvement et le nettoyage limité sont permis selon la procédure."},{"label":"Oui, et il peut la nettoyer entièrement","is_correct":false,"explanation":"Incorrect. Pour cette seule identification, le nettoyage doit rester limité."}]$json$::jsonb),

('junior-rule-05','practice',1,$q$Après combien de temps de recherche une balle non retrouvée est-elle perdue ?$q$,$q$La limite est de trois minutes à partir du début de la recherche par le joueur ou son cadet.$q$,$q$Joueur et cadet cherchant dans les herbes, coach consultant une montre.$q$,$q$Un joueur et son cadet cherchent une balle pendant qu’un coach regarde sa montre.$q$,$json$[{"label":"Trois minutes","is_correct":true,"explanation":"Exact. Au-delà, une balle non trouvée est perdue."},{"label":"Cinq minutes","is_correct":false,"explanation":"Non. L’ancien délai de cinq minutes ne s’applique plus."},{"label":"Jusqu’à ce que le groupe suivant arrive","is_correct":false,"explanation":"Non. La limite ne dépend pas de la position du groupe suivant."}]$json$::jsonb),
('junior-rule-05','official',1,$q$Le cadet de Sara commence à chercher sa balle une minute avant qu’elle arrive. Quand débute le délai ?$q$,$q$Le délai commence lorsque le joueur ou son cadet commence la recherche ; ici, il commence avec le cadet.$q$,$q$Cadet déjà dans le rough à la recherche d’une balle, joueuse marchant vers lui depuis le fairway.$q$,$q$Un cadet cherche déjà dans le rough tandis que la joueuse s’approche.$q$,$json$[{"label":"Quand le cadet commence à chercher","is_correct":true,"explanation":"Correct. La recherche du cadet déclenche le délai."},{"label":"Quand Sara arrive dans la zone","is_correct":false,"explanation":"Incorrect. Le cadet avait déjà commencé la recherche pour elle."},{"label":"Quand un autre joueur lance un chronomètre","is_correct":false,"explanation":"Incorrect. Le délai dépend du début réel de la recherche, pas d’un chronomètre officiel."}]$json$::jsonb),
('junior-rule-05','official',2,$q$Une balle est trouvée après 2 min 55 s, mais sa marque est sous la boue. Le joueur dispose-t-il d’un temps raisonnable pour l’identifier ?$q$,$q$Oui. Une balle trouvée dans les trois minutes peut être identifiée dans un délai raisonnable, même si cela se termine légèrement après la limite.$q$,$q$Balle boueuse découverte dans les herbes, joueur prêt à suivre la procédure d’identification.$q$,$q$Un joueur vient de trouver une balle couverte de boue dans de hautes herbes.$q$,$json$[{"label":"Oui, avec un délai raisonnable d’identification","is_correct":true,"explanation":"Correct. La balle a été trouvée avant l’expiration des trois minutes."},{"label":"Non, toute action doit finir avant trois minutes","is_correct":false,"explanation":"Incorrect. Un délai raisonnable supplémentaire est accordé pour identifier une balle trouvée à temps."},{"label":"Oui, avec trois nouvelles minutes","is_correct":false,"explanation":"Incorrect. Il s’agit seulement d’un délai raisonnable, pas d’un nouveau délai complet."}]$json$::jsonb),

('junior-rule-06','practice',1,$q$Tu déplaces accidentellement ta balle avec le pied en la recherchant. Que dois-tu faire ?$q$,$q$Il n’y a pas de pénalité pour ce déplacement accidentel pendant la recherche, mais la balle doit être replacée.$q$,$q$Balle déplacée par un pied au milieu de feuilles, deux positions visibles.$q$,$q$Une balle a roulé après avoir été touchée par un pied pendant une recherche.$q$,$json$[{"label":"La replacer sans pénalité","is_correct":true,"explanation":"Oui. C’est la procédure prévue pour un déplacement accidentel pendant la recherche."},{"label":"La jouer depuis sa nouvelle place","is_correct":false,"explanation":"Non. Elle doit revenir à son emplacement d’origine."},{"label":"La dropper avec un coup de pénalité","is_correct":false,"explanation":"Non. Il faut replacer, et ce déplacement accidentel n’entraîne pas de pénalité."}]$json$::jsonb),
('junior-rule-06','official',1,$q$En écartant des branches pour chercher, Maya déplace accidentellement sa balle. L’emplacement exact n’est pas connu. Où la remet-elle ?$q$,$q$Elle estime raisonnablement l’emplacement d’origine et y replace la balle.$q$,$q$Branches écartées, balle déplacée et cercle discret suggérant son emplacement estimé initial.$q$,$q$Une balle déplacée sous des branches doit être replacée à son emplacement d’origine estimé.$q$,$json$[{"label":"À l’emplacement d’origine estimé","is_correct":true,"explanation":"Correct. Lorsque l’endroit exact est inconnu, il est estimé puis la balle est replacée."},{"label":"À une longueur de club sans se rapprocher","is_correct":false,"explanation":"Incorrect. Cette situation exige un replacement, pas une zone de dégagement."},{"label":"Là où elle s’est arrêtée après le déplacement","is_correct":false,"explanation":"Incorrect. La balle doit revenir à son emplacement d’origine."}]$json$::jsonb),
('junior-rule-06','official',2,$q$Pendant la recherche, un autre joueur donne accidentellement un coup de pied dans la balle de Paul. Paul reçoit-il une pénalité ?$q$,$q$Non. Un déplacement accidentel pendant une recherche menée raisonnablement n’entraîne pas de pénalité ; la balle doit être replacée.$q$,$q$Balle roulant de quelques centimètres après avoir été touchée accidentellement par une chaussure dans le rough.$q$,$q$Une balle roule après avoir été touchée accidentellement par la chaussure d’un joueur pendant une recherche.$q$,$json$[{"label":"Non, et la balle doit être replacée","is_correct":true,"explanation":"Correct. Le déplacement accidentel pendant la recherche est sans pénalité, puis la balle est replacée."},{"label":"Oui, Paul reçoit toujours un coup de pénalité","is_correct":false,"explanation":"Incorrect. La règle prévoit précisément une absence de pénalité dans cette situation."},{"label":"Non, et la balle doit être jouée de sa nouvelle place","is_correct":false,"explanation":"Incorrect. L’absence de pénalité ne supprime pas l’obligation de replacer la balle."}]$json$::jsonb)
) as question_seed(card_key,kind,variant,prompt,explanation,visual,alt,options)
loop
  select cv.id into v_version_id
  from public.rules_card_versions cv
  join public.rules_cards c on c.id=cv.card_id
  where c.stable_key=v_card_key and cv.version=1 and cv.locale='fr';

  insert into public.rules_questions(card_version_id,kind,variant,prompt,explanation,illustration_prompt,image_alt,allows_multiple,editorial_status)
  values(v_version_id,v_kind,v_variant,v_prompt,v_explanation,v_visual,v_alt,false,'needs_review')
  on conflict(card_version_id,kind,variant) do update set
    prompt=excluded.prompt,explanation=excluded.explanation,
    illustration_prompt=excluded.illustration_prompt,image_alt=excluded.image_alt,
    allows_multiple=false,editorial_status='needs_review'
  returning id into v_question_id;

  v_position := 0;
  for v_option in select value from jsonb_array_elements(v_options) loop
    v_position := v_position + 1;
    insert into public.rules_question_options(question_id,position,label,is_correct,explanation)
    values(v_question_id,v_position,trim(v_option->>'label'),(v_option->>'is_correct')::boolean,trim(v_option->>'explanation'))
    on conflict(question_id,position) do update set label=excluded.label,is_correct=excluded.is_correct,explanation=excluded.explanation;
  end loop;
end loop;
end;
$migration$;

update public.rules_cards set editorial_status='needs_review'
where stable_key in ('junior-rule-01','junior-rule-02','junior-rule-03','junior-rule-04','junior-rule-05','junior-rule-06');
