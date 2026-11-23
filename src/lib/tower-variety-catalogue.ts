// Pack « variété » (cahier §8.5 et §9.1) : défis hors jeu et un défi qui accepte une preuve ancienne.
// Lu par /tower-admin importer avec les autres packs solo (déduplication sur le titre).
// `allowsPastProof: true` = preuve antérieure à l'attribution acceptée, affichée explicitement au joueur ;
// le code de preuve n'est alors pas exigé. Les autres défis gardent la règle : preuve postérieure, code exigé.
export const TOWER_VARIETY_SOLO_CHALLENGES = [
  {
    title: "Le dessin du héros",
    instructions:
      "Hors jeu : dessine à la main (papier ou tablette) le personnage d'un jeu que tu aimes, avec ton code de preuve écrit à côté du dessin. Partage une photo du dessin et dis en une phrase pourquoi ce personnage. Preuve postérieure à l'attribution, jamais réutilisée d'un autre défi.",
    rewardFloors: 1,
    allowsPastProof: false,
  },
  {
    title: "La figurine fait maison",
    instructions:
      "Hors jeu : fabrique un petit objet inspiré d'un jeu avec ce que tu as chez toi (papier, carton, pâte à modeler, briques), sans rien acheter. Photographie-le avec ton code de preuve écrit à côté. Preuve postérieure à l'attribution, jamais réutilisée d'un autre défi.",
    rewardFloors: 2,
    allowsPastProof: false,
  },
  {
    title: "Le souvenir de jeu",
    instructions:
      "Preuve ancienne acceptée : partage une capture ou une photo d'un de tes meilleurs souvenirs de jeu, même prise avant ce défi, et raconte en deux phrases pourquoi il compte pour toi. Le code de preuve n'est pas exigé pour ce défi. Une capture déjà utilisée pour un autre défi n'est jamais acceptée.",
    rewardFloors: 1,
    allowsPastProof: true,
  },
];
