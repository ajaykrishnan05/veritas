import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext.tsx';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-indigo-50 text-primary' : 'text-slate-700 hover:bg-slate-100'}`;

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 text-lg font-bold text-ink">
            <span aria-hidden="true" className="inline-flex h-7 w-7 items-center justify-center rounded bg-primary text-sm text-white">P</span>
            PayGuard
          </NavLink>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            <NavLink to="/" end className={navClass}>Dashboard</NavLink>
            <NavLink to="/upload" className={navClass}>Upload invoice</NavLink>
            <NavLink to="/audit" className={navClass}>Audit trail</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <div className="text-right leading-tight">
              <div className="font-semibold">{user?.full_name}</div>
              <div className="text-xs text-slate-600">{user?.role === 'chief_auditor' ? 'Chief Auditor' : 'Finance Operator'}</div>
            </div>
            <button className="btn-secondary" onClick={() => void logout()}>Sign out</button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
