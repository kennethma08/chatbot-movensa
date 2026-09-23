import { type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Building2, Save } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Field, PageHeader } from '../../components/ui';
import { api, formatApiError, jsonBody } from '../../lib/api';

type CreatedCompany = { id: string | number };

export function CompanyCreatePage() {
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<CreatedCompany>('/admin/companies', { method: 'POST', ...jsonBody(body) }),
    onSuccess: (company) => navigate(`/administracion/empresas/${company.id}`, { replace: true }),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      name: form.get('name'),
      code: form.get('code'),
      description: form.get('description') || null,
      contactEmail: form.get('contactEmail') || null,
      contactPhone: form.get('contactPhone') || null,
      timeZone: form.get('timeZone'),
      isEnabled: form.get('isEnabled') === 'on',
      flowKey: form.get('flowKey') || null,
      notificationMode: form.get('notificationMode'),
      notificationRecipients: String(form.get('notificationRecipients') ?? '').split(',').map((item) => item.trim()).filter(Boolean),
      businessHoursStart: form.get('businessHoursStart') || null,
      businessHoursEnd: form.get('businessHoursEnd') || null,
      agentFarewellMessage: form.get('agentFarewellMessage') || null,
    });
  }

  return <>
    <PageHeader eyebrow="Administración global" title="Nueva empresa" description="Registra la empresa con la misma configuración operativa disponible en la edición." action={<Link className="button button--secondary" to="/administracion/empresas"><ArrowLeft size={16} />Volver</Link>} />
    <Card className="form-card"><form onSubmit={submit}>
      <div className="form-section"><div><span className="section-icon"><Building2 size={19} /></span><h2>Información general</h2><p>Datos de identificación, contacto y operación.</p></div><div className="form-grid">
        <Field label="Nombre"><input name="name" required minLength={2} maxLength={160} /></Field>
        <Field label="Código" hint="Solo minúsculas, números y guiones"><input name="code" required minLength={2} maxLength={60} pattern="[a-z0-9-]+" /></Field>
        <Field label="Descripción"><textarea name="description" rows={3} maxLength={1000} /></Field>
        <Field label="Correo de contacto"><input name="contactEmail" type="email" /></Field>
        <Field label="Teléfono"><input name="contactPhone" maxLength={40} /></Field>
        <Field label="Zona horaria"><input name="timeZone" defaultValue="America/Costa_Rica" readOnly required /></Field>
        <Field label="Flow key"><input name="flowKey" maxLength={160} /></Field>
        <Field label="Modo de notificaciones"><select name="notificationMode" defaultValue="disabled"><option value="disabled">Deshabilitadas</option><option value="always">Siempre</option><option value="outside_business_hours">Fuera del horario</option></select></Field>
        <Field label="Destinatarios de notificaciones" hint="Correos separados por coma"><input name="notificationRecipients" placeholder="correo1@dominio.com, correo2@dominio.com" /></Field>
        <label className="toggle-field"><input name="isEnabled" type="checkbox" defaultChecked /><span />Empresa habilitada</label>
      </div></div>
      <div className="form-section"><div><h2>Horario y cierre</h2><p>Valores iniciales del horario comercial y la despedida de los agentes.</p></div><div className="form-grid">
        <Field label="Apertura"><input name="businessHoursStart" type="time" defaultValue="08:00" /></Field>
        <Field label="Cierre"><input name="businessHoursEnd" type="time" defaultValue="17:00" /></Field>
        <Field label="Despedida del agente"><textarea name="agentFarewellMessage" rows={4} maxLength={1000} /></Field>
      </div></div>
      <div className="form-actions">{mutation.isError && <span className="form-error">{formatApiError(mutation.error)}</span>}<Link className="button button--secondary" to="/administracion/empresas">Cancelar</Link><Button type="submit" disabled={mutation.isPending}><Save size={16} />{mutation.isPending ? 'Creando…' : 'Crear empresa'}</Button></div>
    </form></Card>
  </>;
}
