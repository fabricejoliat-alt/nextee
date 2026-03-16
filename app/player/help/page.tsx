"use client";

const GUIDE_URL =
  "https://qgyshibomgcuaxhyhrgo.supabase.co/storage/v1/object/public/Docs/ActiviTee_V1_player.pdf";

type HelpBlock = {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
  ordered?: string[];
};

type HelpSection = {
  id: string;
  title: string;
  intro?: string;
  blocks: HelpBlock[];
};

const sections: HelpSection[] = [
  {
    id: "intro",
    title: "ActiviTee – Junior Golf Platform",
    intro:
      "Organize. Track. Develop. JUNIOR GOLF PLATFORM - Player v1.0",
    blocks: [
      {
        paragraphs: [
          "ActiviTee est une plateforme de gestion et de suivi de la performance destinée aux juniors de golf, leurs coachs et leurs parents. Elle permet de centraliser l’ensemble des informations liées à l’activité golfique du joueur et de faciliter la gestion d’une section junior.",
          "La plateforme repose sur trois piliers :",
        ],
        bullets: [
          "L’organisation – planifier et gérer les activités de la section junior",
          "Le suivi – suivre l’activité et la progression des joueurs",
          "Le développement – accompagner le développement des jeunes golfeurs",
        ],
      },
      {
        heading: "Organisation",
        paragraphs: [
          "ActiviTee permet aux clubs et aux coachs d’organiser facilement les activités de la section junior. Les joueurs et leurs parents peuvent ainsi consulter en tout temps les entraînements, les interclubs, les stages et autres événements du club. Chaque joueur dispose d’une vue claire de son planning. Il peut en tout temps ajouter des activités individuelles afin d’affiner la planification de sa saison. Des fils de discussion spécifiques à chaque événement permettent au club d’éviter les échanges dispersés d’e-mails ou de messages de groupe.",
        ],
      },
      {
        heading: "Suivi",
        paragraphs: [
          "La plateforme permet de suivre l’activité golfique du joueur sur la durée. Les juniors peuvent enregistrer, en plus des événements planifiés par le club :",
        ],
        bullets: [
          "leurs séances d’entraînement individuel",
          "leur volume d’entraînement",
          "leurs parcours",
          "leurs résultats en compétition",
          "leurs statistiques de jeu",
        ],
      },
      {
        paragraphs: [
          "Ces informations offrent une vision globale de l’activité du joueur. Les coachs et les parents peuvent ainsi mieux comprendre :",
        ],
        bullets: [
          "l’engagement du joueur",
          "son volume de jeu",
          "l’évolution de ses performances",
        ],
      },
      {
        heading: "Développement",
        paragraphs: [
          "Grâce à une organisation structurée et à un suivi clair de l’activité, les coachs peuvent consacrer davantage de temps à ce qui compte le plus : le développement des joueurs. ActiviTee devient ainsi un outil qui soutient le travail technique et pédagogique du coach.",
          "La plateforme encourage également les juniors à devenir acteurs de leur progression. En enregistrant leurs entraînements, leurs parcours et leurs sensations, les joueurs développent progressivement :",
        ],
        bullets: [
          "une meilleure compréhension de leur jeu",
          "une réflexion sur leur planification",
          "une plus grande autonomie dans leur progression",
        ],
      },
      {
        paragraphs: [
          "L’objectif est d’accompagner les jeunes golfeurs vers une pratique plus structurée, plus réfléchie et plus autonome, tout en permettant aux coachs et aux parents de suivre et soutenir leur développement sportif.",
        ],
      },
    ],
  },
  {
    id: "consentements",
    title: "Consentements",
    blocks: [
      {
        paragraphs: [
          "ActiviTee est une plateforme utilisée principalement par des joueurs juniors, qui sont pour la plupart mineurs. Pour cette raison, l’utilisation de la plateforme nécessite le consentement d’un parent ou représentant légal. Ce consentement est essentiel afin de garantir une utilisation transparente et conforme aux règles de protection des données applicables aux mineurs. Le consentement parental permet notamment :",
        ],
        bullets: [
          "l’utilisation de la plateforme ActiviTee",
          "l’activation du compte du joueur junior",
          "l’enregistrement des activités sportives (entraînements, parcours, compétitions)",
          "le suivi de la progression sportive",
          "la communication au sein de la section junior (messages, informations, événements)",
          "l’accès des parents au suivi de l’activité de leur enfant",
        ],
      },
      {
        paragraphs: [
          "Les informations enregistrées dans la plateforme sont utilisées uniquement dans le cadre de l’organisation et du suivi de l’activité sportive du joueur. Le club ou l’organisation qui utilise ActiviTee reste responsable de la gestion des comptes des joueurs de sa section junior.",
          "Le compte d’un joueur junior est activé uniquement après validation du consentement parental. Une fois ce consentement donné, le parent peut également accéder à la plateforme afin de suivre les activités et la progression de son enfant. Si nécessaire, le consentement peut être retiré à tout moment en contactant le club ou l’organisation responsable.",
        ],
      },
    ],
  },
  {
    id: "installation",
    title: "Installer ActiviTee comme application",
    blocks: [
      {
        paragraphs: [
          "ActiviTee est accessible depuis un navigateur à l’adresse www.activitee.golf mais nous vous recommandons de l’installer sur votre téléphone. Cette installation permet d’utiliser la plateforme comme une application classique, avec une icône sur l’écran d’accueil de votre téléphone. Installer ActiviTee comme application offre plusieurs avantages :",
        ],
        bullets: [
          "accès rapide depuis l’écran d’accueil",
          "connexion plus simple à la plateforme",
          "possibilité de recevoir des notifications",
          "une expérience plus fluide, similaire à une application native",
        ],
      },
      {
        paragraphs: [
          "L’installation ne prend que quelques secondes et ne nécessite pas de passer par l’App Store ou Google Play où ActiviTee sera disponible d’ici quelques semaines.",
        ],
      },
      {
        heading: "Sur iPhone (iOS)",
        paragraphs: [
          "Pour installer ActiviTee sur un iPhone ou un iPad :",
        ],
        ordered: [
          "Rendez-vous sur www.activitee.org dans le navigateur Safari",
          "Appuyez sur l’icône Partager (le carré avec une flèche vers le haut)",
          "Faites défiler les options",
          "Sélectionnez Ajouter à l’écran d’accueil",
          "Confirmez en appuyant sur Ajouter",
        ],
      },
      {
        paragraphs: [
          "L’icône ActiviTee apparaîtra alors sur votre écran d’accueil. Vous pourrez ensuite ouvrir la plateforme comme une application classique. Cette installation fonctionne uniquement avec le navigateur Safari sur iPhone.",
        ],
      },
      {
        heading: "Sur Android",
        paragraphs: [
          "Pour installer ActiviTee sur un téléphone Android :",
        ],
        ordered: [
          "Rendez-vous sur www.activitee.org dans le navigateur Google Chrome",
          "Appuyez sur le menu ⋮ en haut à droite",
          "Sélectionnez Installer l’application ou Ajouter à l’écran d’accueil",
          "Confirmez l’installation",
        ],
      },
      {
        paragraphs: [
          "L’application sera alors installée sur votre téléphone et apparaîtra dans votre liste d’applications. Vous pourrez ensuite ouvrir ActiviTee comme n’importe quelle autre application.",
        ],
      },
    ],
  },
  {
    id: "notifications",
    title: "Activer les notifications",
    blocks: [
      {
        paragraphs: [
          "Les notifications permettent de rester informé en temps réel des informations importantes concernant les activités de la section junior. Vous pouvez recevoir des notifications notamment pour :",
        ],
        bullets: [
          "la création de nouveaux événements (entraînements, compétitions, stages)",
          "les modifications d’un événement",
          "les annulations d’événement",
          "les nouvelles évaluations de coach",
          "les nouveaux messages dans un fil de discussion",
          "les absences signalées par les joueurs",
          "les rappels d’événements à venir",
        ],
      },
      {
        paragraphs: [
          "Lors de la première utilisation de la plateforme, votre téléphone vous demandera l’autorisation d’envoyer des notifications push.",
          "Vous pouvez à tout moment consulter ou modifier vos préférences de notifications. Pour accéder aux paramètres :",
        ],
        ordered: [
          "Cliquez sur l’icône cloche en haut à droite de votre écran",
          "Ouvrez le centre de notifications",
          "Accédez aux paramètres de notifications",
        ],
      },
      {
        paragraphs: [
          "Si vous souhaitez recevoir les notifications directement sur votre téléphone, assurez-vous que l’option « Push PWA » est activée. Lorsque cette option est activée, les notifications peuvent apparaître sur votre téléphone même lorsque l’application n’est pas ouverte, comme pour une application classique. Cela vous permet de rester informé facilement des activités, messages et mises à jour importantes.",
        ],
      },
    ],
  },
  {
    id: "activites",
    title: "Fonctionnement de la plateforme",
    blocks: [
      {
        heading: "Activités",
        paragraphs: [
          "La plateforme est organisée autour de deux types d’activités :",
        ],
        bullets: [
          "Activités « Club » : organisées et planifiées par le club (entraînements, interclubs, camps ou stages, événements, séances collectives).",
          "Activités « Junior » : organisées et planifiées par le joueur (compétitions, entraînements individuels, cours privés, camps ou stages).",
        ],
      },
      {
        paragraphs: [
          "Cette distinction permet de structurer clairement les activités organisées par le club et celles gérées directement par le joueur.",
        ],
      },
      {
        heading: "Activités « Club »",
        paragraphs: [
          "Toutes les activités Club sont planifiées et organisées par le coach ou par le comité de la section junior.",
          "La présence du junior à ces activités est attendue. En cas d’empêchement, le junior ou le parent peut facilement annoncer son absence en cliquant sur le bouton « Absent ». Cette fonctionnalité permet :",
        ],
        bullets: [
          "de suivre les présences et absences des joueurs durant la saison",
          "de faciliter l’organisation des entraînements pour les coachs",
          "de disposer de statistiques fiables de participation",
        ],
      },
      {
        paragraphs: [
          "Ces données peuvent notamment être utilisées pour répondre aux exigences de certaines institutions qui soutiennent l’activité sportive des jeunes, comme par exemple Jeunesse+Sport.",
          "Chaque activité « Club » possède également son fil de discussion. Ce fil permet d’échanger autour de l’activité spécifique et peut être utilisé pour :",
        ],
        bullets: [
          "partager des informations pratiques",
          "organiser les trajets ou le covoiturage",
          "communiquer des informations de dernière minute",
          "poser des questions liées à l’activité",
        ],
      },
      {
        paragraphs: [
          "Toutes les discussions restent ainsi centralisées dans l’événement concerné.",
        ],
      },
      {
        heading: "Activités « Junior »",
        paragraphs: [
          "Les activités Junior sont planifiées directement par le joueur. Le junior peut ajouter différents types d’activités, par exemple :",
        ],
        bullets: [
          "un entraînement individuel",
          "un cours privé",
          "une compétition",
          "un camp ou stage",
        ],
      },
      {
        paragraphs: [
          "Ces activités permettent au joueur de compléter le suivi de son activité golfique, même lorsque celle-ci n’est pas directement organisée par le club. Cette fonctionnalité est particulièrement utile pour :",
        ],
        bullets: [
          "planifier sa saison",
          "garder une trace de toutes ses activités",
          "suivre son volume d’entraînement et de jeu",
        ],
      },
      {
        paragraphs: [
          "Pour les joueurs utilisant le mode « Performance », ces activités permettent également d’enregistrer plus précisément les statistiques et le contenu des entraînements.",
        ],
      },
    ],
  },
  {
    id: "performance",
    title: "Mode « Performance »",
    blocks: [
      {
        paragraphs: [
          "Lorsque le mode « Performance » est activé pour un junior, un suivi plus précis de son activité d’entraînement est requis. Le joueur doit alors renseigner la structure de l’entraînement réalisé, en indiquant les différents postes de travail ainsi que le temps consacré à chacun d’eux. Les principaux secteurs d’entraînement sont par exemple :",
        ],
        bullets: [
          "Échauffement/mobilité",
          "Putting",
          "Chipping",
          "Pitching",
          "Wedging",
          "Bunker",
          "Long jeu",
          "Parcours",
        ],
      },
      {
        paragraphs: [
          "Cette structuration permet de mieux comprendre comment le temps d’entraînement est réparti entre les différents secteurs du jeu.",
          "Le mode « Performance » est activé par le coach ou le comité en fonction des objectifs du junior dans la pratique du golf.",
        ],
      },
      {
        heading: "Auto-évaluation de l’entraînement",
        paragraphs: [
          "En complément de la structure de la séance, le joueur doit effectuer une auto-évaluation basée sur trois critères de sensations. Cette auto-évaluation permet de mieux comprendre la qualité de l’entraînement et l’état d’esprit du joueur.",
        ],
      },
      {
        heading: "Motivation avant l’entraînement",
        paragraphs: [
          "Ce critère permet d’évaluer l’état d’esprit du joueur avant de commencer la séance. Il peut refléter par exemple :",
        ],
        bullets: [
          "l’envie de s’entraîner",
          "le niveau d’énergie",
          "l’état de concentration ou de fatigue",
        ],
      },
      {
        paragraphs: [
          "Comprendre la motivation avant l’entraînement permet d’identifier si le joueur aborde sa séance dans de bonnes conditions mentales.",
        ],
      },
      {
        heading: "Difficulté de l’entraînement",
        paragraphs: [
          "Ce critère permet d’évaluer le niveau de difficulté de la séance réalisée. Il peut dépendre :",
        ],
        bullets: [
          "de la complexité des exercices",
          "du niveau de concentration requis",
          "de l’intensité du travail réalisé",
        ],
      },
      {
        paragraphs: [
          "Cette information aide le coach à comprendre le niveau de challenge auquel le joueur s’est confronté pendant sa séance.",
        ],
      },
      {
        heading: "Satisfaction après l’entraînement",
        paragraphs: [
          "Ce critère permet d’évaluer le ressenti du joueur à la fin de la séance. Il peut refléter :",
        ],
        bullets: [
          "la qualité perçue de l’entraînement",
          "le sentiment de progression",
          "la réussite ou non des exercices travaillés",
        ],
      },
      {
        paragraphs: [
          "Cette information permet de mesurer le niveau de satisfaction du joueur par rapport au travail effectué.",
          "La structuration de l’entraînement et l’auto-évaluation constituent des informations très utiles pour le coach. Elles permettent de mieux comprendre le travail réalisé, l’intensité de l’entraînement et le ressenti du joueur, afin de l’accompagner plus efficacement dans sa progression.",
        ],
      },
    ],
  },
  {
    id: "evaluation-coachs",
    title: "Évaluation des entraînements par les coachs",
    blocks: [
      {
        paragraphs: [
          "Dans ActiviTee, chaque séance d’entraînement est évaluée par le coach selon trois critères clés :",
        ],
        bullets: ["Engagement", "Attitude", "Application"],
      },
      {
        paragraphs: [
          "Cette évaluation ne porte pas uniquement sur le résultat technique du joueur, mais surtout sur la manière dont il s’entraîne. Au golf, la progression dépend avant tout de la qualité du travail réalisé pendant les entraînements. Ces trois critères, évaluer de 1 à 6, permettent donc de mesurer les éléments qui ont le plus d’impact sur la progression d’un joueur.",
        ],
      },
      {
        heading: "Engagement : Implication dans l’entraînement",
        paragraphs: [
          "L’engagement reflète le niveau d’implication du joueur pendant la séance. Le coach observe notamment :",
        ],
        bullets: [
          "la motivation du joueur",
          "sa concentration pendant les exercices",
          "son énergie et son investissement",
          "sa capacité à rester impliqué tout au long de l’entraînement",
        ],
      },
      {
        paragraphs: [
          "Un joueur engagé montre qu’il est actif dans son développement et prêt à progresser.",
        ],
      },
      {
        heading: "Attitude : Comportement et état d’esprit",
        paragraphs: [
          "L’attitude concerne le comportement du joueur pendant l’entraînement. Le coach évalue notamment :",
        ],
        bullets: [
          "le respect des consignes",
          "le respect des autres joueurs et du coach",
          "l’état d’esprit face aux difficultés",
          "la capacité à rester positif et concentré",
        ],
      },
      {
        paragraphs: [
          "Une bonne attitude est essentielle pour créer un environnement d’entraînement sain et motivant.",
        ],
      },
      {
        heading: "Application : Mise en pratique des exercices",
        paragraphs: [
          "L’application mesure la qualité avec laquelle le joueur met en pratique les exercices proposés. Le coach observe notamment :",
        ],
        bullets: [
          "la capacité à appliquer les consignes techniques",
          "l’attention portée aux détails",
          "la précision dans la réalisation des exercices",
          "l’effort fourni pour corriger et améliorer son geste",
        ],
      },
      {
        paragraphs: [
          "Une bonne application montre que le joueur est capable de transformer les conseils du coach en progrès concret.",
        ],
      },
      {
        heading: "Pourquoi ces critères sont importants",
        paragraphs: [
          "Dans le développement d’un joueur, la qualité de l’entraînement est souvent plus importante que le résultat immédiat. Un joueur qui :",
        ],
        bullets: [
          "s’engage pleinement dans son entraînement",
          "adopte une attitude positive",
          "applique sérieusement les consignes",
        ],
      },
      {
        paragraphs: [
          "progressa généralement plus rapidement et plus durablement.",
          "Ces évaluations permettent :",
        ],
        bullets: [
          "au joueur de mieux comprendre comment il s’entraîne",
          "au coach d’adapter son accompagnement",
          "aux parents de suivre l’engagement et la progression du junior",
        ],
      },
      {
        paragraphs: [
          "L’objectif est d’encourager les joueurs à développer de bonnes habitudes d’entraînement, indispensables pour progresser et atteindre leurs objectifs sportifs.",
        ],
      },
    ],
  },
  {
    id: "volume",
    title: "Volume d’entraînement",
    blocks: [
      {
        paragraphs: [
          "Le volume d’entraînement correspond au temps consacré aux différentes activités de pratique du golf : entraînement technique, jeu sur le parcours, préparation physique ou travail mental. Dans ActiviTee, le suivi du volume d’entraînement s’inspire des recommandations du modèle de développement sportif FTEM de Swiss Olympic. Ces recommandations ont été adaptées au golf junior afin de tenir compte :",
        ],
        bullets: [
          "du niveau du joueur",
          "de son âge",
          "de ses objectifs sportifs",
          "de son niveau d’ambition",
        ],
      },
      {
        paragraphs: [
          "L’objectif n’est pas d’imposer une charge d’entraînement identique à tous les joueurs, mais de proposer des repères adaptés à chaque niveau de progression.",
        ],
      },
      {
        heading: "Pourquoi mesurer le volume d’entraînement ?",
        paragraphs: [
          "Mesurer le volume d’entraînement permet de mieux comprendre l’investissement du joueur dans sa pratique sportive. Ce suivi permet notamment de :",
        ],
        bullets: [
          "suivre la régularité de l’entraînement",
          "identifier les périodes d’activité plus ou moins importantes",
          "analyser l’équilibre entre entraînement et compétition",
          "accompagner la progression sportive du joueur",
        ],
      },
      {
        paragraphs: [
          "Pour les coachs, ces informations sont précieuses pour mieux comprendre l’engagement du joueur et la structure de son travail. Pour les parents, elles permettent d’avoir une vision claire de l’activité sportive de leur enfant. Pour le joueur lui-même, ce suivi favorise une prise de conscience de son investissement et encourage une approche plus structurée de l’entraînement.",
        ],
      },
      {
        heading: "Les niveaux de progression",
        paragraphs: [
          "Afin de rendre la progression plus motivante et plus facile à comprendre, ActiviTee utilise un système de Levels, inspiré de la logique des jeux vidéo. Chaque joueur progresse à travers différents niveaux en fonction de son handicap et de son développement sportif. Chaque niveau correspond à une étape dans la progression du joueur et s’accompagne de recommandations de volume d’entraînement adaptées.",
          "Cette approche permet de transformer la progression sportive en parcours motivant, où chaque joueur peut visualiser son évolution.",
        ],
        bullets: [
          "Junior Explorer I — Handicap : 54+ — Premiers pas dans le golf. Le joueur découvre le jeu, ses règles et développe les bases techniques.",
          "Junior Explorer II — Handicap : 54 – 36 — Le joueur consolide les fondamentaux et commence à structurer ses entraînements.",
          "Junior Explorer III — Handicap : 36 – 18 — Le joueur développe davantage sa technique et joue régulièrement sur le parcours et en compétition.",
          "Junior Competitor — Handicap : 18 – 10 — Le joueur participe régulièrement à des compétitions et développe une approche plus structurée de l’entraînement.",
          "Junior Challenger — Handicap : 10 – 5 — Le joueur entre dans une phase de progression plus exigeante avec un volume d’entraînement plus important et une attention particulière portée à la performance.",
          "Junior Performer — Handicap : 5 – 0 — Le joueur possède déjà un niveau de jeu avancé et développe une approche de plus en plus orientée vers la performance.",
          "Junior Elite — Handicap : 0 → +2 — Le joueur atteint un niveau élite national et s’entraîne de manière très structurée.",
          "International Elite — Handicap : +2 → +4 — Le joueur évolue à un niveau international et participe à des compétitions de haut niveau.",
          "World Elite — Handicap : +4 → +6 — Le joueur évolue parmi les meilleurs joueurs de sa catégorie au niveau international.",
          "Champion — Tour level — Le joueur atteint le niveau professionnel ou de très haut niveau international.",
        ],
      },
      {
        heading: "Une progression motivante",
        paragraphs: [
          "Le système de niveaux permet aux joueurs de visualiser leur progression, un peu comme dans un jeu vidéo. Chaque niveau représente une étape vers le niveau suivant, avec :",
        ],
        bullets: [
          "un niveau de jeu plus élevé",
          "une pratique plus régulière",
          "un entraînement plus structuré",
        ],
      },
      {
        paragraphs: [
          "L’objectif n’est pas uniquement d’améliorer son handicap, mais de développer progressivement les habitudes et la discipline nécessaires pour progresser dans le golf.",
        ],
      },
    ],
  },
  {
    id: "page-accueil",
    title: "Page • Accueil",
    blocks: [
      {
        paragraphs: [
          "La page Accueil est la porte d’entrée de l’application. Elle vous permet d’accéder rapidement à quelques informations importantes concernant votre activité au sein de la section junior.",
          "Depuis cette page, vous pouvez consulter en un coup d’œil :",
        ],
        bullets: [
          "les prochaines activités",
          "les dernières notifications",
          "le volume d’entrainement réalisé durant le mois en cours",
          "les dernières annonces du Marketplace",
        ],
      },
      {
        heading: "Carte de la prochaine activité",
        paragraphs: [
          "Au sommet de la page s’affiche une carte présentant la prochaine activité du joueur junior. Cette carte indique les informations principales de l’événement, telles que :",
        ],
        bullets: [
          "le type d’activité (entraînement, compétition, stage, etc.)",
          "la date et l’heure",
          "le lieu",
          "les informations utiles liées à l’événement",
        ],
      },
      {
        paragraphs: [
          "Si une annonce d’absence est requise, l’option permettant de signaler l’absence est immédiatement accessible depuis cette carte.",
        ],
      },
      {
        heading: "Navigation entre les activités",
        paragraphs: [
          "Il est possible de consulter les autres activités planifiées en utilisant les boutons Précédent et Suivant. Ces boutons permettent de faire défiler les activités et de consulter facilement les événements à venir.",
        ],
      },
      {
        heading: "Messagerie liée à l’événement",
        paragraphs: [
          "Comme sur chaque carte d’activité dans l’application, un bouton de messagerie est disponible. Ce bouton indique si une discussion est en cours dans le fil de discussion lié à l’événement. Cela permet de savoir rapidement si des informations ou des échanges sont en cours entre les joueurs, les parents ou les coachs.",
        ],
      },
      {
        heading: "Accéder aux détails de l’événement",
        paragraphs: [
          "Pour obtenir plus d’informations, cliquez sur le bouton Détail. Vous pourrez alors consulter toutes les informations de l’événement, voir les participants, accéder au fil de discussion et échanger avec les autres participants via la messagerie liée à l’événement. Cette page permet ainsi de centraliser toutes les informations et les échanges liés à une activité.",
        ],
      },
    ],
  },
  {
    id: "page-messagerie",
    title: "Page • Messagerie",
    blocks: [
      {
        paragraphs: [
          "La messagerie d’ActiviTee permet de faciliter la communication entre joueurs, parents, coachs et responsables de la section junior. Elle n’a pas pour objectif de remplacer une application de discussion instantanée, mais plutôt de centraliser les échanges liés aux activités sportives.",
          "La messagerie fonctionne sous forme de fils de discussion regroupant plusieurs participants. Dans la majorité des cas, les fils de discussion sont directement liés à une activité « Club » (entraînement, compétition, stage, événement). Cela permet de rassembler toutes les informations et les échanges au même endroit.",
        ],
      },
      {
        heading: "Fils de discussion spécifiques",
        paragraphs: [
          "Certains fils de discussion ne sont pas liés à une activité. C’est notamment le cas pour :",
        ],
        bullets: [
          "les discussions entre un junior et un coach",
          "le fil de discussion Junior – Encadrement – Parent, accessible depuis le Dashboard dans la section Mon Golf",
        ],
      },
      {
        paragraphs: [
          "Ces fils permettent d’échanger sur des sujets liés à la progression du joueur ou à son suivi sportif.",
        ],
      },
      {
        heading: "Communication entre juniors",
        paragraphs: [
          "Pour des raisons d’organisation et de sécurité, il n’est pas possible pour un junior d’ouvrir un fil de discussion avec un autre junior. La communication entre joueurs se fait principalement dans les fils liés aux activités, sous la supervision du coach ou de l’encadrement.",
        ],
      },
      {
        heading: "Accès aux discussions",
        paragraphs: [
          "Chaque fil de discussion est accessible directement depuis la page de l’activité concernée ou depuis l’onglet Messagerie dans la navigation principale. Cet onglet centralise l’ensemble des fils de discussion auxquels vous participez.",
        ],
      },
      {
        heading: "Recommandations d’utilisation",
        paragraphs: [
          "La messagerie est principalement destinée à faciliter l’organisation et la communication autour des activités sportives. Elle peut être utilisée par exemple pour :",
        ],
        bullets: [
          "partager des informations pratiques liées à une activité",
          "organiser les trajets ou le covoiturage",
          "poser des questions au coach",
          "communiquer des informations importantes aux participants",
        ],
      },
      {
        paragraphs: [
          "Pour garantir une communication efficace, il est recommandé de rester concerné par le sujet de l’activité, de privilégier les messages utiles à l’organisation et d’éviter les discussions hors sujet. L’objectif est de maintenir une communication claire, utile et centrée sur l’activité sportive.",
        ],
      },
    ],
  },
  {
    id: "page-mon-activite",
    title: "Page • Mon activité",
    blocks: [
      {
        paragraphs: [
          "La page Activités regroupe l’ensemble des activités enregistrées dans la plateforme. Elle affiche sous forme de cartes toutes les activités « Club » et « Junior ». Cette page permet d’avoir une vue complète et structurée de l’activité golfique du joueur.",
          "Cette page constitue un outil important pour le joueur, qui peut suivre et organiser ses activités, pour les coachs, qui peuvent observer l’engagement et la régularité du joueur, et pour les parents, qui peuvent suivre facilement l’activité sportive de leur enfant.",
          "Disposer d’une vision globale des activités permet de mieux comprendre le volume de pratique, la régularité des entraînements et la planification de la saison.",
        ],
      },
      {
        heading: "Filtrer les activités",
        paragraphs: [
          "L’utilisateur peut filtrer les activités afin de faciliter la lecture et la navigation. Les activités peuvent être filtrées par type d’activité et par temporalité : activités à venir ou activités passées.",
          "Ces filtres permettent par exemple de consulter les prochaines activités planifiées, de revoir les activités déjà réalisées et d’analyser la régularité de l’activité sportive.",
        ],
      },
      {
        heading: "Ajouter une activité « Junior »",
        paragraphs: [
          "Cette page permet également au joueur d’ajouter ses propres activités « Junior », c’est-à-dire les activités qui ne sont pas directement organisées par le club. Le joueur peut notamment ajouter :",
        ],
        bullets: [
          "un entraînement individuel",
          "un cours privé",
          "une compétition",
          "un camp ou stage",
        ],
      },
      {
        paragraphs: [
          "Ces activités complètent celles organisées par le club et permettent de conserver une trace complète de l’ensemble de l’activité golfique du joueur.",
        ],
      },
      {
        heading: "Un outil de planification et de suivi",
        paragraphs: [
          "La page Activités joue un rôle important dans la planification et le suivi de la saison. Elle permet de visualiser rapidement les activités passées et futures, d’organiser son planning d’entraînement et de compétition et de garder une trace de toutes les activités réalisées.",
          "Cette vision globale est particulièrement utile pour suivre l’engagement du joueur et l’équilibre entre entraînement, compétition et jeu sur le parcours.",
        ],
      },
    ],
  },
  {
    id: "page-a-completer",
    title: "Page • Activités à compléter",
    blocks: [
      {
        paragraphs: [
          "(Juniors en mode « Performance » uniquement)",
          "Cette page affiche la liste des entraînements qui doivent encore être complétés ou évalués par le joueur. Lorsque le mode « Performance » est activé, chaque séance d’entraînement doit être documentée après sa réalisation. Cela permet de conserver une trace précise du travail effectué et d’améliorer le suivi de la progression du joueur. Pour chaque activité à compléter, le joueur doit :",
        ],
        bullets: [
          "définir la structure réelle de l’entraînement, en indiquant les différents secteurs du jeu travaillés et le temps consacré à chacun d’eux",
          "effectuer une auto-évaluation basée sur trois critères de sensations : Motivation avant l’entraînement, Difficulté de l’entraînement, Satisfaction après l’entraînement",
        ],
      },
      {
        paragraphs: [
          "Ces informations permettent de mieux comprendre comment l’entraînement s’est réellement déroulé.",
        ],
      },
      {
        heading: "Un outil utile pour le suivi et la progression",
        paragraphs: [
          "Les informations saisies par le joueur sont accessibles aux coachs et aux parents. Elles permettent notamment de mieux comprendre le contenu réel des séances d’entraînement, d’analyser l’intensité et la qualité du travail réalisé, de suivre l’engagement et la motivation du joueur et d’adapter la planification des prochains entraînements.",
        ],
      },
      {
        heading: "Développer l’autonomie du joueur",
        paragraphs: [
          "Compléter ces informations après chaque entraînement encourage également le joueur à prendre du recul sur son travail. Cette démarche permet de développer une réflexion sur son entraînement, de mieux comprendre ce qui fonctionne ou non et de devenir progressivement acteur de sa progression.",
          "L’objectif est d’installer des habitudes de suivi et d’analyse qui aideront le joueur à progresser de manière plus structurée et plus consciente.",
        ],
      },
    ],
  },
  {
    id: "dashboard",
    title: "Page • Mon Golf - Dashboard",
    blocks: [
      {
        paragraphs: [
          "Le Dashboard est la page de pilotage principale du joueur. Il regroupe en un seul endroit les informations essentielles permettant de suivre l’activité, analyser la performance et accompagner la progression du joueur. Cette page est utile à la fois pour le joueur, qui peut suivre sa progression et mieux comprendre son jeu, pour le coach, qui dispose d’une vision globale pour adapter les entraînements, et pour les parents, qui peuvent suivre l’activité sportive et l’évolution du junior.",
          "Le dashboard permet ainsi de transformer les données d’entraînement et de jeu en informations utiles pour la progression.",
        ],
      },
      {
        heading: "Fil de discussion Joueur • Coach • Parent",
        paragraphs: [
          "Le dashboard intègre un fil de discussion dédié au suivi du joueur. Ce fil permet d’échanger directement entre le joueur, le coach et les parents. Il est particulièrement utile pour discuter de la progression du joueur, donner des retours après un entraînement ou une compétition, partager des objectifs, transmettre des conseils ou des observations. Contrairement aux discussions liées aux activités, ce fil est centré sur le développement du joueur.",
        ],
      },
      {
        heading: "Repository de fichiers",
        paragraphs: [
          "Le dashboard contient également un espace de partage de fichiers. Cet espace permet de partager différents types de documents : PDF (programmes d’entraînement, documents techniques), images (positions techniques, repères visuels), vidéos (analyse de swing, exercices techniques), autres documents utiles. Ce repository devient ainsi une bibliothèque de ressources personnalisées pour le joueur.",
        ],
      },
      {
        heading: "Suivi du volume d’entraînement",
        paragraphs: [
          "Le dashboard affiche le volume d’entraînement du joueur, comparé à son objectif d’entraînement. Les données permettent notamment de visualiser le temps total d’entraînement et la répartition entre entraînements club, entraînements individuels et cours privés. Ce suivi permet de vérifier si le joueur respecte les objectifs de pratique recommandés et d’adapter la planification si nécessaire.",
        ],
      },
      {
        heading: "Suivi des sensations",
        paragraphs: [
          "Les sensations d’entraînement sont également représentées sur le dashboard. Elles sont basées sur les trois critères d’auto-évaluation : motivation avant l’entraînement, difficulté de l’entraînement, satisfaction après l’entraînement. L’analyse de ces tendances permet d’identifier les périodes de fort engagement, les phases de fatigue ou de baisse de motivation et les entraînements particulièrement efficaces. Ces informations aident le coach à adapter l’intensité et le contenu des séances.",
        ],
      },
      {
        heading: "Graphiques d’activité",
        paragraphs: [
          "Plusieurs graphiques permettent de visualiser l’activité du joueur :",
        ],
        bullets: [
          "Volume d’entraînement hebdomadaire : régularité, périodes de forte ou faible activité, cohérence avec les objectifs d’entraînement.",
          "Répartition des secteurs d’entraînement : putting, chipping, pitching, wedging, bunker, long jeu, practice, parcours.",
          "Tendances des sensations : qualité globale des séances, périodes de progression, moments où l’entraînement devient plus exigeant.",
        ],
      },
      {
        heading: "Statistiques de jeu",
        paragraphs: [
          "Le dashboard présente également les statistiques issues des parcours enregistrés. Ces statistiques permettent d’analyser la performance réelle sur le parcours.",
        ],
        bullets: [
          "Nombre total de trous joués sur la période",
          "Répartition des scores : Eagles, Birdies, Pars, Bogeys, Doubles bogeys ou plus",
          "Greens en régulation (GIR)",
          "Score moyen",
          "Nombre de putts",
          "Fairways touchés",
          "Scores par type de trou : PAR3, PAR4, PAR5",
          "Front 9 vs Back 9",
        ],
      },
      {
        heading: "Corrélation entre entraînement et performance",
        paragraphs: [
          "Lorsque suffisamment de données sont enregistrées dans la plateforme (volume d’entraînement et parcours joués), il devient possible d’analyser les liens entre l’entraînement et les résultats sur le parcours. Par exemple : l’évolution du putting peut être comparée au nombre de putts, le travail du long jeu peut être relié aux fairways touchés ou aux greens en régulation, la régularité de l’entraînement peut être mise en relation avec l’évolution du score moyen.",
          "Cette analyse permet au coach et au joueur de mieux comprendre quels aspects de l’entraînement ont le plus d’impact sur la performance en compétition.",
        ],
      },
    ],
  },
  {
    id: "mes-parcours",
    title: "Page • Mes parcours",
    blocks: [
      {
        paragraphs: [
          "La page Mes Parcours regroupe l’ensemble des parcours enregistrés par le joueur dans la plateforme. Elle permet de consulter facilement les parcours réalisés à l’entraînement ou en compétition et d’analyser les performances sur le parcours. Chaque parcours est affiché sous forme de carte, indiquant les informations principales telles que le nom du parcours, la date, le type de parcours (entraînement ou compétition), le score réalisé et les principales statistiques du tour. Cette page permet ainsi de garder une trace complète de l’historique des parcours joués.",
          "En cliquant sur la carte d’un parcours, vous accédez à la page détaillée du tour. Cette page permet de consulter la carte de score complète, les scores trou par trou et les statistiques du tour. Par exemple : nombre de putts, fairways touchés, greens en régulation, répartition des scores (birdies, pars, bogeys, etc.).",
        ],
      },
    ],
  },
  {
    id: "ajouter-parcours",
    title: "Page • Ajouter un parcours",
    blocks: [
      {
        heading: "Pourquoi enregistrer ses parcours ?",
        paragraphs: [
          "Enregistrer ses parcours est une étape essentielle pour mieux comprendre son jeu et progresser au golf. Contrairement à l’entraînement, le parcours représente la situation réelle de jeu. C’est sur le parcours que le joueur doit appliquer sa technique, sa stratégie, sa gestion mentale et sa capacité de décision. Les données enregistrées permettent d’analyser objectivement la performance du joueur.",
        ],
      },
      {
        heading: "Comprendre son jeu",
        paragraphs: [
          "Les statistiques du parcours permettent d’identifier plus facilement les points forts, les axes d’amélioration et les situations qui posent le plus de difficultés. Par exemple : peu de fairways touchés peut indiquer un problème de précision au drive, peu de greens en régulation peut montrer un manque d’efficacité dans le jeu long, un nombre élevé de putts peut révéler un travail à faire au putting.",
        ],
      },
      {
        heading: "Suivre sa progression",
        paragraphs: [
          "En enregistrant régulièrement ses parcours, le joueur peut suivre l’évolution de ses performances dans le temps. Cela permet de mesurer les progrès réalisés, d’identifier les périodes de progression et d’observer l’impact du travail réalisé à l’entraînement.",
        ],
      },
      {
        heading: "Adapter l’entraînement",
        paragraphs: [
          "Les informations issues des parcours sont très utiles pour le coach. Elles permettent d’adapter le contenu des entraînements afin de travailler les secteurs du jeu qui ont le plus d’impact sur le score. Par exemple : travailler davantage le wedging si peu de greens sont atteints, améliorer le jeu court si les pars sont difficiles à sauver, renforcer le putting si le nombre de putts est élevé.",
        ],
      },
      {
        heading: "Relier l’entraînement à la performance",
        paragraphs: [
          "Lorsque plusieurs parcours et plusieurs séances d’entraînement sont enregistrés, il devient possible d’observer la relation entre l’entraînement et les résultats sur le parcours. Par exemple : une amélioration du putting peut se traduire par moins de putts, un travail du long jeu peut augmenter le nombre de greens en régulation, une meilleure gestion du parcours peut réduire le nombre de doubles bogeys. Cette analyse permet au joueur et au coach de mieux comprendre ce qui fonctionne réellement pour améliorer la performance.",
        ],
      },
      {
        heading: "Développer une approche performance",
        paragraphs: [
          "Enregistrer ses parcours encourage le joueur à adopter une approche plus structurée et réfléchie du golf. Le joueur ne se contente plus de jouer un parcours : il analyse son jeu, comprend ses résultats et identifie les axes de progression. C’est une démarche utilisée par tous les joueurs qui souhaitent progresser et atteindre un niveau de performance plus élevé.",
        ],
      },
      {
        heading: "Paramétrer un parcours",
        paragraphs: [
          "Avant d’enregistrer les scores, certaines informations doivent être renseignées.",
        ],
        bullets: [
          "Date du parcours",
          "Handicap avant le parcours",
          "Type de parcours",
        ],
      },
      {
        paragraphs: [
          "Le joueur doit indiquer la date à laquelle le parcours a été joué et son handicap au moment du départ. Cette information permet de suivre l’évolution du niveau de jeu au fil des parcours.",
        ],
      },
      {
        heading: "Informations supplémentaires pour les compétitions",
        paragraphs: [
          "Si le parcours correspond à une compétition, plusieurs informations complémentaires peuvent être renseignées.",
        ],
        bullets: [
          "Nom de la compétition",
          "Format de la compétition : Stroke Play / Individuel ou Match Play",
          "Niveau du tournoi",
          "Nombre de tours : 1×18 trous, 2×18 trous, 3×18 trous, 4×18 trous",
          "Gestion du cut : après 2 tours ou 3 tours",
        ],
      },
      {
        heading: "Choisir le parcours",
        paragraphs: [
          "Deux possibilités existent pour sélectionner le parcours joué.",
        ],
        bullets: [
          "Parcours existant dans la base de données : recherchez le parcours, sélectionnez le tee de départ. Le PAR du parcours, le Slope et le Course Rating sont alors automatiquement connus.",
          "Ajouter un nouveau parcours : s’il n’existe pas dans la base de données, vous pouvez l’ajouter manuellement en renseignant le nom du parcours, le tee de départ, le Slope et le Course Rating.",
        ],
      },
      {
        heading: "Saisie des scores",
        paragraphs: [
          "Une fois le parcours sélectionné, le joueur peut enregistrer les informations trou par trou. Pour chaque trou, les éléments suivants doivent être renseignés : score réalisé, nombre de putts, fairway touché (Hit Fairway) ou fairway manqué (Miss Fairway). Ces informations permettent de générer automatiquement les statistiques de performance du parcours.",
          "Si le parcours existe dans la base de données, le PAR de chaque trou est automatiquement renseigné. Si le parcours a été ajouté manuellement, le joueur devra indiquer le PAR de chaque trou.",
        ],
      },
      {
        heading: "Scorecard",
        paragraphs: [
          "La scorecard est accessible à tout moment pendant la saisie du parcours. Elle présente les scores de manière claire et lisible, trou par trou. La scorecard permet notamment de consulter les scores de chaque trou, le score total, les scores du front 9 et du back 9. Les statistiques du parcours sont également affichées en bas de la scorecard. Ces statistiques permettent d’analyser rapidement la performance globale du tour.",
        ],
      },
    ],
  },
  {
    id: "ordre-merite",
    title: "Ordre du mérite",
    blocks: [
      {
        paragraphs: [
          "(Juniors en mode « Performance » uniquement)",
          "L’Ordre du Mérite (OM) est un classement qui permet de suivre la performance et l’engagement des joueurs au sein d’une organisation. Le classement est mis à jour automatiquement et en temps réel sur la base des résultats en compétition, de la participation aux activités, de la présence aux entraînements et événements de performance.",
          "Deux classements sont calculés : Ordre du Mérite Brut et Ordre du Mérite Net.",
        ],
      },
      {
        heading: "1. Points attribués lors des tournois",
        paragraphs: [
          "Les points de l’Ordre du Mérite sont calculés en fonction des caractéristiques du parcours et du niveau de performance réalisé. Les calculs s’appuient notamment sur le Course Rating (CR) et le Slope Rating (SR). Le Course Rating est pris en compte jusqu’à la première décimale.",
          "Calcul des points Net : si la moyenne des scores est égale au Course Rating, le joueur obtient 100 points. Ces points sont ensuite ajustés selon le coefficient du tournoi et avec d’éventuels points bonus. Si la moyenne des scores est différente du Course Rating, les points sont ajustés selon la formule : (différence entre le CR et la moyenne des scores) × 5.",
          "Calcul des points Brut : si la moyenne des scores est égale au Course Rating, le joueur obtient 150 points + le Slope Rating. Ces points sont ensuite ajustés selon le coefficient du tournoi et avec les éventuels points bonus. Si la moyenne des scores est différente du Course Rating, les points sont ajustés selon : (différence entre le CR et la moyenne des scores) × 5.",
          "Points supplémentaires selon le nombre de tours : tournoi sur 36 trous (+5 Net / +10 Brut), tournoi sur 54 trous (+10 Net / +20 Brut), tournoi sur 72 trous (+15 Net / +30 Brut).",
          "Coefficient des tournois : tournoi juniors club / entraînement × 0.8, tournoi officiel de club × 1, tournoi régional × 1.2, tournoi national × 1.4, tournoi international × 1.6.",
          "Pour les tournois en match-play, le joueur obtient 10 points par match gagné. Ces points sont ajoutés aux points obtenus lors de la phase de qualification en stroke play. Les compétitions par équipes ne sont pas prises en compte.",
          "Certains événements internationaux ou spéciaux donnent lieu à une attribution forfaitaire de points, par exemple Junior Ryder Cup, Palmer Cup, Match Suisse – France. Points attribués : Brut 150, Net 100.",
        ],
      },
      {
        heading: "2. Points bonus",
        paragraphs: [
          "Des points supplémentaires peuvent être obtenus grâce à la participation aux activités sportives.",
        ],
        bullets: [
          "Présence à un entraînement : 5 points",
          "Journée Performance / Camp : 15 points par jour",
          "Participation à une compétition Juniors / Club : 5 points",
          "Participation à une compétition régionale : 10 points",
          "Participation à une compétition nationale : 20 points",
          "Participation à une compétition internationale : 40 points",
          "Concours pendant les entraînements : 1er 15 points, 2e 10 points, 3e 5 points",
        ],
      },
      {
        heading: "3. Périodes de calcul des points",
        paragraphs: [
          "La saison est divisée en trois périodes afin de valoriser les meilleures performances du joueur.",
        ],
        bullets: [
          "Jusqu’à fin mai : 5 meilleurs résultats",
          "Jusqu’à fin juillet : 10 meilleurs résultats",
          "Jusqu’à fin octobre : 15 meilleurs résultats",
        ],
      },
      {
        paragraphs: [
          "Seuls les meilleurs résultats du joueur sont pris en compte pour le classement.",
        ],
      },
    ],
  },
  {
    id: "marketplace",
    title: "Marketplace",
    blocks: [
      {
        paragraphs: [
          "La Marketplace permet aux membres de la section junior de donner, vendre ou échanger du matériel de golf entre familles. Les juniors évoluent rapidement dans leur pratique et leur croissance. Il est donc fréquent que du matériel devienne trop petit ou ne soit plus adapté au niveau du joueur. La marketplace permet de faire circuler ce matériel au sein de la section junior et d’en faire profiter d’autres joueurs.",
          "C’est une solution simple pour donner une seconde vie au matériel, faciliter l’accès à l’équipement pour les jeunes joueurs et favoriser l’entraide entre les familles de la section junior.",
        ],
      },
      {
        heading: "Publier une annonce",
        paragraphs: [
          "Les parents et les joueurs peuvent publier facilement une annonce pour proposer du matériel. Une annonce peut concerner par exemple des clubs de golf juniors, un sac de golf, un chariot, des chaussures, des vêtements de golf ou tout autre équipement lié à la pratique du golf.",
          "Lors de la publication d’une annonce, il est recommandé d’indiquer une description claire du matériel, l’état du matériel, le prix souhaité (ou indiquer si l’objet est donné) et éventuellement une ou plusieurs photos.",
        ],
      },
      {
        heading: "Consulter les annonces",
        paragraphs: [
          "Les annonces publiées dans la marketplace sont accessibles à l’ensemble des membres de la section junior. Les utilisateurs peuvent parcourir les annonces afin de trouver du matériel adapté au niveau ou à la taille du joueur, remplacer ou compléter leur équipement et profiter d’opportunités proposées par d’autres familles du club.",
        ],
      },
      {
        heading: "Prendre contact",
        paragraphs: [
          "Si un équipement vous intéresse, vous pouvez contacter directement la personne qui a publié l’annonce afin d’organiser l’échange ou la vente. Les modalités de paiement et de remise du matériel sont convenues directement entre les familles.",
        ],
      },
      {
        heading: "Un service réservé à la section junior",
        paragraphs: [
          "La marketplace est un service destiné exclusivement aux membres de la section junior du club ou de l’organisation. Elle a pour objectif de faciliter les échanges au sein de la communauté, dans un esprit de partage et de soutien entre les familles.",
        ],
      },
    ],
  },
  {
    id: "profil",
    title: "Page • Mon profil",
    blocks: [
      {
        paragraphs: [
          "La page Mon Profil permet de consulter et gérer les informations personnelles et administratives du joueur. Ces informations sont importantes pour l’organisation des activités de la section junior et pour assurer un suivi sportif et administratif correct du joueur. Les données du profil sont regroupées en plusieurs catégories.",
        ],
      },
      {
        heading: "Identité",
        paragraphs: [
          "La section Identité contient les informations personnelles du joueur. Ces informations permettent d’identifier le joueur dans la plateforme et de l’intégrer correctement dans les activités de la section junior. Les éléments enregistrés sont notamment : Prénom, Nom, Date de naissance, Catégorie d’âge (ex. U14), Sexe, Latéralité (droitier ou gaucher), Handicap.",
        ],
      },
      {
        heading: "Mise à jour du handicap",
        paragraphs: [
          "Le handicap du joueur est mis à jour manuellement dans la plateforme. Il est important que cette valeur corresponde au handicap officiel actuel du joueur, car elle peut être utilisée dans différentes fonctionnalités de l’application, notamment le suivi de la progression, l’analyse des performances, certains calculs statistiques et les classements ou l’ordre du mérite.",
          "Le joueur ou le parent est donc invité à mettre à jour régulièrement cette information lorsque le handicap évolue.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: [
          "La section Contact permet d’enregistrer les informations permettant de joindre le joueur ou sa famille. Les informations enregistrées sont : Numéro de téléphone, Adresse e-mail (utilisée pour la connexion à la plateforme), Adresse postale.",
        ],
      },
      {
        heading: "Informations administratives",
        paragraphs: [
          "Certaines informations administratives peuvent également être demandées par le club ou par les institutions sportives. Par exemple : Numéro AVS. Ces informations peuvent être nécessaires dans le cadre de programmes de soutien au sport junior, comme par exemple Jeunesse+Sport, ou pour certaines démarches administratives liées à l’activité sportive.",
        ],
      },
    ],
  },
];

export default function PlayerHelpPage() {
  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="glass-card" style={{ padding: 16, display: "grid", gap: 14 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <div className="section-title" style={{ marginBottom: 0 }}>
                  Aide
                </div>
                <div className="section-subtitle">
                  Guide joueur ActiviTee basé sur la structure du document Word.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a
                  href={GUIDE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="btn"
                  style={{ textDecoration: "none" }}
                >
                  Ouvrir le PDF
                </a>
                <a
                  href={GUIDE_URL}
                  download
                  className="btn-secondary"
                  style={{ textDecoration: "none" }}
                >
                  Télécharger
                </a>
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Sommaire
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="pill-soft"
                    style={{ textDecoration: "none" }}
                  >
                    {section.title}
                  </a>
                ))}
              </div>
            </div>

            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                style={{
                  display: "grid",
                  gap: 10,
                  scrollMarginTop: 90,
                  paddingTop: 6,
                  borderTop: "1px solid rgba(0,0,0,0.06)",
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: 21,
                      lineHeight: 1.2,
                      fontWeight: 900,
                      color: "#132018",
                    }}
                  >
                    {section.title}
                  </h2>
                  {section.intro ? (
                    <p style={{ margin: 0, color: "#5f6c62", lineHeight: 1.6 }}>
                      {section.intro}
                    </p>
                  ) : null}
                </div>

                {section.blocks.map((block, blockIndex) => (
                  <div key={`${section.id}-${blockIndex}`} style={{ display: "grid", gap: 7 }}>
                    {block.heading ? (
                      <h3
                        style={{
                          margin: 0,
                          fontSize: 16,
                          lineHeight: 1.3,
                          fontWeight: 800,
                          color: "#132018",
                        }}
                      >
                        {block.heading}
                      </h3>
                    ) : null}
                    {block.paragraphs?.map((paragraph, paragraphIndex) => (
                      <p
                        key={`${section.id}-${blockIndex}-p-${paragraphIndex}`}
                        style={{
                          margin: 0,
                          color: "#26362d",
                          lineHeight: 1.55,
                          whiteSpace: "pre-wrap",
                          fontSize: 14,
                        }}
                      >
                        {paragraph}
                      </p>
                    ))}
                    {block.bullets ? (
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 22,
                          color: "#26362d",
                          lineHeight: 1.5,
                          display: "grid",
                          gap: 4,
                          fontSize: 14,
                        }}
                      >
                        {block.bullets.map((item, itemIndex) => (
                          <li key={`${section.id}-${blockIndex}-b-${itemIndex}`}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                    {block.ordered ? (
                      <ol
                        style={{
                          margin: 0,
                          paddingLeft: 22,
                          color: "#26362d",
                          lineHeight: 1.5,
                          display: "grid",
                          gap: 4,
                          fontSize: 14,
                        }}
                      >
                        {block.ordered.map((item, itemIndex) => (
                          <li key={`${section.id}-${blockIndex}-o-${itemIndex}`}>{item}</li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
