import { useState, type FormEvent } from 'react';
import { ErrorBanner, Field } from '../components/ui.tsx';
import { useAuth } from '../features/auth/AuthContext.tsx';
import { errorMessage } from '../lib/api.ts';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-xl font-bold text-white" aria-hidden="true">P</div>
          <h1 className="text-2xl font-bold">Sign in to PayGuard</h1>
          <p className="mt-1 text-sm text-slate-600">Explainable pre-payment checks for every invoice.</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <Field label="Email" htmlFor="email">
            <input id="email" type="email" required autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="password">
            <input id="password" type="password" required autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="mt-4 rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <p className="mb-2 font-semibold">Demo accounts</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => setEmail('operator@payguard.demo')}>Finance Operator</button>
            <button type="button" className="btn-secondary" onClick={() => setEmail('auditor@payguard.demo')}>Chief Auditor</button>
          </div>
          <p className="mt-2 text-xs text-slate-600">Selecting a role fills the email. The password is the <code>DEMO_PASSWORD</code> you chose when seeding the database.</p>
        </div>
      </div>
    </div>
  );
}
