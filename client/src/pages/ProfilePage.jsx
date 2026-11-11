import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { useUserStore } from '../stores/userStore'
import { authApi } from '../lib/api'
import PhoneField from '../components/PhoneField'
import { User, Phone, Mail, Lock, Shield, Calendar, ArrowLeft, Save, Eye, EyeOff, CheckCircle, Pencil, X } from 'lucide-react'

export default function ProfilePage() {
  const navigate = useNavigate()
  const { t, toastSuccess, toastError } = useAppStore()
  const { logout } = useUserStore()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const [editingContact, setEditingContact] = useState(false)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [savingContact, setSavingContact] = useState(false)

  const [editingPassword, setEditingPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)

  useEffect(() => {
    fetchProfile()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep, so only these inputs refetch
  }, [])

  const fetchProfile = async () => {
    try {
      const { data } = await authApi.getProfile()
      setProfile(data)
    } catch (err) {
      console.error('Failed to fetch profile:', err)
      toastError(t('profile.updateFailed'))
    } finally {
      setLoading(false)
    }
  }

  const startEditContact = () => {
    setPhone(profile?.phone || '')
    setEmail(profile?.email || '')
    setEditingContact(true)
  }

  const cancelEditContact = () => {
    setEditingContact(false)
    setPhone('')
    setEmail('')
  }

  const handleContactSave = async () => {
    setSavingContact(true)
    try {
      const { data } = await authApi.updateProfile({ phone, email })
      setProfile(data)
      setEditingContact(false)
      toastSuccess(t('profile.updated'))
    } catch (err) {
      console.error('Failed to update profile:', err)
      toastError(t('profile.updateFailed'))
    } finally {
      setSavingContact(false)
    }
  }

  const startEditPassword = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setEditingPassword(true)
  }

  const cancelEditPassword = () => {
    setEditingPassword(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  const handlePasswordChange = async () => {
    if (newPassword !== confirmPassword) {
      toastError(t('profile.passwordsMismatch'))
      return
    }
    if (newPassword.length < 6) {
      toastError(t('profile.passwordMinLength'))
      return
    }
    setSavingPassword(true)
    try {
      await authApi.changePassword({ currentPassword, newPassword })
      toastSuccess(t('profile.passwordUpdated'))
      setEditingPassword(false)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => {
        logout()
        navigate('/login')
      }, 1000)
    } catch (err) {
      console.error('Failed to change password:', err)
      toastError(err.response?.data?.error || t('profile.updateFailed'))
    } finally {
      setSavingPassword(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
      </div>
    )
  }

  const roleLabels = {
    MANAGER: 'Manager',
    SALES_MANAGER: 'Sales Manager',
    CASHIER: 'Cashier',
    INVENTORY_CLERK: 'Inventory Clerk',
    ACCOUNTANT: 'Accountant',
    HR_MANAGER: 'HR Manager',
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
className="p-2 rounded-xl bg-surface-hover transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{t('profile.title')}</h1>
<p className="text-muted">{t('profile.subtitle')}</p>
        </div>
      </div>

      {/* Profile Card */}
<div className="bg-surface rounded-2xl shadow-sm border border-border overflow-hidden">
        {/* Avatar Header */}
<div className="bg-gradient-to-r from-primary-500 to-primary-600 px-6 py-8">
          <div className="flex items-center gap-4">
<div className="w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-xl">
<span className="text-white font-bold text-3xl">{profile?.full_name?.charAt(0)?.toUpperCase()}</span>
            </div>
<div className="text-white">
              <h2 className="text-2xl font-bold">{profile?.full_name}</h2>
<p className="text-white/80">@{profile?.username}</p>
<span className="inline-block mt-1 px-2.5 py-0.5 bg-white/20 backdrop-blur-sm rounded-lg text-sm font-medium">
                {roleLabels[profile?.role] || profile?.role}
              </span>
            </div>
          </div>
        </div>

        {/* Info Grid */}
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">{t('profile.personalInfo')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoRow icon={User} label={t('profile.fullName')} value={profile?.full_name} />
            <InfoRow icon={User} label={t('profile.username')} value={profile?.username} />
            <InfoRow icon={Shield} label={t('profile.role')} value={roleLabels[profile?.role] || profile?.role} />
            <InfoRow
              icon={CheckCircle}
              label={t('profile.status')}
              value={profile?.is_active ? t('profile.active') : t('profile.inactive')}
valueColor={profile?.is_active ?'text-success':'text-danger'}
            />
            <InfoRow
              icon={Calendar}
              label={t('profile.lastLogin')}
              value={profile?.last_login ? new Date(profile.last_login).toLocaleString() : '-'}
            />
            <InfoRow
              icon={Calendar}
              label={t('profile.memberSince')}
              value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '-'}
            />
          </div>
        </div>
      </div>

      {/* Contact Info */}
<div className="bg-surface rounded-2xl shadow-sm border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
<Phone className="w-5 h-5 text-accent"/>
            {t('profile.contactInfo')}
          </h3>
          {!editingContact && (
            <button
              onClick={startEditContact}
className="flex items-center gap-1.5 px-4 py-2 min-h-[44px] text-sm font-medium text-accent hover:bg-primary-50 rounded-lg transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              {t('common.edit') || 'Edit'}
            </button>
          )}
        </div>

        {editingContact ? (
          <div className="space-y-4">
            <PhoneField
              id="profile-phone"
              label={t('profile.phone')}
              value={phone}
              onChange={setPhone}
              placeholder={t('profile.phonePlaceholder')}
              inputClassName="rounded-xl py-2.5 bg-surface-secondary ring-focus focus:border-transparent outline-none transition-all"
            />
            <div>
<label className="block text-sm font-medium text-foreground mb-1.5">{t('profile.email')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('profile.emailPlaceholder')}
className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary ring-focus focus:border-transparent outline-none transition-all"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleContactSave}
                disabled={savingContact}
className="px-5 py-2.5 bg-accent hover:bg-primary-700 disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {savingContact ? '...' : t('common.save') || 'Save'}
              </button>
              <button
                onClick={cancelEditContact}
className="px-5 py-2.5 bg-surface-tertiary bg-surface-hover text-foreground rounded-xl font-medium transition-colors flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                {t('common.cancel') || 'Cancel'}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoRow icon={Phone} label={t('profile.phone')} value={profile?.phone || '-'} />
            <InfoRow icon={Mail} label={t('profile.email')} value={profile?.email || '-'} />
          </div>
        )}
      </div>

      {/* Change Password */}
<div className="bg-surface rounded-2xl shadow-sm border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
<Lock className="w-5 h-5 text-accent"/>
            {t('profile.changePassword')}
          </h3>
          {!editingPassword && (
            <button
              onClick={startEditPassword}
className="flex items-center gap-1.5 px-4 py-2 min-h-[44px] text-sm font-medium text-accent hover:bg-primary-50 rounded-lg transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              {t('common.edit') || 'Edit'}
            </button>
          )}
        </div>

        {editingPassword ? (
          <div className="space-y-4">
            <div className="relative">
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t('profile.currentPassword')}
className="w-full px-4 py-2.5 pr-10 rounded-xl border border-border bg-surface-secondary ring-focus focus:border-transparent outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-foreground"
              >
                {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('profile.newPassword')}
className="w-full px-4 py-2.5 pr-10 rounded-xl border border-border bg-surface-secondary ring-focus focus:border-transparent outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-foreground"
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('profile.confirmPassword')}
className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary ring-focus focus:border-transparent outline-none transition-all"
            />
            <div className="flex gap-3">
              <button
                onClick={handlePasswordChange}
                disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
className="px-5 py-2.5 bg-accent hover:bg-primary-700 disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
              >
                <Lock className="w-4 h-4" />
                {savingPassword ? '...' : t('profile.changePassword')}
              </button>
              <button
                onClick={cancelEditPassword}
className="px-5 py-2.5 bg-surface-tertiary bg-surface-hover text-foreground rounded-xl font-medium transition-colors flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                {t('common.cancel') || 'Cancel'}
              </button>
            </div>
          </div>
        ) : (
<p className="text-sm text-muted">••••••••</p>
        )}
      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value, valueColor = '' }) {
  return (
<div className="flex items-center gap-3 p-3 rounded-xl bg-surface-secondary">
<div className="w-9 h-9 rounded-lg bg-accent-soft flex items-center justify-center flex-shrink-0">
<Icon className="w-4 h-4 text-accent"/>
      </div>
      <div className="min-w-0">
<p className="text-xs text-muted">{label}</p>
        <p className={`text-sm font-medium truncate ${valueColor}`}>{value || '-'}</p>
      </div>
    </div>
  )
}
