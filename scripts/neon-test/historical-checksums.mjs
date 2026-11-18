// Sept variantes historiques prouvées par le run 43391940334.
// Empreintes recalculées à partir des SQL scellés LF et de leur seule conversion CRLF.
// Aucune exception pour une autre migration ou une autre référence canonique.
const historical = {
  "20261026180000_community_teams": {
    "lf": "351ea956c1ef0b02fe6ddcc848c00dd8fa153afe4be0f38e290611b3fa31346d",
    "crlf": "3934bad533d1fff08ef839dbc355e6b00d7ac9fd16611101d4e2038ca5b9a81c"
  },
  "20261026190000_session_community_team": {
    "lf": "269810ec255fd4a56386072238a5f1fcec2e2f90e51f0da7ab172d2c5dd31cd1",
    "crlf": "5d9208feb65156f8ec1de61b575983777fb09b6a222d619e1fb8b17b143e0d61"
  },
  "20261026210000_tower_levels_per_floor": {
    "lf": "7e508ebfc6d03f0bfae99cd90e54d528536d79e6cbf75812adfeaf0ea85148fa",
    "crlf": "5069520756e8305eb4811d4721ed3563b797c9534dfe0069a4998949ba9d7969"
  },
  "20261026220000_community_team_game_restrict": {
    "lf": "9f4a7c76e4fbd1c212966a05be1ad1e833ee43f50a5b22f59906db493118cff3",
    "crlf": "a3ea0735fcf57860befadd1a0baa3596456bcefa0f3d3dc74f99d381b2d54445"
  },
  "20261028140000_tower_challenges": {
    "lf": "a76fc18f0506f4e270d12361ffc66bea00d3451f85f490c0467e9ec4a607e91c",
    "crlf": "1889282c4ff910800753ed6e646d485f91968155b637b48e0ea196d699f1b48a"
  },
  "20261028230000_tower_season_vote": {
    "lf": "8481888be4e252ea332159cb5adc04fae254b558aabc37446bd73bed0a3cbaf0",
    "crlf": "8152c958ac1fa81b1286b6d671ff5ed7d769ecdc7873a501731d675a42844f49"
  },
  "20261029061000_tower_team_challenges": {
    "lf": "a1ea7629df063da7789c4b0b611dd43f4e0f912ac6fb4753fdc17fd67f8818c4",
    "crlf": "2ed0d7a1c2384ff9e1247949d3cb58d6791a82e79ce4327c94b34bfe8743d448"
  }
};

export function matchesMigrationChecksum(name, actual, expected) {
  if (actual === expected) return true;
  if (!Object.hasOwn(historical, name)) return false;
  const approved = historical[name];
  return expected === approved.lf && actual === approved.crlf;
}
