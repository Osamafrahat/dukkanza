import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authApi, usersApi } from '../lib/api'
import { useBranchStore } from './branchStore'

// Permission definitions
export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard_view',
  POS_ACCESS: 'pos_access',
  INVENTORY_VIEW: 'inventory_view',
  INVENTORY_EDIT: 'inventory_edit',
  REPORTS_VIEW: 'reports_view',
  SUPPLIERS_VIEW: 'suppliers_view',
  SUPPLIERS_EDIT: 'suppliers_edit',
  PROMOTIONS_VIEW: 'promotions_view',
  PROMOTIONS_EDIT: 'promotions_edit',
  SETTINGS_VIEW: 'settings_view',
  SETTINGS_EDIT: 'settings_edit',
  USER_MANAGE: 'user_manage',
  CUSTOMERS_VIEW: 'customers_view',
  CUSTOMERS_EDIT: 'customers_edit',
  EXPENSES_VIEW: 'expenses_view',
  EXPENSES_EDIT: 'expenses_edit',
  REFUNDS_VIEW: 'refunds_view',
  REFUNDS_EDIT: 'refunds_edit',
  EMPLOYEES_VIEW: 'employees_view',
  EMPLOYEES_EDIT: 'employees_edit',
  ACCOUNTING_VIEW: 'accounting_view',
  ACCOUNTING_EDIT: 'accounting_edit',
  ACCOUNTING_POST: 'accounting_post',
  HR_VIEW: 'hr_view',
  HR_EDIT: 'hr_edit',
  SERVICES_VIEW: 'services_view',
  SERVICES_EDIT: 'services_edit',
  MANUFACTURING_VIEW: 'manufacturing_view',
  MANUFACTURING_EDIT: 'manufacturing_edit',
}

// Role definitions with default permissions
export const ROLES = {
  MANAGER: {
    name: 'Manager',
    nameAr: 'مدير',
    permissions: Object.values(PERMISSIONS),
  },
  SALES_MANAGER: {
    name: 'Sales Manager',
    nameAr: 'مدير المبيعات',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.POS_ACCESS,
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.SUPPLIERS_VIEW,
      PERMISSIONS.PROMOTIONS_VIEW,
      PERMISSIONS.PROMOTIONS_EDIT,
      PERMISSIONS.CUSTOMERS_VIEW,
      PERMISSIONS.CUSTOMERS_EDIT,
      PERMISSIONS.REFUNDS_VIEW,
      PERMISSIONS.REFUNDS_EDIT,
      PERMISSIONS.EXPENSES_VIEW,
      PERMISSIONS.SERVICES_VIEW,
      PERMISSIONS.SERVICES_EDIT,
      PERMISSIONS.MANUFACTURING_VIEW,
    ],
  },
  CASHIER: {
    name: 'Cashier',
    nameAr: 'كاشير',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.POS_ACCESS,
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.CUSTOMERS_VIEW,
      PERMISSIONS.CUSTOMERS_EDIT,
      PERMISSIONS.REFUNDS_VIEW,
      PERMISSIONS.SERVICES_VIEW,
    ],
  },
  INVENTORY_CLERK: {
    name: 'Inventory Clerk',
    nameAr: 'موظف مخزون',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.POS_ACCESS,
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.INVENTORY_EDIT,
      PERMISSIONS.SUPPLIERS_VIEW,
      PERMISSIONS.SUPPLIERS_EDIT,
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.MANUFACTURING_VIEW,
      PERMISSIONS.MANUFACTURING_EDIT,
    ],
  },
  ACCOUNTANT: {
    name: 'Accountant',
    nameAr: 'محاسب',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.POS_ACCESS,
      PERMISSIONS.ACCOUNTING_VIEW,
      PERMISSIONS.ACCOUNTING_EDIT,
      PERMISSIONS.ACCOUNTING_POST,
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.EXPENSES_VIEW,
      PERMISSIONS.EXPENSES_EDIT,
      PERMISSIONS.SUPPLIERS_VIEW,
      PERMISSIONS.CUSTOMERS_VIEW,
      PERMISSIONS.MANUFACTURING_VIEW,
    ],
  },
  HR_MANAGER: {
    name: 'HR Manager',
    nameAr: 'مدير الموارد البشرية',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.POS_ACCESS,
      PERMISSIONS.HR_VIEW,
      PERMISSIONS.HR_EDIT,
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.EMPLOYEES_VIEW,
      PERMISSIONS.EMPLOYEES_EDIT,
      PERMISSIONS.CUSTOMERS_VIEW,
    ],
  },
}

// Check if a role has admin-only access (settings, users, employees management)
export const isAdminRole = (role) => role === 'MANAGER'

// Session timeout: 30 minutes in milliseconds
const SESSION_TIMEOUT = 30 * 60 * 1000

export const useUserStore = create(
  persist(
    (set, get) => ({
      // Current user
      currentUser: null,
      isAuthenticated: false,
      lastActivity: null,
      token: null,

      // Tenant
      tenantId: null,
      tenantName: null,
      subscriptionTier: 'free',
      subscriptionStatus: null,
      trialEndsAt: null,

      // Computed getters
      isTrial: () => {
        const { subscriptionStatus, trialEndsAt } = get()
        return subscriptionStatus === 'trialing' && new Date(trialEndsAt) > new Date()
      },
      isPaid: () => get().subscriptionTier !== 'free',

      // Login
      login: async (username, password) => {
        try {
          const response = await authApi.login({ username, password })
          const { token, user } = response.data

          // Store token
          localStorage.setItem('auth_token', token)

          // Map snake_case to camelCase
          const mappedUser = {
            ...user,
            fullName: user.full_name,
            phone: user.phone,
            email: user.email,
          }

          // Extract tenant data from response (snake_case from API)
          const tenantData = {
            tenantId: response.data.tenant_id ?? user.tenant_id ?? null,
            tenantName: response.data.tenant_name ?? user.tenant_name ?? null,
            subscriptionTier: response.data.subscription_tier ?? user.subscription_tier ?? 'free',
            subscriptionStatus: response.data.subscription_status ?? user.subscription_status ?? null,
            trialEndsAt: response.data.trial_ends_at ?? user.trial_ends_at ?? null,
          }

          // Persist tenantId in localStorage
          if (tenantData.tenantId) {
            localStorage.setItem('tenant_id', tenantData.tenantId)
          }

          set({
            currentUser: mappedUser,
            isAuthenticated: true,
            lastActivity: Date.now(),
            token,
            ...tenantData,
          })

          return { success: true, user: mappedUser }
        } catch (err) {
          const message = err.response?.data?.error || 'Login failed'
          return { success: false, error: message }
        }
      },

      // Adopt a tenant session minted by the super-admin impersonation endpoint.
      // This has to go through the store: axios reads `auth_token` straight from
      // localStorage, but every role/permission/nav decision reads `currentUser`
      // from the hydrated store -- so writing only localStorage left the UI as
      // SUPER_ADMIN while the API calls were tenant-scoped.
      impersonate: (token, user, tenant = {}) => {
        localStorage.setItem('auth_token', token)

        const mappedUser = {
          ...user,
          fullName: user.full_name ?? null,
          phone: user.phone ?? null,
          email: user.email ?? null,
        }

        const tenantData = {
          tenantId: user.tenant_id ?? tenant.id ?? null,
          tenantName: tenant.name ?? null,
          subscriptionTier: tenant.subscription_tier ?? 'free',
          subscriptionStatus: tenant.subscription_status ?? null,
          trialEndsAt: tenant.trial_ends_at ?? null,
        }

        if (tenantData.tenantId) {
          localStorage.setItem('tenant_id', String(tenantData.tenantId))
        }

        set({
          currentUser: mappedUser,
          isAuthenticated: true,
          lastActivity: Date.now(),
          token,
          ...tenantData,
        })
      },

      // Logout
      logout: () => {
        authApi.logout().catch(() => {})
        // Clear all auth-related localStorage keys
        localStorage.removeItem('auth_token')
        localStorage.removeItem('user-storage')
        localStorage.removeItem('cart-storage')
        localStorage.removeItem('tenant_id')
        // Branch selection is per-session: the persisted 'erp-selected-branch'
        // would otherwise leak into the next user's login on this browser.
        useBranchStore.getState().resetSession()
        set({
          currentUser: null,
          isAuthenticated: false,
          lastActivity: null,
          token: null,
          tenantId: null,
          tenantName: null,
          subscriptionTier: 'free',
          subscriptionStatus: null,
          trialEndsAt: null,
        })
      },

      // Update last activity
      updateActivity: () => {
        const { isAuthenticated } = get()
        if (isAuthenticated) {
          set({ lastActivity: Date.now() })
        }
      },

      // Check session timeout
      checkSessionTimeout: () => {
        const { isAuthenticated, lastActivity, logout } = get()
        if (!isAuthenticated || !lastActivity) return false

        const now = Date.now()
        const timeSinceLastActivity = now - lastActivity

        if (timeSinceLastActivity >= SESSION_TIMEOUT) {
          logout()
          return true
        }
        return false
      },

      // Check if user has permission
      hasPermission: (permission) => {
        const { currentUser } = get()
        if (!currentUser) return false
        if (currentUser.role === 'MANAGER') return true

        // Parse permissions if stored as JSON string
        let permissions = currentUser.permissions
        if (typeof permissions === 'string') {
          try {
            permissions = JSON.parse(permissions)
          } catch {
            permissions = []
          }
        }

        return permissions?.includes(permission) || false
      },

      // Check if user can access a route
      canAccess: (route) => {
        const { currentUser } = get()
        if (!currentUser) return false
        if (currentUser.role === 'MANAGER') return true

        const routePermissions = {
          '/': PERMISSIONS.DASHBOARD_VIEW,
          '/pos': PERMISSIONS.POS_ACCESS,
          '/inventory': PERMISSIONS.INVENTORY_VIEW,
          '/reports': PERMISSIONS.REPORTS_VIEW,
          '/suppliers': PERMISSIONS.SUPPLIERS_VIEW,
          '/promotions': PERMISSIONS.PROMOTIONS_VIEW,
          '/settings': PERMISSIONS.SETTINGS_VIEW,
          '/users': PERMISSIONS.USER_MANAGE,
          '/customers': PERMISSIONS.CUSTOMERS_VIEW,
          '/employees': PERMISSIONS.EMPLOYEES_VIEW,
          '/expenses': PERMISSIONS.EXPENSES_VIEW,
          '/refunds': PERMISSIONS.REFUNDS_VIEW,
          '/accounting': PERMISSIONS.ACCOUNTING_VIEW,
          '/hr/attendance': PERMISSIONS.HR_VIEW,
          '/hr/attendance-dashboard': PERMISSIONS.HR_VIEW,
          '/hr/leave': PERMISSIONS.HR_VIEW,
          '/hr/payroll': PERMISSIONS.HR_VIEW,
          '/hr/shifts': PERMISSIONS.HR_VIEW,
          '/hr/shifts/view': PERMISSIONS.HR_VIEW,
          '/hr/performance': PERMISSIONS.HR_VIEW,
          '/activities': PERMISSIONS.USER_MANAGE,
          '/backup': PERMISSIONS.USER_MANAGE,
          '/branches': PERMISSIONS.USER_MANAGE,
          '/invoices': PERMISSIONS.POS_ACCESS,
          '/services': PERMISSIONS.SERVICES_VIEW,
          '/service-plans': PERMISSIONS.SERVICES_VIEW,
          '/subscriptions': PERMISSIONS.SERVICES_VIEW,
          '/manufacturing': PERMISSIONS.MANUFACTURING_VIEW,
          '/manufacturing/boms': PERMISSIONS.MANUFACTURING_VIEW,
        }

        const requiredPermission = routePermissions[route]
        if (!requiredPermission) return true

        let permissions = currentUser.permissions
        if (typeof permissions === 'string') {
          try {
            permissions = JSON.parse(permissions)
          } catch {
            permissions = []
          }
        }

        return permissions?.includes(requiredPermission) || false
      },

      // Mark password as changed
      markPasswordChanged: () => {
        const { currentUser } = get()
        if (currentUser) {
          set({
            currentUser: { ...currentUser, must_change_password: 0 }
          })
        }
      },

      // Refresh user data from server (e.g. after payment upgrade)
      refreshUser: async () => {
        try {
          const { data } = await authApi.getMe()
          const mappedUser = {
            ...data.user,
            fullName: data.user.full_name,
          }
          const tenantData = {
            tenantId: data.tenant_id ?? null,
            tenantName: data.tenant_name ?? null,
            subscriptionTier: data.subscription_tier ?? 'free',
            subscriptionStatus: data.subscription_status ?? null,
            trialEndsAt: data.trial_ends_at ?? null,
          }
          if (tenantData.tenantId) {
            localStorage.setItem('tenant_id', tenantData.tenantId)
          }
          set({
            currentUser: mappedUser,
            ...tenantData,
          })
        } catch (err) {
          console.error('Failed to refresh user:', err)
        }
      },

      // Check if must change password
      mustChangePassword: () => {
        const { currentUser } = get()
        const val = currentUser?.must_change_password
        return val === true || val === 1 || val === '1' || val === 'true'
      },

      // Users list
      users: [],

      // Fetch all users
      fetchUsers: async () => {
        try {
          const { data } = await usersApi.getAll()
          // Map snake_case to camelCase
          const mapped = data.map(u => ({
            id: u.id,
            username: u.username,
            fullName: u.full_name,
            role: u.role,
            permissions: typeof u.permissions === 'string' ? JSON.parse(u.permissions) : (u.permissions || []),
            isActive: u.is_active,
            mustChangePassword: u.must_change_password,
            lastLogin: u.last_login,
            employeeId: u.employee_id,
            employee: u.employee || null,
            createdAt: u.created_at,
            updatedAt: u.updated_at,
          }))
          set({ users: mapped })
        } catch (err) {
          console.error('Failed to fetch users:', err)
        }
      },

      // Add user
      addUser: async (userData) => {
        try {
          const { data } = await usersApi.create({
            username: userData.username,
            password: userData.password,
            fullName: userData.fullName,
            role: userData.role,
            permissions: userData.permissions,
            employeeId: userData.employeeId || null,
            branch_id: userData.branch_id ?? null,
          })
          const mapped = {
            id: data.id,
            username: data.username,
            fullName: data.full_name,
            role: data.role,
            permissions: typeof data.permissions === 'string' ? JSON.parse(data.permissions) : (data.permissions || []),
            isActive: data.is_active,
            mustChangePassword: data.must_change_password,
            employeeId: data.employee_id,
          }
          set(state => ({ users: [mapped, ...state.users] }))
          return { success: true }
        } catch (err) {
          return { success: false, error: err.response?.data?.error || 'Failed to create user' }
        }
      },

      // Update user
      updateUser: async (userId, userData) => {
        try {
          const payload = {}
          if (userData.username) payload.username = userData.username
          if (userData.fullName) payload.fullName = userData.fullName
          if (userData.role) payload.role = userData.role
          if (userData.permissions) payload.permissions = userData.permissions
          if (userData.password) payload.password = userData.password
          if (userData.employeeId !== undefined) payload.employeeId = userData.employeeId
          // Optional home branch (null clears it)
          if (userData.branch_id !== undefined) payload.branch_id = userData.branch_id

          const { data } = await usersApi.update(userId, payload)
          const mapped = {
            id: data.id,
            username: data.username,
            fullName: data.full_name,
            role: data.role,
            permissions: typeof data.permissions === 'string' ? JSON.parse(data.permissions) : (data.permissions || []),
            isActive: data.is_active,
            mustChangePassword: data.must_change_password,
            employeeId: data.employee_id,
          }
          set(state => {
            const newState = {
              users: state.users.map(u => u.id === userId ? mapped : u)
            }
            // Also update currentUser if the updated user is the logged-in user
            if (state.currentUser?.id === userId) {
              newState.currentUser = { ...state.currentUser, ...mapped }
            }
            return newState
          })
          return { success: true }
        } catch (err) {
          return { success: false, error: err.response?.data?.error || 'Failed to update user' }
        }
      },

      // Delete user
      deleteUser: async (userId) => {
        try {
          await usersApi.delete(userId)
          set(state => ({
            users: state.users.filter(u => u.id !== userId)
          }))
          return { success: true }
        } catch (err) {
          return { success: false, error: err.response?.data?.error || 'Failed to delete user' }
        }
      },

      // Toggle user active status
      toggleUserActive: async (userId) => {
        try {
          const { data } = await usersApi.toggleActive(userId)
          set(state => {
            const newState = {
              users: state.users.map(u => u.id === userId ? { ...u, isActive: data.is_active } : u)
            }
            // Also update currentUser if toggling self
            if (state.currentUser?.id === userId) {
              newState.currentUser = { ...state.currentUser, isActive: data.is_active }
            }
            return newState
          })
        } catch (err) {
          console.error('Failed to toggle user:', err)
        }
      },
    }),
    {
      name: 'user-storage',
      partialize: (state) => ({
        currentUser: state.currentUser,
        isAuthenticated: state.isAuthenticated,
        lastActivity: state.lastActivity,
        token: state.token,
        tenantId: state.tenantId,
        tenantName: state.tenantName,
        subscriptionTier: state.subscriptionTier,
        subscriptionStatus: state.subscriptionStatus,
        trialEndsAt: state.trialEndsAt,
      }),
    }
  )
)
