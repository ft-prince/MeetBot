import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { User } from '../lib/types'

interface AuthState {
  user: User | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  updateUser: (patch: Partial<User>) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me()
      setUser(user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const signOut = useCallback(async () => {
    await api.logout()
    setUser(null)
    window.location.href = '/signin'
  }, [])

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser(u => (u ? { ...u, ...patch } : u))
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, refresh, signOut, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
