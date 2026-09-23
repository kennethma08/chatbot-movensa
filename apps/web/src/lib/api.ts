import type { ApiErrorShape } from '@movensa/shared';
import { supabase } from './supabase';

const apiUrl = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');

export function apiAssetUrl(path: string): string {
  return path.startsWith('http') ? path : `${apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function downloadApiAsset(path: string, fileName: string, init: RequestInit = {}): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session?.access_token) headers.set('authorization', `Bearer ${data.session.access_token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(apiAssetUrl(path), {
    ...init,
    headers,
  });
  if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'No se pudo descargar el archivo.');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function getApiAssetObjectUrl(path: string, init: RequestInit = {}): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session?.access_token) headers.set('authorization', `Bearer ${data.session.access_token}`);
  const response = await fetch(apiAssetUrl(path), { ...init, headers });
  if (!response.ok) throw new ApiError(response.status, 'ASSET_FAILED', 'No se pudo cargar el archivo.');
  return URL.createObjectURL(await response.blob());
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session?.access_token) headers.set('authorization', `Bearer ${data.session.access_token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`${apiUrl}/v1${path}`, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as ApiErrorShape | null;
    throw new ApiError(response.status, payload?.error.code ?? 'REQUEST_FAILED', payload?.error.message ?? 'No se pudo completar la solicitud.', payload?.error.requestId);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function jsonBody(value: unknown): Pick<RequestInit, 'body'> {
  return { body: JSON.stringify(value) };
}

export function formatApiError(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
}
