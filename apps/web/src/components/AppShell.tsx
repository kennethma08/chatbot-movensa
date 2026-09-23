import { useEffect, useState } from 'react';
import {
  BarChart3, Building2, ChevronDown, ContactRound, Headphones, LayoutDashboard,
  LifeBuoy, LogOut, Menu, MessageCircleMore, Settings2, ShieldCheck, SlidersHorizontal, UserRoundSearch, X,
} from 'lucide-react';
import type { AppCapability } from '@movensa/shared';
import { canRole } from '@movensa/shared';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { IconButton } from './ui';
import { api, apiAssetUrl } from '../lib/api';

type NavEntry = { label: string; to: string; icon: typeof LayoutDashboard; capability: AppCapability; external?: boolean };
type NavSection = { label: string; entries: NavEntry[] };

const navigation: NavSection[] = [
  { label: 'Operación', entries: [
    { label: 'Dashboard', to: '/inicio', icon: LayoutDashboard, capability: 'dashboard' },
    { label: 'Chats', to: '/conversaciones', icon: MessageCircleMore, capability: 'tenantOperations' },
    { label: 'Clientes', to: '/contactos', icon: ContactRound, capability: 'tenantOperations' },
    { label: 'Agentes', to: '/equipo', icon: Headphones, capability: 'manageTeam' },
  ] },
  { label: 'Analíticas', entries: [
    { label: 'Analíticas generales', to: '/reportes/generales', icon: BarChart3, capability: 'viewReports' },
    { label: 'Analíticas por agente', to: '/reportes/agentes', icon: UserRoundSearch, capability: 'viewReports' },
  ] },
  { label: 'Administrador', entries: [
    { label: 'Empresas', to: '/administracion/empresas', icon: Building2, capability: 'managePlatform' },
    { label: 'Configuración global', to: '/administracion/configuracion', icon: SlidersHorizontal, capability: 'managePlatform' },
    { label: 'Operación', to: '/administracion/operaciones', icon: ShieldCheck, capability: 'managePlatform' },
  ] },
  { label: 'Cuenta', entries: [
    { label: 'Configuración', to: '/perfil', icon: Settings2, capability: 'viewProfile' },
    { label: 'Soporte', to: 'https://grupomovensa.com/soporte', icon: LifeBuoy, capability: 'viewProfile', external: true },
  ] },
];

export function AppShell() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const beat = () => void api('/session/presence', { method: 'POST' }).catch(() => undefined);
    beat();
    const timer = window.setInterval(beat, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const visible = navigation.map((section) => ({ ...section, entries: section.entries.filter((entry) => user ? canRole(user.role, entry.capability) : false) })).filter((section) => section.entries.length);
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Saltar al contenido</a>
    <aside className={`sidebar ${open ? 'sidebar--open' : ''}`} aria-label="Navegación principal">
      <div className="sidebar__brand"><img src="/brand/grupo-movensa.png" alt="Grupo Movensa" /><IconButton className="sidebar__close" label="Cerrar menú" onClick={() => setOpen(false)}><X size={19} /></IconButton></div>
      <nav className="sidebar__nav">
        {visible.map((section) => <div className="nav-section" key={section.label}>
          <p>{section.label}</p>
          {section.entries.map((entry) => entry.external ? <a key={entry.to} className="nav-link" href={entry.to} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}><entry.icon size={18} strokeWidth={1.8} /><span>{entry.label}</span></a> : <NavLink key={entry.to} to={entry.to} onClick={() => setOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}>
            <entry.icon size={18} strokeWidth={1.8} /><span>{entry.label}</span>
          </NavLink>)}
        </div>)}
      </nav>
      <div className="sidebar__profile">
        <div className="avatar" aria-hidden="true">{user?.avatarUrl ? <img src={apiAssetUrl(user.avatarUrl)} alt="" /> : user?.name.slice(0, 2).toUpperCase()}</div>
        <div><strong>{user?.name}</strong><span>{user?.role === 'super_admin' ? 'Superadministrador' : user?.role === 'admin' ? 'Administrador' : 'Agente'}</span></div>
        <IconButton label="Cerrar sesión" onClick={() => void signOut()}><LogOut size={17} /></IconButton>
      </div>
    </aside>
    {open && <button className="sidebar-backdrop" aria-label="Cerrar menú" onClick={() => setOpen(false)} />}
    <div className="app-main">
      <header className="mobile-bar"><IconButton label="Abrir menú" onClick={() => setOpen(true)}><Menu size={21} /></IconButton><img className="mobile-brand" src="/brand/grupo-movensa.png" alt="Grupo Movensa" /><button className="mobile-user" type="button">{user?.name.split(' ')[0]}<ChevronDown size={14} /></button></header>
      <main id="main-content" className="page"><Outlet /></main>
    </div>
  </div>;
}
