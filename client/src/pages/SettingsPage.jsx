import { Save, Store, Percent, Receipt, AlertTriangle, Globe, Star, Upload, X, MapPin, Navigation } from 'lucide-react'
import SearchableSelect from '../components/SearchableSelect'
import PhoneField from '../components/PhoneField'
import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { settingsApi } from '../lib/api'
import { languageNames } from '../lib/translations'

export default function SettingsPage() {
  const { settings, updateSettings, language, setLanguage, t, toastSuccess, toastError } = useAppStore()
  const [formData, setFormData] = useState(settings)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    settingsApi.getAll().then(({ data }) => {
      if (data) {
        setFormData(prev => ({ ...prev, ...data }))
        updateSettings(data)
      }
    }).catch(() => {})
  }, [updateSettings])

  const handleChange = (e) => {
    const { name, value, type } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) || 0 : value,
    }))
  }

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 512 * 1024) {
      toastError(t('settings.logoTooLarge') || 'Logo must be under 512KB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setFormData(prev => ({ ...prev, storeLogo: reader.result }))
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveLogo = () => {
    setFormData(prev => ({ ...prev, storeLogo: '' }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await settingsApi.update(formData)
      updateSettings(formData)
      toastSuccess(t('settings.saved'))
    } catch (err) {
      console.error('Failed to save settings:', err)
      toastError(t('common.error') || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
<p className="text-muted">{t('settings.storeInfo')}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Language Settings */}
<div className="bg-surface-secondary rounded-xl border border-border shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
<div className="p-2 bg-accent-soft rounded-lg">
<Globe className="w-5 h-5 text-accent"/>
            </div>
            <h2 className="text-lg font-semibold">{t('nav.language')}</h2>
          </div>

          <div className="flex gap-3 flex-wrap">
            {Object.entries(languageNames).map(([code, name]) => (
              <button
                key={code}
                type="button"
                onClick={() => setLanguage(code)}
                className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                  language === code
?'bg-accent text-white'
:'bg-surface-tertiary text-foreground bg-surface-hover'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Store Information */}
<div className="bg-surface-secondary rounded-xl border border-border shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
<div className="p-2 bg-accent-soft rounded-lg">
<Store className="w-5 h-5 text-accent"/>
            </div>
            <h2 className="text-lg font-semibold">{t('settings.storeInfo')}</h2>
          </div>

          <div className="space-y-4">
            {/* Store Logo */}
            <div>
<label className="block text-sm font-medium text-foreground mb-2">
                {t('settings.storeLogo') || 'Store Logo'}
              </label>
              <div className="flex items-center gap-4">
<div className="w-20 h-20 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-lg overflow-hidden flex-shrink-0">
                  {formData.storeLogo ? (
                    <img src={formData.storeLogo} alt="Logo" className="w-full h-full object-cover" />
                  ) : (
<Store className="w-8 h-8 text-white"/>
                  )}
                </div>
                <div className="flex-1 space-y-2">
<label className="flex items-center gap-2 px-4 py-2 bg-surface-tertiary bg-surface-hover rounded-lg cursor-pointer text-sm font-medium transition-colors">
                    <Upload className="w-4 h-4" />
                    {t('settings.uploadLogo') || 'Upload Logo'}
                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  </label>
                  {formData.storeLogo && (
<button type="button"onClick={handleRemoveLogo}className="flex items-center gap-2 px-4 py-2 text-sm text-danger hover:bg-red-50 rounded-lg transition-colors">
                      <X className="w-4 h-4" />
                      {t('settings.removeLogo') || 'Remove Logo'}
                    </button>
                  )}
<p className="text-xs text-muted">{t('settings.logoHint')||'PNG,JPG,SVG. Max 512KB.'}</p>
                </div>
              </div>
            </div>

            <div>
<label className="block text-sm font-medium text-foreground mb-1">
                {t('settings.storeName')}
              </label>
              <input
                type="text"
                name="storeName"
                value={formData.storeName}
                onChange={handleChange}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
                placeholder={t('settings.storeName')}
              />
            </div>

            <div>
<label className="block text-sm font-medium text-foreground mb-1">
                {t('settings.storeAddress')}
              </label>
              <textarea
                name="storeAddress"
                value={formData.storeAddress}
                onChange={handleChange}
                rows={2}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
                placeholder={t('settings.storeAddress')}
              />
            </div>

            <div>
<label className="block text-sm font-medium text-foreground mb-1">
                {t('settings.storePhone')}
              </label>
              <PhoneField
                id="store-phone"
                label={t('settings.storePhone')}
                value={formData.storePhone || ''}
                onChange={(full) => setFormData(prev => ({ ...prev, storePhone: full }))}
              />
            </div>
          </div>
        </div>

        {/* Tax Settings */}
<div className="bg-surface-secondary rounded-xl border border-border shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
<div className="p-2 bg-warning-soft rounded-lg">
<Percent className="w-5 h-5 text-warning"/>
            </div>
            <h2 className="text-lg font-semibold">{t('settings.taxRate')}</h2>
          </div>

          <div>
<label className="block text-sm font-medium text-foreground mb-1">
              {t('settings.taxRate')}
            </label>
            <input
              type="number"
              name="taxRate"
              value={formData.taxRate}
              onChange={handleChange}
              min="0"
              max="100"
              step="0.1"
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
            />
<p className="mt-1 text-sm text-muted">
              {t('settings.currentRate')}{formData.taxRate}%{t('settings.egyptVat')}
            </p>
          </div>
        </div>

        {/* Currency Settings */}
<div className="bg-surface-secondary rounded-xl border border-border shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
<div className="p-2 bg-success-soft rounded-lg">
<Receipt className="w-5 h-5 text-success"/>
            </div>
            <h2 className="text-lg font-semibold">{t('settings.currency')}</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
<label className="block text-sm font-medium text-foreground mb-1">
                {t('settings.currency')}
              </label>
              <input
                type="text"
                name="currency"
                value={formData.currency}
                onChange={handleChange}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
              />
            </div>
            <div>
<label className="block text-sm font-medium text-foreground mb-1">
                {t('settings.currency')}{t('settings.symbol')}
              </label>
              <input
                type="text"
                name="currencySymbol"
                value={formData.currencySymbol}
                onChange={handleChange}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
              />
            </div>
          </div>
        </div>

        {/* Receipt Settings */}
<div className="bg-surface-secondary rounded-xl border border-border shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
<div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
<Receipt className="w-5 h-5 text-purple-600"/>
            </div>
            <h2 className="text-lg font-semibold">{t('settings.receiptSettings')}</h2>
          </div>

          <div>
<label className="block text-sm font-medium text-foreground mb-1">
              {t('settings.receiptFooter')}
            </label>
            <textarea
              name="receiptFooter"
              value={formData.receiptFooter}
              onChange={handleChange}
              rows={2}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
              placeholder={t('receipt.thankYou')}
            />
          </div>
        </div>

        {/* Inventory Settings */}
<div className="bg-surface-secondary rounded-xl border border-border shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
<div className="p-2 bg-danger-soft rounded-lg">
<AlertTriangle className="w-5 h-5 text-danger"/>
            </div>
            <h2 className="text-lg font-semibold">{t('settings.lowStockThreshold')}</h2>
          </div>

          <div>
<label className="block text-sm font-medium text-foreground mb-1">
              {t('settings.lowStockThreshold')}
            </label>
            <input
              type="number"
              name="lowStockThreshold"
              value={formData.lowStockThreshold}
              onChange={handleChange}
              min="0"
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
            />
<p className="mt-1 text-sm text-muted">
              {t('settings.lowStockHelper')}
            </p>
          </div>
        </div>

        {/* Loyalty Points Settings */}
<div className="bg-surface-secondary rounded-xl border border-border shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
<div className="p-2 bg-warning-soft rounded-lg">
<Star className="w-5 h-5 text-warning"/>
            </div>
            <h2 className="text-lg font-semibold">{t('settings.loyaltyPoints')}</h2>
          </div>

          <div>
<label className="block text-sm font-medium text-foreground mb-1">
              {t('settings.loyaltyPointsPerCurrency')}
            </label>
            <input
              type="number"
              name="loyaltyPointsPerCurrency"
              value={formData.loyaltyPointsPerCurrency || 0}
              onChange={handleChange}
              min="0"
              step="0.1"
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
            />
<p className="mt-1 text-sm text-muted">
              {t('settings.loyaltyPointsDesc')} {t('settings.loyaltyHelper')}
            </p>
          </div>
        </div>

        {/* Attendance Settings */}
<div className="bg-surface-secondary rounded-xl border border-border shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
<div className="p-2 bg-success-soft rounded-lg">
<MapPin className="w-5 h-5 text-success"/>
            </div>
            <h2 className="text-lg font-semibold">{t('settings.attendance') || 'Attendance'}</h2>
          </div>

          <div className="space-y-4">
            <div>
<label className="block text-sm font-medium text-foreground mb-1">
                {t('settings.lateGraceMinutes') || 'Late Grace Minutes'}
              </label>
              <input
                type="number"
                name="attendance.lateGraceMinutes"
                value={formData['attendance.lateGraceMinutes'] || 5}
                onChange={handleChange}
                min="0"
                max="60"
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
              />
<p className="mt-1 text-sm text-muted">
                {t('settings.lateGraceMinutesHelper') || 'Minutes after shift start before marking as late'}
              </p>
            </div>

<div className="flex items-center justify-between p-4 bg-surface-secondary rounded-lg border border-border">
              <div>
<label className="text-sm font-medium text-foreground">
                  {t('settings.enableGeolocation') || 'Enable Geolocation'}
                </label>
<p className="text-xs text-muted mt-0.5">
                  {t('settings.enableGeolocationHelper') || 'Require GPS check-in for clock in/out'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, 'attendance.enableGeolocation': prev['attendance.enableGeolocation'] === 'true' || prev['attendance.enableGeolocation'] === true ? 'false' : 'true' }))}
className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 ${formData['attendance.enableGeolocation']==='true'|| formData['attendance.enableGeolocation']===true ?'bg-accent shadow-inner':'bg-surface-tertiary'}`}
              >
<span className={`absolute top-1 h-5 w-5 rounded-full bg-surface shadow-sm transition-all duration-200 ${formData['attendance.enableGeolocation']==='true'|| formData['attendance.enableGeolocation']===true ?'start-[26px]':'start-1'}`}/>
              </button>
            </div>

            <div>
<label className="block text-sm font-medium text-foreground mb-1">
                {t('settings.requiredRadius') || 'Required Radius (meters)'}
              </label>
              <input
                type="number"
                name="attendance.requiredRadiusMeters"
                value={formData['attendance.requiredRadiusMeters'] || 100}
                onChange={handleChange}
                min="10"
                max="1000"
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
              />
<p className="mt-1 text-sm text-muted">
                {t('settings.requiredRadiusHelper') || 'Maximum allowed distance from store for GPS check-in'}
              </p>
            </div>

<div className="bg-surface-secondary rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
<label className="text-sm font-medium text-foreground">
                    {t('settings.storeLocation') || 'Store Location'}
                  </label>
<p className="text-xs text-muted">
                    {t('settings.storeLocationHelper') || 'GPS coordinates for geolocation check-in'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!navigator.geolocation) {
                      toastError(t('settings.geolocationNotSupported') || 'Geolocation is not supported by your browser')
                      return
                    }
                    navigator.geolocation.getCurrentPosition(
                      (pos) => {
                        const lat = pos.coords.latitude.toFixed(4)
                        const lng = pos.coords.longitude.toFixed(4)
                        setFormData(prev => ({
                          ...prev,
                          'attendance.storeLatitude': lat,
                          'attendance.storeLongitude': lng,
                        }))
                        toastSuccess(t('settings.locationCaptured') || 'Location captured successfully')
                      },
                      (err) => {
                        toastError(t('settings.locationFailed') || 'Failed to get location: ' + err.message)
                      },
                      { enableHighAccuracy: true, timeout: 10000 }
                    )
                  }}
className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-accent-soft-foreground bg-accent-soft rounded-lg hover:bg-primary-100 transition min-h-[44px]"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  {t('settings.useMyLocation') || 'Use My Location'}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
<label className="block text-xs font-medium text-muted mb-1">
                    {t('settings.latitude') || 'Latitude'}
                  </label>
                  <input
                    type="number"
                    name="attendance.storeLatitude"
                    value={formData['attendance.storeLatitude'] || '30.0444'}
                    onChange={handleChange}
                    step="0.0001"
className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
                  />
                </div>
                <div>
<label className="block text-xs font-medium text-muted mb-1">
                    {t('settings.longitude') || 'Longitude'}
                  </label>
                  <input
                    type="number"
                    name="attendance.storeLongitude"
                    value={formData['attendance.storeLongitude'] || '31.2357'}
                    onChange={handleChange}
                    step="0.0001"
className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
                  />
                </div>
              </div>
              {(formData['attendance.storeLatitude'] && formData['attendance.storeLongitude']) && (
                <a
                  href={`https://www.google.com/maps?q=${formData['attendance.storeLatitude']},${formData['attendance.storeLongitude']}`}
                  target="_blank"
                  rel="noopener noreferrer"
className="inline-flex items-center gap-1 mt-2 text-xs text-accent hover:underline"
                >
                  <MapPin className="w-3 h-3" />
                  {t('settings.viewOnMap') || 'View on Google Maps'}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* ETA Integration Settings */}
<div className="bg-surface-secondary rounded-xl border border-border shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
<div className="p-2 bg-accent-soft rounded-lg">
<Receipt className="w-5 h-5 text-accent"/>
            </div>
            <h2 className="text-lg font-semibold">{t('settings.etaIntegration') || 'ETA Integration (Egyptian Tax Authority)'}</h2>
          </div>

          <div className="space-y-4">
<div className="flex items-center gap-3 p-3 bg-warning-soft rounded-lg">
<AlertTriangle className="w-4 h-4 text-warning flex-shrink-0"/>
<p className="text-sm text-warning">
                {t('settings.etaWarning') || 'Register your POS system on ETA portal to get credentials. Required for B2C e-receipt compliance.'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
<label className="block text-sm font-medium text-foreground mb-1">
                  {t('settings.etaClientId') || 'Client ID'}
                </label>
                <input
                  type="text"
                  name="eta_client_id"
                  value={formData.eta_client_id || ''}
                  onChange={handleChange}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
                  placeholder="d0394a9f-..."
                />
              </div>
              <div>
<label className="block text-sm font-medium text-foreground mb-1">
                  {t('settings.etaClientSecret') || 'Client Secret'}
                </label>
                <input
                  type="password"
                  name="eta_client_secret"
                  value={formData.eta_client_secret || ''}
                  onChange={handleChange}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
                  placeholder="6d62315e-..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
<label className="block text-sm font-medium text-foreground mb-1">
                  {t('settings.etaPosSerial') || 'POS Serial Number'}
                </label>
                <input
                  type="text"
                  name="eta_pos_serial"
                  value={formData.eta_pos_serial || ''}
                  onChange={handleChange}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
                  placeholder="1234567899"
                />
              </div>
              <div>
<label className="block text-sm font-medium text-foreground mb-1">
                  {t('settings.etaRegistrationNumber') || 'Registration Number (RIN)'}
                </label>
                <input
                  type="text"
                  name="eta_registration_number"
                  value={formData.eta_registration_number || ''}
                  onChange={handleChange}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
                  placeholder="674859545"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
<label className="block text-sm font-medium text-foreground mb-1">
                  {t('settings.etaActivityCode') || 'Taxpayer Activity Code'}
                </label>
                <input
                  type="text"
                  name="eta_activity_code"
                  value={formData.eta_activity_code || ''}
                  onChange={handleChange}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
                  placeholder="4711"
                />
              </div>
              <div>
<label className="block text-sm font-medium text-foreground mb-1">
                  {t('settings.etaGovernate') || 'Governorate'}
                </label>
                <input
                  type="text"
                  name="eta_store_governate"
                  value={formData.eta_store_governate || ''}
                  onChange={handleChange}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
                  placeholder="Cairo"
                />
              </div>
            </div>

            <div>
<label className="block text-sm font-medium text-foreground mb-1">
                {t('settings.etaAutoSubmit') || 'Auto-submit receipts to ETA'}
              </label>
              <SearchableSelect
                options={[
                  { value: 'disabled', label: t('settings.etaDisabled') || 'Disabled' },
                  { value: 'enabled', label: t('settings.etaEnabled') || 'Enabled (submit on every sale)' },
                  { value: 'manual', label: t('settings.etaManual') || 'Manual (submit from invoice)' },
                ]}
                value={formData.eta_auto_submit || 'disabled'}
                onChange={(v) => setFormData(prev => ({ ...prev, eta_auto_submit: v }))}
                placeholder={t('common.searchSelect')}
              />
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
className="flex items-center gap-2 px-6 py-3 bg-accent text-white rounded-lg hover:bg-primary-700 bg-surface-tertiary disabled:cursor-not-allowed"
          >
            <Save className="w-5 h-5" />
            {saving ? t('common.loading') : t('settings.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
