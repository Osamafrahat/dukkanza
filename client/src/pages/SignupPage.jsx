import { Alert, Button, Card, InputGroup, ProgressBar } from '@heroui/react'
import { Store, User, Lock, Mail, AtSign, AlertCircle, CheckCircle, Circle, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useUserStore } from '../stores/userStore'
import { useAppStore } from '../stores/appStore'
import api from '../lib/api'
import PhoneField from '../components/PhoneField'
import { parseFullPhone } from '../lib/phone'

export default function SignupPage() {
  const { t, settings } = useAppStore()
  const { login } = useUserStore()
  const navigate = useNavigate()

  const [storeName, setStoreName] = useState('')
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  // Full number ('+201012345678'); PhoneField splits it into dial code +
  // digits while typing, so signup stores the exact shape the customer and
  // profile screens already write.
  const [phone, setPhone] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [checks, setChecks] = useState({
    length: false,
    upper: false,
    lower: false,
    digit: false,
  })

  const validatePassword = (pw) => {
    setChecks({
      length: pw.length >= 8,
      upper: /[A-Z]/.test(pw),
      lower: /[a-z]/.test(pw),
      digit: /[0-9]/.test(pw),
    })
  }

  const handlePasswordChange = (e) => {
    const pw = e.target.value
    setPassword(pw)
    validatePassword(pw)
  }

  const isPasswordValid = Object.values(checks).every(Boolean)

  // Strength is just how many rules are met (0-4) — no separate scoring
  // rules that could drift from the validation above. Each step maps to a
  // semantic colour + label so the bar and the chips tell the same story.
  const metCount = Object.values(checks).filter(Boolean).length
  const strength = [
    { color: 'danger', label: t('signup.strengthWeak') },
    { color: 'danger', label: t('signup.strengthWeak') },
    { color: 'warning', label: t('signup.strengthFair') },
    { color: 'accent', label: t('signup.strengthGood') },
    { color: 'success', label: t('signup.strengthStrong') },
  ][metCount]

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!isPasswordValid) {
      setError(t('signup.errorRequirements') || 'Password does not meet requirements')
      return
    }

    const digits = parseFullPhone(phone).number
    if (digits && digits.length !== 10) {
      setError(t('customers.phoneLengthError'))
      return
    }

    setLoading(true)
    try {
      await api.post('/auth/signup', {
        storeName,
        fullName,
        username,
        password,
        email: email || undefined,
        phone: phone || undefined,
      })

      const result = await login(username, password)
      if (result.success) {
        navigate('/dashboard')
      } else {
        setError(t('signup.errorLoginFailed') || 'Account created but login failed. Please sign in.')
        navigate('/login')
      }
    } catch (err) {
      setError(err.response?.data?.error || (t('signup.errorSignupFailed') || 'Signup failed. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  const requirementList = [
    { key: 'length', label: t('signup.reqLength') || '8+ characters' },
    { key: 'upper', label: t('signup.reqUpper') || 'Uppercase' },
    { key: 'lower', label: t('signup.reqLower') || 'Lowercase' },
    { key: 'digit', label: t('signup.reqDigit') || 'Digit' },
  ]

  return (
<div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 dark:from-background dark:to-background-secondary flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-accent rounded-2xl mb-4 overflow-hidden">
            {settings.storeLogo ? (
              <img src={settings.storeLogo} alt={settings.storeName} className="w-full h-full object-cover" />
            ) : (
              <Store className="w-10 h-10 text-accent-foreground" />
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {t('signup.title') || 'Create Your Store'}
          </h1>
          <p className="text-muted mt-2">
            {t('signup.subtitle') || 'Set up your store in minutes'}
          </p>
        </div>

        <Card>
          <Card.Content className="p-6 sm:p-8">
            {error && (
              <Alert status="danger" className="text-start mb-4">
                <Alert.Indicator>
                  <AlertCircle className="size-5" />
                </Alert.Indicator>
                <Alert.Content>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="signup-store-name" className="block text-sm font-medium text-foreground mb-2">
                  {t('signup.storeName') || 'Store Name'} *
                </label>
                <InputGroup fullWidth>
                  <InputGroup.Prefix>
                    <Store className="size-5 text-muted" />
                  </InputGroup.Prefix>
                  <InputGroup.Input
                    id="signup-store-name"
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder={t('signup.storeNamePlaceholder') || 'My Shop'}
                    autoComplete="organization"
                    autoFocus
                    required
                  />
                </InputGroup>
              </div>

              {/* Full name and username side by side on wider screens: five
                  stacked fields made the card taller than a phone viewport
                  before the user ever reached the password rules. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="signup-full-name" className="block text-sm font-medium text-foreground mb-2">
                    {t('signup.fullName') || 'Your Full Name'} *
                  </label>
                  <InputGroup fullWidth>
                    <InputGroup.Prefix>
                      <User className="size-5 text-muted" />
                    </InputGroup.Prefix>
                    <InputGroup.Input
                      id="signup-full-name"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder={t('signup.fullNamePlaceholder') || 'John Doe'}
                      autoComplete="name"
                      required
                    />
                  </InputGroup>
                </div>

                <div>
                  <label htmlFor="signup-username" className="block text-sm font-medium text-foreground mb-2">
                    {t('signup.username') || 'Username'} *
                  </label>
                  <InputGroup fullWidth>
                    <InputGroup.Prefix>
                      <AtSign className="size-5 text-muted" />
                    </InputGroup.Prefix>
                    <InputGroup.Input
                      id="signup-username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={t('signup.usernamePlaceholder') || 'johndoe'}
                      autoComplete="username"
                      minLength={3}
                      required
                    />
                  </InputGroup>
                </div>
              </div>

              <div>
                <PhoneField
                  id="signup-phone"
                  label={`${t('signup.phone') || 'Phone Number'} (${t('signup.optional') || 'optional'})`}
                  value={phone}
                  onChange={setPhone}
                />
                <p className="text-xs text-muted mt-1">{t('signup.phoneHint')}</p>
              </div>

              <div>
                <label htmlFor="signup-email" className="block text-sm font-medium text-foreground mb-2">
                  {t('signup.email') || 'Email'} ({t('signup.optional') || 'optional'})
                </label>
                <InputGroup fullWidth>
                  <InputGroup.Prefix>
                    <Mail className="size-5 text-muted" />
                  </InputGroup.Prefix>
                  <InputGroup.Input
                    id="signup-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('signup.emailPlaceholder') || 'john@example.com'}
                    autoComplete="email"
                  />
                </InputGroup>
              </div>

              <div>
                <label htmlFor="signup-password" className="block text-sm font-medium text-foreground mb-2">
                  {t('signup.password') || 'Password'} *
                </label>
                <InputGroup fullWidth>
                  <InputGroup.Prefix>
                    <Lock className="size-5 text-muted" />
                  </InputGroup.Prefix>
                  <InputGroup.Input
                    id="signup-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={handlePasswordChange}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    required
                  />
                  <InputGroup.Suffix>
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      aria-label={showPassword ? (t('signup.hidePassword') || 'Hide password') : (t('signup.showPassword') || 'Show password')}
                      className="p-1 text-muted hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </InputGroup.Suffix>
                </InputGroup>

                {password && (
                  <div className="mt-3 space-y-2">
                    <ProgressBar aria-label={t('signup.strength')} value={metCount * 25} color={strength.color} size="sm">
                      <ProgressBar.Track>
                        <ProgressBar.Fill />
                      </ProgressBar.Track>
                    </ProgressBar>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted">{t('signup.strength')}</span>
                      <span className="text-xs font-medium text-foreground">{strength.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {requirementList.map(({ key, label }) => (
                        <div key={key} className="flex items-center gap-1.5 text-xs">
                          {checks[key] ? (
                            <CheckCircle className="w-3.5 h-3.5 text-success" />
                          ) : (
                            <Circle className="w-3.5 h-3.5 text-muted" />
                          )}
                          <span className={checks[key] ? 'text-success' : 'text-muted'}>
                            {label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <Button type="submit" variant="primary" size="lg" fullWidth isDisabled={loading || !isPasswordValid}>
                {loading ? (t('signup.creating') || 'Creating Store...') : (t('signup.submit') || 'Create Store')}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-border text-center">
              <p className="text-sm text-muted mb-3">{t('signup.haveStore')}</p>
              {/* Same borrows-HeroUI-classes trick as LoginPage's link: a
                  <Button> here would not navigate (and Link must stay a Link
                  for middle-click / ctrl-click). */}
              <Link
                to="/login"
                className="button button--outline button--md button--full-width"
              >
                {t('users.signIn') || 'Sign In'}
              </Link>
            </div>
          </Card.Content>
        </Card>
      </div>
    </div>
  )
}
