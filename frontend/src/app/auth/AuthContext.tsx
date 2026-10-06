import { createContext, useContext, useState, type ReactNode } from "react";
import { profiles } from "./profiles";

export type AuthUser = { name: string; email: string; avatar: string; initials: string };

type AuthContextValue = {
  user: AuthUser | null;
  login: (email: string, _password: string) => void;
  signup: (name: string, email: string, _password: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  const login = (email: string) => {
    setUser({
      name: profiles.ahmed.name,
      email: email || "ahmed@mushin.pk",
      avatar: profiles.ahmed.avatar,
      initials: profiles.ahmed.initials,
    });
  };

  const signup = (name: string, email: string) => {
    const initials =
      name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("") || "MU";
    setUser({
      name: name || profiles.ayesha.name,
      email: email || "you@mushin.pk",
      avatar: profiles.ayesha.avatar,
      initials,
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        signup,
        logout: () => setUser(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
