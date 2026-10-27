import type {Metadata} from "next";
import {redirect} from "next/navigation";
import {requireAdmin} from "@/lib/admin";
import TowerContentAuditClient from "@/components/admin/TowerContentAuditClient";
export const metadata:Metadata={title:"Audit du contenu — The Tower | GameNight"};
export default async function Page(){
 const admin=await requireAdmin();
 if(!admin||admin.discordId!=="699223334046531636")redirect("/");
 return <TowerContentAuditClient/>;
}