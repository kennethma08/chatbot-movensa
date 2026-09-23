import { createHash, randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Database } from '../database.js';
import { decryptSecret } from '../security/crypto.js';

interface MediaJob {
  id: string;
  company_id: string;
  conversation_id: string;
  inbound_message_id: string;
  attempts: number;
  payload: { mediaId?: string; fileName?: string | null; type?: string };
  api_base_url: string;
  api_version: string;
  access_token_ciphertext: string;
}

export function createMediaWorker(db: Database, config: AppConfig, instanceId: string) {
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  async function claim(): Promise<MediaJob | null> {
    return db.begin(async (tx) => {
      const [job] = await tx<MediaJob[]>`
        select j.id::text,j.company_id::text,j.conversation_id::text,j.inbound_message_id::text,j.attempts,j.payload,
          i.api_base_url,i.api_version,i.access_token_ciphertext
        from public.automation_jobs j
        join public.integrations i on i.company_id=j.company_id and i.provider='whatsapp_cloud' and i.is_active
        where j.kind='media_download' and j.status in ('pending','failed') and j.next_attempt_at<=now()
          and i.access_token_ciphertext is not null
        order by j.created_at for update of j skip locked limit 1
      `;
      if (!job) return null;
      await tx`update public.automation_jobs set status='processing',attempts=attempts+1,locked_at=now(),locked_by=${instanceId} where id=${job.id}`;
      return job;
    });
  }

  async function processOne(): Promise<boolean> {
    const job = await claim();
    if (!job) return false;
    try {
      if (!job.payload.mediaId) throw new Error('MEDIA_ID_MISSING');
      const mediaId = job.payload.mediaId;
      const token = decryptSecret(job.access_token_ciphertext, config.encryptionKey);
      const metadataResponse = await fetch(`${job.api_base_url.replace(/\/$/, '')}/${job.api_version}/${mediaId}`, { headers: { authorization: `Bearer ${token}` } });
      const metadata = await metadataResponse.json() as { url?: string; mime_type?: string; file_size?: number; error?: { code?: number } };
      if (!metadataResponse.ok || !metadata.url) throw new Error(`META_MEDIA_${metadata.error?.code ?? metadataResponse.status}`);
      const download = await fetch(metadata.url, { headers: { authorization: `Bearer ${token}` } });
      if (!download.ok) throw new Error(`META_DOWNLOAD_${download.status}`);
      const bytes = Buffer.from(await download.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024) throw new Error('MEDIA_TOO_LARGE');
      const extension = metadata.mime_type?.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9]/gi, '') || 'bin';
      const safeName = (job.payload.fileName || `${job.payload.type || 'media'}-${mediaId}.${extension}`).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 180);
      const path = `${job.company_id}/${job.conversation_id}/${randomUUID()}-${safeName}`;
      const upload = await fetch(`${config.supabaseUrl}/storage/v1/object/chat-attachments/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
        method: 'POST',
        headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}`, 'content-type': metadata.mime_type ?? 'application/octet-stream', 'x-upsert': 'false' },
        body: new Uint8Array(bytes),
      });
      if (!upload.ok) throw new Error(`STORAGE_${upload.status}`);
      await db.begin(async (tx) => {
        await tx`
          insert into public.attachments(company_id,message_id,file_name,mime_type,size_bytes,storage_path,sha256,whatsapp_media_id)
          values (${job.company_id},${job.inbound_message_id},${safeName},${metadata.mime_type ?? 'application/octet-stream'},${bytes.length},${path},${createHash('sha256').update(bytes).digest('hex')},${mediaId})
        `;
        await tx`update public.automation_jobs set status='completed',locked_at=null,locked_by=null,error_code=null where id=${job.id}`;
      });
      return true;
    } catch (error) {
      const attempts = job.attempts + 1;
      const code = error instanceof Error ? error.message.slice(0, 100) : 'MEDIA_FAILED';
      await db`update public.automation_jobs set status=${attempts >= 5 ? 'dead_letter' : 'failed'},next_attempt_at=now()+(${Math.min(900, 2 ** attempts * 10)}*interval '1 second'),locked_at=null,locked_by=null,error_code=${code} where id=${job.id}`;
      return true;
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try { for (let index=0; index<5; index+=1) if (!(await processOne())) break; }
    finally { running=false; }
  }
  return {
    start() { if (!timer) { timer=setInterval(()=>void tick(),3000); timer.unref(); void tick(); } },
    stop() { if (timer) clearInterval(timer); timer=undefined; },
    tick,
  };
}
