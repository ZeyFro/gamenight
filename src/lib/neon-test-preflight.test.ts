import { describe, expect, it } from "vitest";
import { REQUIRED_DDL_TABLES, validateConnectionRoles, validatePrivilegeReport } from "../../scripts/neon-test-preflight.mjs";
const roles = {runtimeRole:"runtime",migrationRole:"migration"};
const report = () => ({identity:{project:"misty-tooth-45335023",branch:"br-snowy-snow-b1cggq2w",db:"neondb",role:"migration"},role:{rolcanlogin:true,rolinherit:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false},memberships:0,owners:REQUIRED_DDL_TABLES.map(relname=>({relname,owned:true})),enumOwned:true,privileges:Object.fromEntries(["schema_create","schema_usage","user_id_select","user_id_references","community_id_references","history_select","history_insert","history_update_logs","history_update_finished","history_update_steps","runtime_new_table_dml"].map(k=>[k,true]))});
describe("préflight de migration test : contrôles de privilèges sans élargissement",()=>{
  it("refuse le rôle partagé et une configuration manquante",()=>{
    expect(()=>validateConnectionRoles("postgresql://migration:fixture@127.0.0.1/neondb?sslmode=require","migration","migration")).toThrow("must_differ");
    expect(()=>validateConnectionRoles("","runtime","migration")).toThrow("missing");
  });
  it("refuse un login inattendu sans reproduire le secret",()=>{
    expect(()=>validateConnectionRoles("postgresql://owner:fixture@127.0.0.1/neondb?sslmode=require","runtime","migration")).toThrow("wrong_migration_login");
  });
  it("accepte uniquement la cible et le rôle restreint attendus",()=>{
    expect(()=>validatePrivilegeReport(report(),roles)).not.toThrow();
    const data=report();data.identity.branch="another-branch";
    expect(()=>validatePrivilegeReport(data,roles)).toThrow("wrong_test_identity");
  });
  it.each(["rolsuper","rolcreatedb","rolcreaterole","rolreplication","rolbypassrls","rolinherit"] as const)("refuse le privilège global %s",key=>{
    const data=report();data.role[key]=true;
    expect(()=>validatePrivilegeReport(data,roles)).toThrow("too_privileged");
  });
  it("refuse les appartenances à d'autres rôles",()=>{const data=report();data.memberships=1;expect(()=>validatePrivilegeReport(data,roles)).toThrow("too_privileged");});
  it("refuse un simple CREATE sans ownership ALTER TABLE/INDEX",()=>{const data=report();data.owners[0].owned=false;expect(()=>validatePrivilegeReport(data,roles)).toThrow("ddl_ownership");});
  it("refuse l'absence de propriété de l'enum",()=>{const data=report();data.enumOwned=false;expect(()=>validatePrivilegeReport(data,roles)).toThrow("enum_ownership");});
  it("refuse les droits FK ou la continuité des droits runtime manquants",()=>{
    for(const key of ["user_id_references","history_update_steps","runtime_new_table_dml"]){const data=report();data.privileges[key]=false;expect(()=>validatePrivilegeReport(data,roles)).toThrow("missing_required_privilege");}
  });
});
