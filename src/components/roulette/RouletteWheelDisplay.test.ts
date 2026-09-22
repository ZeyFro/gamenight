import { describe, expect, it } from "vitest";
import { labelIsFlipped, labelLayout, labelRotationDeg, segmentCenterAngle } from "./RouletteWheelDisplay";

/**
 * Bug remonté en test réel — libellés mal orientés, chevauchant au
 * centre, illisibles. Couvre la géométrie PURE (jamais le rendu DOM,
 * absent de l'outillage de ce dépôt — voir le composant pour la
 * vérification visuelle via Playwright, documentée dans la PR).
 */
describe("RouletteWheelDisplay — géométrie des libellés", () => {
  describe("labelRotationDeg — corrige le décalage de 90° (bug remonté)", () => {
    it("secteur tout en haut (angle 0°, convention conic-gradient) : le libellé pointe vers le haut (-90°), jamais vers la droite (0°)", () => {
      expect(labelRotationDeg(0)).toBe(-90);
    });

    it("secteur à droite (angle 90°) : le libellé pointe vers la droite (0°, non pivoté)", () => {
      expect(labelRotationDeg(90)).toBe(0);
    });

    it("secteur en bas (angle 180°) : le libellé pointe vers le bas (90°, jamais retourné — pile la frontière)", () => {
      expect(labelRotationDeg(180)).toBe(90);
    });

    it("secteur à gauche (angle 270°) : +180 supplémentaire (retournement) pour ne jamais rendre le texte tête en bas", () => {
      // Sans le +180 : 270-90 = 180° (texte à l'envers, bug trouvé à la
      // vérification visuelle Playwright). Avec : 270-90+180 = 360°.
      expect(labelRotationDeg(270)).toBe(360);
    });
  });

  describe("labelIsFlipped — jamais un libellé tête en bas (bug trouvé à la vérification visuelle Playwright)", () => {
    it("moitié droite du disque (0° à 180°) : jamais retourné", () => {
      expect(labelIsFlipped(0)).toBe(false);
      expect(labelIsFlipped(90)).toBe(false);
      expect(labelIsFlipped(180)).toBe(false);
    });

    it("moitié gauche du disque (180° à 360°) : toujours retourné, pour rester lisible", () => {
      expect(labelIsFlipped(181)).toBe(true);
      expect(labelIsFlipped(270)).toBe(true);
      expect(labelIsFlipped(359)).toBe(true);
    });
  });

  describe("segmentCenterAngle — même convention que la roue (conic-gradient, 0° = haut, horaire)", () => {
    it("4 secteurs : centres à 45°, 135°, 225°, 315° — jamais alignés sur les bornes 0/90/180/270", () => {
      expect(segmentCenterAngle(0, 4)).toBe(45);
      expect(segmentCenterAngle(1, 4)).toBe(135);
      expect(segmentCenterAngle(2, 4)).toBe(225);
      expect(segmentCenterAngle(3, 4)).toBe(315);
    });

    it("cohérent avec le rendu conic-gradient (i * segmentPercent%) — angle = pourcentage * 3.6", () => {
      const segmentCount = 8;
      for (let i = 0; i < segmentCount; i++) {
        const segmentPercent = 100 / segmentCount;
        const gradientStartAngle = i * segmentPercent * 3.6;
        const gradientEndAngle = (i + 1) * segmentPercent * 3.6;
        const center = segmentCenterAngle(i, segmentCount);
        expect(center).toBeGreaterThanOrEqual(gradientStartAngle);
        expect(center).toBeLessThanOrEqual(gradientEndAngle);
      }
    });
  });

  describe("labelLayout — s'adapte au nombre de secteurs, jamais à la taille de rendu", () => {
    it("peu de secteurs (2, ex. duel à 2 jeux) : police pleine taille, libellés larges", () => {
      const { fontSizePx, startPercent, widthPercent } = labelLayout(2);
      expect(fontSizePx).toBeCloseTo(11, 5);
      expect(startPercent).toBeLessThan(10);
      expect(widthPercent).toBeGreaterThan(30);
    });

    it("beaucoup de secteurs (16, groupe nombreux) : police réduite, libellés plus étroits, départ plus loin du centre — jamais un chevauchement", () => {
      const few = labelLayout(4);
      const many = labelLayout(16);
      expect(many.fontSizePx).toBeLessThan(few.fontSizePx);
      expect(many.widthPercent).toBeLessThan(few.widthPercent);
      expect(many.startPercent).toBeGreaterThanOrEqual(few.startPercent);
    });

    it("bornes jamais dépassées même pour un nombre extrême de secteurs (police jamais illisible, largeur jamais négative)", () => {
      const extreme = labelLayout(40);
      expect(extreme.fontSizePx).toBeGreaterThanOrEqual(7);
      expect(extreme.widthPercent).toBeGreaterThanOrEqual(16);
      expect(extreme.startPercent).toBeLessThanOrEqual(14);
    });

    it("un seul secteur (edge case défensif — jamais un plantage)", () => {
      const layout = labelLayout(1);
      expect(layout.fontSizePx).toBeGreaterThan(0);
      expect(layout.widthPercent).toBeGreaterThan(0);
    });
  });
});
