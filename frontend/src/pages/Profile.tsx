import { useState } from 'react'
import { Topbar } from '../components/Topbar'
import { Toggle } from '../components/Toggle'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'

export function Profile() {
  const { user, signOut, updateUser } = useAuth()

  const [enabled, setEnabled] = useState((user?.autoJoinMinutes || 0) > 0)
  const [mins, setMins] = useState(user?.autoJoinMinutes && user.autoJoinMinutes > 0 ? user.autoJoinMinutes : 3)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  if (!user) {
    return (
      <>
        <Topbar title="Profile" subtitle="Account settings and preferences" />
        <div className="p-8">
          <div className="card p-8 max-w-md text-center">
            <p className="text-muted mb-4">Sign in to manage your profile and settings.</p>
            <a href="/auth/google" className="btn btn-primary">Connect Google Account</a>
          </div>
        </div>
      </>
    )
  }

  const ini = user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const autoStatus = (user.autoJoinMinutes || 0) > 0 ? `${user.autoJoinMinutes} min before` : 'Disabled'

  const save = async () => {
    setSaving(true); setSaved(false)
    const value = enabled ? mins : 0
    try {
      await api.updateSettings(value)
      updateUser({ autoJoinMinutes: value })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      alert('Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Topbar title="Profile" subtitle="Account settings and preferences" />
      <div className="p-8 flex-1">
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
          {/* User card */}
          <div className="card p-7">
            <div className="w-[72px] h-[72px] rounded-full bg-gradient-to-br from-accent to-amber-500 flex items-center justify-center text-white text-2xl font-bold mb-5 overflow-hidden">
              {user.picture ? <img src={user.picture} alt="" className="w-full h-full object-cover" /> : ini}
            </div>
            <div className="text-lg font-bold mb-1">{user.name}</div>
            <div className="text-sm text-muted mb-6">{user.email}</div>
            <div className="border-t border-gray-200">
              <Row label="Account type" value="Google" />
              <Row
                label="Auto-bot join"
                value={autoStatus}
                valueClass={(user.autoJoinMinutes || 0) > 0 ? 'text-success font-semibold' : 'text-muted'}
              />
            </div>
            <button onClick={signOut} className="btn btn-secondary btn-sm mt-6 w-full justify-center">Sign out</button>
          </div>

          {/* Settings */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-200 bg-app-bg font-bold text-sm flex items-center gap-2">
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
              </svg>
              Auto-Bot Settings
            </div>

            <div className="px-5">
              <div className="flex items-center justify-between py-5 border-b border-gray-200">
                <div>
                  <div className="text-sm font-semibold">Enable Auto-Bot Join</div>
                  <div className="text-xs text-muted mt-1">Bot automatically joins meetings from your Google Calendar at the scheduled time.</div>
                </div>
                <Toggle on={enabled} onChange={setEnabled} />
              </div>

              <div className={`flex items-center justify-between py-5 ${!enabled ? 'opacity-45 pointer-events-none' : ''}`}>
                <div>
                  <div className="text-sm font-semibold">Minutes Before Meeting</div>
                  <div className="text-xs text-muted mt-1">How many minutes early the bot joins before each meeting starts.</div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <input
                    type="range" min={1} max={15} value={mins}
                    onChange={e => setMins(parseInt(e.target.value))}
                    className="w-28 accent-accent cursor-pointer"
                  />
                  <span className="text-sm font-bold text-accent min-w-[55px] text-right">{mins} min</span>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-200 bg-app-bg">
              <button
                onClick={save}
                disabled={saving}
                className={`btn ${saved ? 'btn-success' : 'btn-primary'} w-full justify-center`}
              >
                {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function Row({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between items-center text-sm py-3 border-b border-gray-200 last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  )
}
