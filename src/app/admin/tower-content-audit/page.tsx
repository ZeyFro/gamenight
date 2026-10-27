import type {Metadata} from "next";
import Link from "next/link";
import {requireAdmin} from "@/lib/admin";
import TowerContentAuditClient from "@/components/admin/TowerContentAuditClient";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Audit du contenu — The Tower | GameNight"};
export default async function Page(){
 const admin=await requireAdmin();
 if(!admin||admin.discordId!=="699223334046531636"){
  return <main style={{maxWidth:780,margin:"3rem auto",padding:24}}>
   <h1>🔒 Audit The Tower — connexion requise</h1>
   <p>Cette page existe, mais ton compte GameNight n’est pas reconnu comme le propriétaire Discord autorisé pour cet audit.</p>
   <p>Connecte-toi à GameNight avec le compte Discord propriétaire du serveur The Tower, puis ouvre à nouveau cette adresse.</p>
   <p>Si tu es déjà connecté avec le bon compte, signale-moi ce message : je vérifierai la configuration d’accès sans exposer ni désactiver les protections.</p>
   <Link href="/" style={{textDecoration:"underline"}}>Retour à l’accueil GameNight</Link>
  </main>;
 }
 return <TowerContentAuditClient/>;
}
