export const TOWER_TEAM_STARTER_CHALLENGES = [
  {
    title: "Le comité des architectes douteux",
    instructions: "Dans un jeu coopératif ou un mode créatif, construisez ensemble un monument inutile mais présentable. Partagez une capture en jeu et laissez chaque participant lui donner un nom grandiose.",
    rewardFloors: 3,
  },
  {
    title: "La mission avec un plan trop ambitieux",
    instructions: "Terminez ensemble un objectif de jeu raisonnable en annonçant avant la partie un plan inutilement solennel. Partagez une capture du résultat et résumez le plan en une phrase.",
    rewardFloors: 3,
  },
  {
    title: "Le musée des décisions collectives",
    instructions: "Choisissez chacun un détail visible de votre partie commune et composez une mini-visite guidée de trois étapes. Publiez une capture du jeu et les trois commentaires, sans exposer de conversation privée.",
    rewardFloors: 2,
  },
  {
    title: "Le boss nommé par le conseil",
    instructions: "Après une partie commune, choisissez un obstacle ou un adversaire du jeu et inventez-lui un titre de boss final. Une capture du jeu et le titre suffisent ; ne ciblez aucun membre réel.",
    rewardFloors: 2,
  },
  {
    title: "La stratégie votée à main levée",
    instructions: "Avant un objectif de jeu sans enjeu réel, proposez deux stratégies et choisissez-en une à l'unanimité. Partagez une capture du résultat et les deux options en une phrase chacune.",
    rewardFloors: 3,
  },
  {
    title: "La photo de classe du jeu",
    instructions: "Réunissez les participants dans un écran ou un lieu du jeu pour une capture de groupe. Ajoutez une légende de photo de classe absurde ; aucune photo de vraie personne n'est nécessaire.",
    rewardFloors: 2,
  },
  {
    title: "Les experts du détail inutile",
    instructions: "Repérez ensemble un détail étrange dans le jeu, partagez une capture et rédigez un rapport d'enquête de deux phrases, comme si ce détail allait bouleverser la communauté scientifique.",
    rewardFloors: 2,
  },
  {
    title: "La cérémonie de la victoire modeste",
    instructions: "Accomplissez ensemble un petit objectif, puis présentez-le comme une cérémonie officielle. Partagez une capture du jeu et une phrase de discours ; personne n'a besoin de modifier sa sauvegarde ou de dépenser quoi que ce soit.",
    rewardFloors: 3,
  },
] as const satisfies ReadonlyArray<{ title: string; instructions: string; rewardFloors: number }>;
