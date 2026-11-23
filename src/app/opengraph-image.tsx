import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site-metadata";

/**
 * Image d'aperçu du lien dans Discord (constat 3.1) : 1200×630, fond sombre aux couleurs de l'application (#8b5cf6),
 * police par défaut, aucun appel réseau, aucune donnée de compte. Servie sans connexion (l'aperçu est lu par un robot).
 */
export const alt = "GameNight : l'appli des soirées jeux de The Tower";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          background: "linear-gradient(135deg, #0b0b14 0%, #1b1033 100%)",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", fontSize: 28, letterSpacing: 6, color: "#a78bfa", textTransform: "uppercase" }}>The Tower</div>
        <div style={{ display: "flex", fontSize: 140, fontWeight: 800, marginTop: 16 }}>{SITE_NAME}</div>
        <div style={{ display: "flex", fontSize: 44, color: "#d4d4e8", marginTop: 24 }}>{SITE_TAGLINE}</div>
        <div style={{ display: "flex", fontSize: 30, color: "#8b5cf6", marginTop: 48 }}>Votes · tournois · défis · classements</div>
      </div>
    ),
    { ...size },
  );
}
