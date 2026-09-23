import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Button, Field } from '../components/ui';
import { supabase } from '../lib/supabase';

export function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!loading && !session) return <Navigate to="/acceso" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 12) { setError('Usa al menos 12 caracteres.'); return; }
    if (password !== confirmation) { setError('Las contraseñas no coinciden.'); return; }
    setBusy(true); setError('');
    const result = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (result.error) setError(result.error.message); else navigate('/inicio', { replace: true });
  }
  return <main className="login-page"><div className="login-main"><section className="login-brand"><img src="/brand/grupo-movensa.png" alt="Grupo Movensa" /></section><section className="login-panel"><form className="login-form" onSubmit={submit}><h1>Nueva contraseña</h1><p className="muted">Debe tener al menos 12 caracteres.</p><Field label="Nueva contraseña"><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></Field><Field label="Confirmar contraseña"><input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></Field>{error && <div className="form-error" role="alert">{error}</div>}<Button type="submit" disabled={busy}>{busy ? 'Actualizando…' : 'Guardar contraseña'}</Button></form></section></div></main>;
}
