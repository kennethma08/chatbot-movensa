import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, Mail, Save } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { Button, Card, ErrorState, Field, LoadingState } from '../components/ui';
import { api, apiAssetUrl, formatApiError, jsonBody } from '../lib/api';

type Profile = { id: string; name: string; email: string; phone: string | null; role: string; company_name: string | null; avatarUrl: string | null };

function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  return [parts.shift() ?? '', parts.join(' ')];
}

export function ProfilePage() {
  const { refreshUser } = useAuth();
  const client = useQueryClient();
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/profile') });
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const save = useMutation({
    mutationFn: async (input: { name: string; email?: string; phone: string | null }) => {
      await api('/profile', { method: 'PATCH', ...jsonBody(input) });
      if (avatarFile) {
        const body = new FormData();
        body.append('avatar', avatarFile);
        await api('/profile/avatar', { method: 'POST', body });
      }
    },
    onSuccess: async () => {
      setAvatarFile(null);
      setPreview(null);
      await Promise.all([client.invalidateQueries({ queryKey: ['profile'] }), refreshUser()]);
    },
  });
  if (query.isError) return <ErrorState message={formatApiError(query.error)} />;
  if (query.isLoading || !query.data) return <LoadingState label="Cargando perfil…" />;
  const profile = query.data;
  const canEditEmail = profile.role === 'admin' || profile.role === 'super_admin';
  const [firstName, lastName] = splitName(profile.name);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save.mutate({
      name: `${String(form.get('firstName') ?? '').trim()} ${String(form.get('lastName') ?? '').trim()}`.trim(),
      ...(canEditEmail ? { email: String(form.get('email') ?? '').trim() } : {}),
      phone: String(form.get('phone') ?? '').trim() || null,
    });
  }
  const avatar = preview ?? (profile.avatarUrl ? apiAssetUrl(profile.avatarUrl) : null);
  const role = profile.role === 'super_admin' ? 'Superadministrador' : profile.role === 'admin' ? 'Administrador' : 'Agente';
  return <Card className="profile-editor"><form onSubmit={submit}>
      <div className="profile-editor__summary">
        <label className="profile-avatar-button"><span className="avatar avatar--profile">{avatar ? <img src={avatar} alt={`Avatar de ${profile.name}`} /> : profile.name.slice(0, 2).toUpperCase()}</span><span><Camera size={15} /></span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0] ?? null; setAvatarFile(file); setPreview((current) => { if (current) URL.revokeObjectURL(current); return file ? URL.createObjectURL(file) : null; }); }} /></label>
        <div><h2>{profile.name}</h2><p>{[role, profile.company_name, profile.email].filter(Boolean).join(' · ')}</p></div>
      </div>
      <div className="profile-editor__fields">
        <Field label="Nombre"><input name="firstName" defaultValue={firstName} required maxLength={80} /></Field>
        <Field label="Apellidos"><input name="lastName" defaultValue={lastName} maxLength={80} /></Field>
        <Field label="Correo electrónico" hint={canEditEmail ? 'Se actualizará también el correo de inicio de sesión.' : 'El correo de los agentes no se puede editar.'}>{canEditEmail ? <input name="email" type="email" defaultValue={profile.email} required /> : <div className="readonly-input"><Mail size={15} />{profile.email}</div>}</Field>
        <Field label="Teléfono"><input name="phone" defaultValue={profile.phone ?? ''} maxLength={40} /></Field>
        <Field label="Empresa"><input value={profile.company_name ?? 'Administración global'} readOnly /></Field>
      </div>
      <div className="form-actions">{save.isError && <span className="form-error">{formatApiError(save.error)}</span>}{save.isSuccess && <span className="success-text"><CheckCircle2 size={16} />Perfil actualizado</span>}<Button type="submit" disabled={save.isPending}><Save size={16} />{save.isPending ? 'Guardando…' : 'Guardar cambios'}</Button></div>
    </form></Card>;
}
