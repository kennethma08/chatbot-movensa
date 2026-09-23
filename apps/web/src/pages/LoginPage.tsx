import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Button, Field } from '../components/ui';
import { supabase } from '../lib/supabase';

export function LoginPage() {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (session) return <Navigate to="/inicio" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) setError(result.error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : result.error.message);
    setBusy(false);
  }
  return <main className="login-page">
    <div className="login-main">
      <section className="login-brand" aria-label="Grupo Movensa"><img src="/brand/grupo-movensa.png" alt="Grupo Movensa" /></section>
      <section className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <h1>¡Bienvenido!</h1>
          <Field label="Correo electrónico"><input id="correo" type="email" autoComplete="username email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="Correo electrónico" /></Field>
          <Field label="Contraseña"><input id="contra" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="Contraseña" /></Field>
          {error && <div className="form-error" role="alert">{error}</div>}
          <Button type="submit" disabled={busy}>{busy ? 'Verificando…' : 'Iniciar sesión'}</Button>
        </form>
      </section>
    </div>
    <footer className="login-footer"><a href="https://grupomovensa.com/soporte" target="_blank" rel="noopener noreferrer">Soporte</a><span>Plataforma desarrollada y distribuida por <a href="https://grupomovensa.com/" target="_blank" rel="noopener noreferrer">Grupo Movensa</a> © {new Date().getFullYear()}</span><strong>Versión 1.0.0</strong></footer>
  </main>;
}
