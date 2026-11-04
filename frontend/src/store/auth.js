import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Access token lives in memory only; the refresh token is an httpOnly cookie set by the API.
export const useAuth = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      propertyId: null,
      setSession: ({ accessToken, user }) =>
        set((s) => {
          const u = user || s.user;
          const keep = s.propertyId && u?.properties?.some((p) => p._id === s.propertyId);
          return { token: accessToken, user: u, propertyId: keep ? s.propertyId : u?.properties?.[0]?._id || null };
        }),
      setToken: (token) => set({ token }),
      setProperty: (propertyId) => set({ propertyId }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'ps-auth', partialize: (s) => ({ user: s.user, propertyId: s.propertyId }) },
  ),
);

export function can(user, perm) {
  if (!user) return false;
  const p = user.permissions || [];
  const [mod, action] = perm.split(':');
  return p.includes('*') || p.includes(perm) || p.includes(`${mod}:*`) || p.includes(`*:${action}`);
}
export const canAny = (user, perms = []) => perms.some((p) => can(user, p));
export const hasRole = (user, ...keys) => Boolean(user?.roles?.some((r) => keys.includes(r.key)));
export const isFieldUser = (user) => user?.layout === 'field';
