import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type User = {
  id: string;
  username: string;
  displayName: string;
};

type AuthState = {
  token: string | null;
  user: User | null;
  setSession: (token: string, user: User) => void;
  clear: () => void;
};

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      clear: () => set({ token: null, user: null }),
    }),
    { name: 'dpoker-auth' },
  ),
);
