import { lazy, Suspense } from 'react';
import type { AppCapability } from '@movensa/shared';
import { canRole } from '@movensa/shared';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { LoadingState } from './components/ui';
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const ConversationsPage = lazy(() => import('./pages/ConversationsPage').then((module) => ({ default: module.ConversationsPage })));
const ContactsPage = lazy(() => import('./pages/ContactsPage').then((module) => ({ default: module.ContactsPage })));
const TeamPage = lazy(() => import('./pages/TeamPage').then((module) => ({ default: module.TeamPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })));
const AgentReportsPage = lazy(() => import('./pages/AgentReportsPage').then((module) => ({ default: module.AgentReportsPage })));
const CompaniesPage = lazy(() => import('./pages/admin/CompaniesPage').then((module) => ({ default: module.CompaniesPage })));
const CompanyCreatePage = lazy(() => import('./pages/admin/CompanyCreatePage').then((module) => ({ default: module.CompanyCreatePage })));
const CompanyPage = lazy(() => import('./pages/admin/CompanyPage').then((module) => ({ default: module.CompanyPage })));
const OperationsPage = lazy(() => import('./pages/admin/OperationsPage').then((module) => ({ default: module.OperationsPage })));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const AutomationPage = lazy(() => import('./pages/automation/AutomationPage').then((module) => ({ default: module.AutomationPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })));

function ProtectedLayout() {
  const { session, user, loading } = useAuth();
  if (loading) return <div className="boot-screen"><LoadingState label="Preparando tu espacio…" /></div>;
  return session && user ? <AppShell /> : <Navigate to="/acceso" replace />;
}

function CapabilityRoute({ capability }: { capability: AppCapability }) {
  const { user } = useAuth();
  return user && canRole(user.role, capability) ? <Outlet /> : <Navigate to="/inicio" replace />;
}

export function App() {
  return <Suspense fallback={<div className="boot-screen"><LoadingState label="Cargando sección…" /></div>}><Routes>
    <Route path="/acceso" element={<LoginPage />} />
    <Route path="/restablecer" element={<ResetPasswordPage />} />
    <Route element={<ProtectedLayout />}>
      <Route path="/inicio" element={<DashboardPage />} />
      <Route path="/perfil" element={<ProfilePage />} />
      <Route element={<CapabilityRoute capability="tenantOperations" />}>
        <Route path="/conversaciones" element={<ConversationsPage />} />
        <Route path="/contactos" element={<ContactsPage />} />
      </Route>
      <Route element={<CapabilityRoute capability="manageTeam" />}>
        <Route path="/equipo" element={<TeamPage />} />
      </Route>
      <Route element={<CapabilityRoute capability="viewReports" />}>
        <Route path="/reportes" element={<Navigate to="/reportes/generales" replace />} />
        <Route path="/reportes/generales" element={<ReportsPage />} />
        <Route path="/reportes/agentes" element={<AgentReportsPage />} />
      </Route>
      <Route element={<CapabilityRoute capability="managePlatform" />}>
        <Route path="/administracion/empresas" element={<CompaniesPage />} />
        <Route path="/administracion/empresas/nueva" element={<CompanyCreatePage />} />
        <Route path="/administracion/empresas/:companyId/:section?" element={<CompanyPage />} />
        <Route path="/administracion/empresas/:companyId/automatizacion/:channel/:section?" element={<AutomationPage />} />
        <Route path="/administracion/empresas/:companyId/conversaciones" element={<ConversationsPage />} />
        <Route path="/administracion/empresas/:companyId/reportes" element={<ReportsPage />} />
        <Route path="/administracion/empresas/:companyId/reportes/agentes" element={<AgentReportsPage />} />
        <Route path="/administracion/operaciones" element={<OperationsPage />} />
        <Route path="/administracion/configuracion" element={<SettingsPage />} />
      </Route>
      <Route path="/automatizacion/*" element={<Navigate to="/inicio" replace />} />
      <Route index element={<Navigate to="/inicio" replace />} />
    </Route>
    <Route path="*" element={<Navigate to="/inicio" replace />} />
  </Routes></Suspense>;
}
