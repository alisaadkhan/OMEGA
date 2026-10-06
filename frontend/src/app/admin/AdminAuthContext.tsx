import { createContext, useContext, useState, type ReactNode } from "react";

export type AdminRole = "admin" | "support";
export type AdminUser = { name: string; email: string; role: AdminRole };

type Ctx = {
  admin: AdminUser | null;
  signIn: (email: string, _password: string, role: AdminRole) => void;
  signOut: () => void;
};

const AdminAuthContext = createContext<Ctx | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  return (
    <AdminAuthContext.Provider
      value={{
        admin,
        signIn: (email, _p, role) =>
          setAdmin({
            name: role === "admin" ? "Faisal Ahmed" : "Mira Solis",
            email: email || (role === "admin" ? "faisal@mushin.pk" : "mira@mushin.pk"),
            role,
          }),
        signOut: () => setAdmin(null),
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}
